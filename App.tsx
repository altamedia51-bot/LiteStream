
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Activity, 
  Play, 
  Square, 
  Video, 
  Music,
  Image as ImageIcon,
  Settings, 
  Upload, 
  Monitor,
  HardDrive,
  Cpu,
  Trash2,
  PlusCircle,
  ArrowRight
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';

interface MediaFile {
  id: number;
  filename: string;
  path: string;
  size: number;
  type: 'video' | 'audio' | 'image';
  created_at: string;
}

interface LogEntry {
  type?: 'start' | 'end' | 'error' | 'debug' | 'info';
  message: string;
  timestamp: string;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'library' | 'settings'>('overview');
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [filter, setFilter] = useState<'all' | 'video' | 'audio' | 'image'>('all');
  const [isStreaming, setIsStreaming] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [rtmpUrl, setRtmpUrl] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaFile | null>(null);
  const [selectedCoverId, setSelectedCoverId] = useState<string>("");

  const socketRef = useRef<Socket | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchMedia = useCallback(async () => {
    try {
      const res = await fetch('/api/videos');
      const data = await res.json();
      setMedia(data);
    } catch (err) {
      console.error("Failed to fetch media", err);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/stream/status');
      const data = await res.json();
      setIsStreaming(data.active);
    } catch (err) {
      console.error("Failed to fetch status", err);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setRtmpUrl(data.rtmp_url || '');
    } catch (err) {
      console.error("Failed to fetch settings", err);
    }
  }, []);

