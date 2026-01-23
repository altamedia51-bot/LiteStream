
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const renderApp = () => {
  const rootElement = document.getElementById('root');
  
  if (!rootElement) {
    // Jika elemen belum ada, coba lagi sebentar kemudian
    console.warn("Target container 'root' not found, retrying...");
    setTimeout(renderApp, 10);
    return;
  }

  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

// Pastikan DOM sudah termuat sebelum eksekusi
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  renderApp();
} else {
  document.addEventListener('DOMContentLoaded', renderApp);
}
