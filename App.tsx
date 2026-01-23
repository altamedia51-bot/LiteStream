
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
  ArrowRight,
  RefreshCw
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
  const [isLooping, setIsLooping] = useState<boolean>(true);

  const socketRef = useRef<Socket | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchMedia = useCallback(async () => {
    try {
      const res = await fetch('/api/videos');
      const data = await res.json();
      setMedia(data);
    } catch (err) { console.error(err); }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/stream/status');
      const data = await res.json();
      setIsStreaming(data.active);
    } catch (err) { console.error(err); }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setRtmpUrl(data.rtmp_url || '');
    } catch (err) { console.error(err); }
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

    return () => { socketRef.current?.disconnect(); };
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
      if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      setUploadProgress(null);
      if (xhr.status === 200) fetchMedia();
      else alert("Upload gagal");
    };
    xhr.send(formData);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Hapus file?")) return;
    await fetch(`/api/videos/${id}`, { method: 'DELETE' });
    fetchMedia();
  };

  const openStreamModal = (item: MediaFile) => {
    setSelectedMedia(item);
    setIsLooping(item.type === 'audio'); // Default loop on for audio
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
          coverImageId: selectedCoverId || undefined,
          loop: isLooping
        })
      });
      const data = await res.json();
      if (data.success) {
        setIsModalOpen(false);
        setActiveTab('overview');
      } else alert("Gagal: " + data.error);
    } catch (err) { alert("Error memulai stream"); }
  };

  const stopStreaming = async () => {
    if (!confirm("Stop stream?")) return;
    await fetch('/api/stream/stop', { method: 'POST' });
  };

  const filteredMedia = filter === 'all' ? media : media.filter(m => m.type === filter);

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-900 text-slate-100">
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
            <h3 className="text-[10px] font-bold text-slate-500 uppercase mb-3 tracking-widest text-center">Engine Optimizing</h3>
            <p className="text-[11px] text-slate-400 text-center leading-relaxed">CBR 2000kbps Active<br/>Stable Mode Enabled</p>
          </div>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto">
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
          <h2 className="text-lg font-bold text-slate-200 capitalize">{activeTab}</h2>
          <div className="flex items-center gap-4">
            {isStreaming && (
              <div className="flex items-center gap-2 text-[10px] font-bold text-rose-500 bg-rose-500/10 px-3 py-1.5 rounded-full border border-rose-500/20 animate-pulse uppercase tracking-widest">
                <span className="w-2 h-2 rounded-full bg-rose-500"></span> LIVE
              </div>
            )}
            <div className="text-xs text-slate-500">Server: <span className="text-emerald-400 font-bold">Online</span></div>
          </div>
        </header>

        <div className="p-8 max-w-6xl mx-auto">
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatusCard title="Stream State" value={isStreaming ? "Streaming" : "Idle"} color={isStreaming ? "text-emerald-400" : "text-slate-500"} icon={<Play/>} />
                <StatusCard title="Mode" value="CBR High Stability" color="text-indigo-400" icon={<Activity/>} />
                <StatusCard title="Library" value={media.length.toString()} color="text-amber-400" icon={<Video/>} />
              </div>

              <div className="bg-slate-800 rounded-3xl overflow-hidden border border-slate-700 shadow-2xl">
                <div className="bg-slate-700/30 px-6 py-4 border-b border-slate-700 flex justify-between items-center">
                  <h3 className="font-bold text-sm">System Logs</h3>
                  <div className="flex gap-2">
                    {isStreaming && <button onClick={stopStreaming} className="text-[10px] bg-rose-500 px-3 py-1 rounded-lg font-bold">STOP</button>}
                    <button onClick={() => setLogs([])} className="text-[10px] text-slate-400 px-2 py-1">CLEAR</button>
                  </div>
                </div>
                <div ref={logContainerRef} className="bg-slate-950 p-6 font-mono text-[11px] h-80 overflow-y-auto space-y-1 text-slate-300">
                  {logs.length === 0 ? <p className="text-slate-600 italic">[Waiting for data...]</p> : logs.map((log, i) => (
                    <p key={i} className={log.type === 'error' ? 'text-rose-400' : log.type === 'start' ? 'text-emerald-400' : 'text-slate-400'}>
                      <span className="opacity-30 mr-2">[{log.timestamp}]</span> {log.message}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'library' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold">Media Library</h3>
                <button onClick={() => document.getElementById('upIn')?.click()} className="bg-indigo-600 px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2">
                  <Upload size={18}/> Upload
                </button>
                <input type="file" id="upIn" className="hidden" onChange={handleUpload} />
              </div>

              {uploadProgress !== null && (
                <div className="bg-slate-800 p-4 rounded-xl border border-indigo-500/20">
                  <div className="flex justify-between text-xs font-bold mb-2"><span>Uploading...</span> <span>{uploadProgress}%</span></div>
                  <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden"><div className="h-full bg-indigo-500" style={{width: `${uploadProgress}%`}}></div></div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3">
                {filteredMedia.map(item => (
                  <div key={item.id} className="bg-slate-800 border border-slate-700 p-4 rounded-2xl flex items-center justify-between hover:bg-slate-700/30 transition-all">
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-xl bg-slate-900 ${item.type === 'audio' ? 'text-amber-400' : 'text-indigo-400'}`}>
                        {item.type === 'audio' ? <Music size={20}/> : item.type === 'image' ? <ImageIcon size={20}/> : <Video size={20}/>}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm">{item.filename}</h4>
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{(item.size / 1024 / 1024).toFixed(1)} MB • {item.type}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {(item.type === 'video' || item.type === 'audio') && (
                        <button onClick={() => openStreamModal(item)} className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2">
                          <Play size={12} fill="currentColor"/> LIVE
                        </button>
                      )}
                      <button onClick={() => handleDelete(item.id)} className="bg-slate-700 p-2 rounded-xl hover:bg-rose-500 transition-colors"><Trash2 size={14}/></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-xl bg-slate-800 border border-slate-700 rounded-3xl p-8 space-y-6">
              <h3 className="text-xl font-bold">Configuration</h3>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Default RTMP URL</label>
                <input type="text" value={rtmpUrl} onChange={e => setRtmpUrl(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm font-mono text-indigo-400" />
              </div>
              <button onClick={() => fetch('/api/settings', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({rtmp_url:rtmpUrl})}).then(() => alert("Saved"))} className="bg-indigo-600 w-full py-3 rounded-xl font-bold text-sm">Save Changes</button>
            </div>
          )}
        </div>
      </main>

      {/* Modal Go Live */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-slate-800 border border-slate-700 w-full max-w-md rounded-[2.5rem] p-10 space-y-6">
            <h3 className="text-2xl font-bold">Go Live Setup</h3>
            <p className="text-sm text-slate-400">File: <span className="text-indigo-400 font-bold">{selectedMedia?.filename}</span></p>
            
            {selectedMedia?.type === 'audio' && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Background Image</label>
                <select value={selectedCoverId} onChange={e => setSelectedCoverId(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm">
                  <option value="">-- No Background --</option>
                  {media.filter(m => m.type === 'image').map(img => <option key={img.id} value={img.id}>{img.filename}</option>)}
                </select>
              </div>
            )}

            <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <RefreshCw size={20} className={isLooping ? "text-indigo-400" : "text-slate-600"} />
                <div>
                  <p className="text-sm font-bold">Looping Mode</p>
                  <p className="text-[10px] text-slate-500">Ulangi terus (Streaming 24/7)</p>
                </div>
              </div>
              <input type="checkbox" checked={isLooping} onChange={e => setIsLooping(e.target.checked)} className="w-6 h-6 rounded accent-indigo-600" />
            </div>

            <div className="flex gap-4 pt-4">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 py-4 border border-slate-700 rounded-2xl font-bold text-sm">Batal</button>
              <button onClick={startStreaming} className="flex-1 py-4 bg-indigo-600 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-xl shadow-indigo-600/30">
                <ArrowRight size={18}/> GO LIVE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SidebarLink = ({active, icon, label, onClick}: any) => (
  <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all ${active ? "bg-indigo-600/10 text-indigo-400 font-bold" : "text-slate-500 hover:text-slate-300"}`}>
    {icon} <span className="text-sm">{label}</span>
  </button>
);

const StatusCard = ({title, value, color, icon}: any) => (
  <div className="bg-slate-800 border border-slate-700 p-6 rounded-3xl relative overflow-hidden">
    <div className="absolute right-0 bottom-0 opacity-5 scale-150">{icon}</div>
    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">{title}</p>
    <div className={`text-2xl font-bold ${color}`}>{value}</div>
  </div>
);

export default App;