  useEffect(() => {
    fetchMedia();
    fetchStatus();
    fetchSettings();

    socketRef.current = io();
    socketRef.current.on('log', (data: any) => {
      const newLog: LogEntry = {
        type: data.type,
        message: data.message || data.text || JSON.stringify(data),
        timestamp: new Date().toLocaleTimeString()
      };
      setLogs(prev => [...prev.slice(-100), newLog]);
      
      if (data.type === 'start') setIsStreaming(true);
      if (data.type === 'end') setIsStreaming(false);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, [fetchMedia, fetchStatus, fetchSettings]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('video', file);
    setUploadProgress(0);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/videos/upload', true);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      setUploadProgress(null);
      if (xhr.status === 200) fetchMedia();
      else alert("Upload failed: " + xhr.responseText);
    };
    xhr.send(formData);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Hapus file ini?")) return;
    try {
      await fetch(`/api/videos/${id}`, { method: 'DELETE' });
      fetchMedia();
    } catch (err) { alert("Hapus gagal"); }
  };

  const openStreamModal = (item: MediaFile) => {
    setSelectedMedia(item);
    setIsModalOpen(true);
  };

  const startStreaming = async () => {
    if (!selectedMedia) return;
    try {
      const res = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          videoId: selectedMedia.id, 
          rtmpUrl: rtmpUrl,
          coverImageId: selectedCoverId || undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        setIsModalOpen(false);
        setActiveTab('overview');
      } else alert("Gagal memulai: " + data.error);
    } catch (err) { alert("Request gagal"); }
  };

  const stopStreaming = async () => {
    if (!confirm("Hentikan streaming sekarang?")) return;
    try {
      await fetch('/api/stream/stop', { method: 'POST' });
    } catch (err) { alert("Gagal menghentikan stream"); }
  };

  const saveSettings = async () => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rtmp_url: rtmpUrl })
      });
      alert("Pengaturan tersimpan!");
    } catch (err) { alert("Gagal menyimpan"); }
  };

  const filteredMedia = filter === 'all' ? media : media.filter(m => m.type === filter);

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-900 text-slate-100">
      {/* Sidebar */}
      <nav className="w-full md:w-64 bg-slate-800 border-r border-slate-700 flex-shrink-0">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-10">
            <div className="bg-indigo-600 p-2.5 rounded-xl shadow-lg shadow-indigo-500/20">
              <Activity className="text-white w-6 h-6" />
            </div>
            <h1 className="font-bold text-xl tracking-tight">LiteStream</h1>
          </div>
          <div className="space-y-1.5">
            <SidebarLink active={activeTab === 'overview'} icon={<Monitor size={20}/>} label="Overview" onClick={() => setActiveTab('overview')} />
            <SidebarLink active={activeTab === 'library'} icon={<Video size={20}/>} label="Media Library" onClick={() => setActiveTab('library')} />
            <SidebarLink active={activeTab === 'settings'} icon={<Settings size={20}/>} label="Settings" onClick={() => setActiveTab('settings')} />
          </div>
        </div>
        <div className="mt-auto p-6 border-t border-slate-700">
          <div className="bg-slate-900/50 rounded-2xl p-4 border border-slate-700/50">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase mb-3 tracking-widest">VPS Resources</h3>
            <div className="space-y-4">
              <ResourceBar label="CPU" value="2.1%" percentage={12} icon={<Cpu size={12}/>} />
              <ResourceBar label="RAM" value="142MB" percentage={14} icon={<HardDrive size={12}/>} />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
          <h2 className="text-lg font-bold text-slate-200">
            {activeTab === 'overview' ? 'System Dashboard' : activeTab === 'library' ? 'Media Management' : 'Configurations'}
          </h2>
          <div className="flex items-center gap-4">
            {isStreaming && (
              <div className="flex items-center gap-2 text-[10px] font-bold text-rose-500 bg-rose-500/10 px-3 py-1.5 rounded-full border border-rose-500/20 animate-pulse uppercase tracking-widest">
                <span className="w-2 h-2 rounded-full bg-rose-500"></span> LIVE
              </div>
            )}
            <div className="text-xs text-slate-500 font-medium">Server: <span className="text-emerald-400 font-bold">Online</span></div>
          </div>
        </header>

        <div className="p-8 max-w-6xl mx-auto">
          {activeTab === 'overview' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="flex justify-between items-end">
                <div>
                  <h1 className="text-2xl font-bold">Overview</h1>
                  <p className="text-slate-500 text-sm">Monitor streaming activity and system health.</p>
                </div>
                {!isStreaming && (
                  <button 
                    onClick={() => setActiveTab('library')}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-indigo-600/20 text-sm"
                  >
                    <PlusCircle size={18} />
                    Start New Stream
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatusCard title="Stream Status" value={isStreaming ? "Running" : "Idle"} color={isStreaming ? "text-emerald-400" : "text-slate-400"} icon={isStreaming ? <Play fill="currentColor" /> : <Square />} />
                <StatusCard title="Files Stored" value={media.length.toString()} color="text-indigo-400" icon={<Video />} />
                <StatusCard title="Encoder" value="FFmpeg Ultrafast" color="text-amber-400" icon={<Activity />} />
              </div>

              {/* Console */}
              <div className="bg-slate-800 rounded-3xl overflow-hidden border border-slate-700 shadow-2xl">
                <div className="bg-slate-700/30 px-6 py-4 border-b border-slate-700 flex justify-between items-center">
                  <h3 className="font-bold flex items-center gap-2 text-sm"><Activity size={16} className="text-indigo-400" /> System Logs</h3>
                  <div className="flex gap-2">
                    {isStreaming && <button onClick={stopStreaming} className="text-[10px] bg-rose-500 hover:bg-rose-600 px-3 py-1 rounded-lg font-bold">STOP STREAM</button>}
                    <button onClick={() => setLogs([])} className="text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded-lg">CLEAR</button>
                  </div>
                </div>
                <div ref={logContainerRef} className="bg-slate-950 p-6 font-mono text-[11px] h-80 overflow-y-auto space-y-1 text-slate-300 console-log border-t border-slate-800">
                  {logs.length === 0 ? <p className="text-slate-600 italic">[No events yet...]</p> : logs.map((log, i) => (
                    <p key={i} className={log.type === 'error' ? 'text-rose-400' : log.type === 'start' ? 'text-emerald-400 font-bold' : log.type === 'end' ? 'text-amber-400' : 'text-slate-400'}>
                      <span className="opacity-30 mr-2">[{log.timestamp}]</span> {log.message}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'library' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold">Media Library</h3>
                  <p className="text-sm text-slate-500">Pilih file video (.mp4) atau musik (.mp3) untuk di-stream.</p>
                </div>
                <div className="flex items-center gap-3">
                  <input type="file" id="fileUpload" className="hidden" onChange={handleUpload} accept="video/*,audio/mpeg,image/*" />
                  <button onClick={() => document.getElementById('fileUpload')?.click()} className="bg-indigo-600 hover:bg-indigo-700 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-xl shadow-indigo-600/20 text-sm">
                    <Upload size={18} /> Upload Media
                  </button>
                </div>
              </div>

              {uploadProgress !== null && (
                <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 shadow-lg">
                  <div className="flex justify-between text-xs font-bold mb-3 uppercase tracking-widest text-slate-400">
                    <span>Uploading...</span> <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                  </div>
                </div>
              )}

              <div className="flex gap-2 p-1 bg-slate-800/50 rounded-2xl w-fit border border-slate-700">
                {(['all', 'video', 'audio', 'image'] as const).map(type => (
                  <button key={type} onClick={() => setFilter(type)} className={`px-5 py-2 rounded-xl text-xs font-bold transition-all capitalize ${filter === type ? "bg-slate-700 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"}`}>
                    {type}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4">
                {filteredMedia.length === 0 ? (
                  <div className="text-center py-24 border-2 border-dashed border-slate-800 rounded-[2rem] bg-slate-800/20">
                    <Video size={48} className="mx-auto mb-4 text-slate-700" />
                    <h3 className="text-lg font-bold text-slate-400 mb-2">Library Kosong</h3>
                    <p className="text-slate-500 max-w-xs mx-auto mb-6 text-sm">Unggah file video atau audio terlebih dahulu untuk memulai streaming.</p>
                    <button onClick={() => document.getElementById('fileUpload')?.click()} className="text-indigo-400 font-bold flex items-center gap-2 mx-auto hover:text-indigo-300 transition-all">
                      <PlusCircle size={20} /> Klik di sini untuk Upload
                    </button>
                  </div>
                ) : (
                  filteredMedia.map(item => (
                    <div key={item.id} className="bg-slate-800 border border-slate-700 rounded-2xl p-5 flex items-center justify-between hover:bg-slate-700/50 transition-all group">
                      <div className="flex items-center gap-5">
                        <div className={`p-4 rounded-2xl ${item.type === 'audio' ? 'bg-amber-500/10 text-amber-500' : item.type === 'image' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-indigo-500/10 text-indigo-500'}`}>
                          {item.type === 'audio' ? <Music size={24}/> : item.type === 'image' ? <ImageIcon size={24}/> : <Video size={24}/>}
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-100">{item.filename}</h4>
                          <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                            <span>{item.type}</span> <span>•</span> <span>{(item.size / (1024 * 1024)).toFixed(1)} MB</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {(item.type === 'video' || item.type === 'audio') && (
                          <button 
                            onClick={() => openStreamModal(item)}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl transition-all font-bold text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/20"
                          >
                            <Play size={14} fill="currentColor" /> Stream
                          </button>
                        )}
                        <button onClick={() => handleDelete(item.id)} className="bg-slate-700 hover:bg-rose-500 text-slate-300 hover:text-white p-2.5 rounded-xl transition-all">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-2xl bg-slate-800 border border-slate-700 rounded-3xl p-8 space-y-8 shadow-2xl">
              <div>
                <h3 className="text-xl font-bold mb-6">Stream Settings</h3>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Default RTMP Target</label>
                    <input type="text" value={rtmpUrl} onChange={(e) => setRtmpUrl(e.target.value)} placeholder="rtmp://a.rtmp.youtube.com/live2/xxxx" className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-5 py-4 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono text-indigo-400 text-sm" />
                    <p className="text-[10px] text-slate-500">Masukkan RTMP URL dari YouTube, Twitch, atau platform lain.</p>
                  </div>
                </div>
              </div>
              <div className="pt-6 border-t border-slate-700 flex justify-end">
                <button onClick={saveSettings} className="bg-indigo-600 hover:bg-indigo-700 px-10 py-4 rounded-2xl font-bold transition-all shadow-xl shadow-indigo-600/30 text-sm">Save Changes</button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Modal Setup Stream */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in zoom-in duration-200">
          <div className="bg-slate-800 border border-slate-700 w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl">
            <h3 className="text-2xl font-bold mb-2 flex items-center gap-2"><Play size={24} className="text-indigo-400" /> Start Streaming</h3>
            <p className="text-slate-400 text-sm mb-8">Asset: <span className="text-indigo-400 font-bold">{selectedMedia?.filename}</span></p>
            
            <div className="space-y-6">
              {selectedMedia?.type === 'audio' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Background Cover</label>
                  <select value={selectedCoverId} onChange={(e) => setSelectedCoverId(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-5 py-4 outline-none focus:ring-2 focus:ring-indigo-500 text-sm">
                    <option value="">-- No Image (Black) --</option>
                    {media.filter(m => m.type === 'image').map(img => <option key={img.id} value={img.id}>{img.filename}</option>)}
                  </select>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Destination RTMP URL</label>
                <input type="text" value={rtmpUrl} onChange={(e) => setRtmpUrl(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-5 py-4 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono text-indigo-400" />
              </div>
              <div className="flex gap-4 pt-4">
                <button onClick={() => setIsModalOpen(false)} className="flex-1 px-6 py-4 border border-slate-700 rounded-2xl font-bold hover:bg-slate-700 transition-all text-sm">Batal</button>
                <button onClick={startStreaming} className="flex-1 px-6 py-4 bg-indigo-600 hover:bg-indigo-700 rounded-2xl font-bold transition-all shadow-xl shadow-indigo-600/30 text-sm flex items-center justify-center gap-2">
                  <ArrowRight size={18} /> GO LIVE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SidebarLink: React.FC<{ active: boolean; icon: React.ReactNode; label: string; onClick: () => void }> = ({ active, icon, label, onClick }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all ${active ? "bg-indigo-600/10 text-indigo-400 font-bold shadow-sm" : "text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"}`}>
    {icon} <span className="text-sm">{label}</span>
  </button>
);

const ResourceBar: React.FC<{ label: string; value: string; percentage: number; icon: React.ReactNode }> = ({ label, value, percentage, icon }) => (
  <div className="space-y-1.5">
    <div className="flex justify-between items-center text-[9px] font-bold text-slate-500 uppercase tracking-widest">
      <div className="flex items-center gap-1.5">{icon} <span>{label}</span></div> <span>{value}</span>
    </div>
    <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
      <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${percentage}%` }}></div>
    </div>
  </div>
);

const StatusCard: React.FC<{ title: string; value: string; color: string; icon: React.ReactNode }> = ({ title, value, color, icon }) => (
  <div className="bg-slate-800 border border-slate-700 p-6 rounded-[2rem] shadow-sm relative overflow-hidden">
    <div className="absolute -right-4 -bottom-4 opacity-5 text-white">{React.cloneElement(icon as React.ReactElement, { size: 100 })}</div>
    <div className="flex items-center gap-3 mb-3 text-slate-500">
      {React.cloneElement(icon as React.ReactElement, { size: 14 })}
      <span className="text-[10px] font-bold uppercase tracking-widest">{title}</span>
    </div>
    <div className={`text-2xl font-bold ${color}`}>{value}</div>
  </div>
);

export default App;
