import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Archive, Download } from 'lucide-react';
import Modal from '../common/Modal';
import './ExportModal.css';

export default function ExportModal({ items, onClose }) {
  const [status, setStatus] = useState(null); // null | 'working' | 'done' | 'error'
  const [message, setMessage] = useState('');

  const filePaths = items.map((i) => i.file_path);

  async function handleExportFolder() {
    const dest = await open({
      directory: true,
      multiple: false,
      title: 'Choose destination folder',
    });
    if (!dest) return;
    setStatus('working');
    setMessage('Copying files…');
    try {
      await invoke('export_files_to_folder', { filePaths, destFolder: dest });
      setStatus('done');
      setMessage(`${items.length} file${items.length !== 1 ? 's' : ''} exported to folder.`);
    } catch (e) {
      setStatus('error');
      setMessage(String(e));
    }
  }

  async function handleExportZip() {
    const dest = await save({
      title: 'Save ZIP archive',
      defaultPath: 'vivid-export.zip',
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });
    if (!dest) return;
    setStatus('working');
    setMessage('Creating ZIP…');
    try {
      await invoke('export_files_as_zip', { filePaths, destPath: dest });
      setStatus('done');
      setMessage(`${items.length} file${items.length !== 1 ? 's' : ''} saved to ZIP.`);
    } catch (e) {
      setStatus('error');
      setMessage(String(e));
    }
  }

  return (
    <Modal
      wide
      className="export-modal"
      onClose={onClose}
      titleIcon={<Download size={16} />}
      title={
        <>
          Export {items.length} file{items.length !== 1 ? 's' : ''}
        </>
      }
    >
      {status === null || status === 'error' ? (
        <div className="export-options">
          <button className="export-option-btn" onClick={handleExportFolder}>
            <FolderOpen size={28} />
            <span className="export-option-title">Export to Folder</span>
            <span className="export-option-desc">Copy files to a folder you choose</span>
          </button>
          <button className="export-option-btn" onClick={handleExportZip}>
            <Archive size={28} />
            <span className="export-option-title">Export as ZIP</span>
            <span className="export-option-desc">Bundle all files into a single ZIP archive</span>
          </button>
        </div>
      ) : null}

      {status === 'working' && (
        <div className="export-status">
          <span
            className="loading-dot"
            style={{ width: 10, height: 10, display: 'inline-block' }}
          />
          <span>{message}</span>
        </div>
      )}
      {status === 'done' && (
        <div className="export-status export-done">
          ✓ {message}
          <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={onClose}>
            Close
          </button>
        </div>
      )}
      {status === 'error' && <div className="export-status export-error">Error: {message}</div>}
    </Modal>
  );
}
