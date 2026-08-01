import React from 'react';
import ReactDOM from 'react-dom/client';
import WorkspaceGate from './WorkspaceGate';
import './i18n';

// Apply stored theme before first paint to avoid flash
const storedTheme = localStorage.getItem('vivid-theme') ?? 'dark';
document.documentElement.setAttribute('data-theme', storedTheme);

// Suppress the webview's native context menu (shows "Reload" etc.)
// everywhere except text inputs and textareas, where the OS paste menu is needed.
document.addEventListener('contextmenu', (e) => {
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WorkspaceGate />
  </React.StrictMode>,
);
