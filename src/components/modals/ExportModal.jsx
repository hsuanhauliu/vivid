import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Archive, Download } from 'lucide-react';
import Modal from '../common/Modal';
import './ExportModal.css';

export default function ExportModal({ items, onClose }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null); // null | 'working' | 'done' | 'error'
  const [message, setMessage] = useState('');

  const filePaths = items.map((i) => i.file_path);

  async function handleExportFolder() {
    const dest = await open({
      directory: true,
      multiple: false,
      title: t('exportModal.chooseFolder'),
    });
    if (!dest) return;
    setStatus('working');
    setMessage(t('exportModal.copyingFiles'));
    try {
      await invoke('export_files_to_folder', { filePaths, destFolder: dest });
      setStatus('done');
      setMessage(t('exportModal.exportedToFolder', { count: items.length }));
    } catch (e) {
      setStatus('error');
      setMessage(String(e));
    }
  }

  async function handleExportZip() {
    const dest = await save({
      title: t('exportModal.saveZip'),
      defaultPath: 'vivid-export.zip',
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });
    if (!dest) return;
    setStatus('working');
    setMessage(t('exportModal.creatingZip'));
    try {
      await invoke('export_files_as_zip', { filePaths, destPath: dest });
      setStatus('done');
      setMessage(t('exportModal.savedToZip', { count: items.length }));
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
      title={t('exportModal.title', { count: items.length })}
    >
      {status === null || status === 'error' ? (
        <div className="export-options">
          <button className="export-option-btn" onClick={handleExportFolder}>
            <FolderOpen size={28} />
            <span className="export-option-title">{t('exportModal.exportToFolder')}</span>
            <span className="export-option-desc">{t('exportModal.exportToFolderDesc')}</span>
          </button>
          <button className="export-option-btn" onClick={handleExportZip}>
            <Archive size={28} />
            <span className="export-option-title">{t('exportModal.exportAsZip')}</span>
            <span className="export-option-desc">{t('exportModal.exportAsZipDesc')}</span>
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
            {t('exportModal.close')}
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="export-status export-error">
          {t('exportModal.errorPrefix')} {message}
        </div>
      )}
    </Modal>
  );
}
