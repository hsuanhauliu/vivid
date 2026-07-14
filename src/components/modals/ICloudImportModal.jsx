import { Apple, FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import Modal from '../common/Modal';
import './ImportSourceModal.css';

export default function ICloudImportModal({ onClose, onImportPaths }) {
  const { t } = useTranslation();
  async function importLibrary() {
    try {
      const path = await invoke('get_photos_library_path');
      onClose();
      onImportPaths([path]);
    } catch (e) {
      alert(String(e));
    }
  }

  return (
    <Modal
      wide
      className="import-source-modal"
      onClose={onClose}
      icon={<Apple size={20} />}
      title={t('icloud.title')}
    >
      <div className="import-source-body">
        <p>{t('icloud.body')}</p>
        <ol className="import-source-steps">
          <li>{t('icloud.step1')}</li>
          <li>{t('icloud.step2')}</li>
          <li>{t('icloud.step3')}</li>
        </ol>
        <p className="import-source-note">{t('icloud.note')}</p>
      </div>

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary" onClick={importLibrary}>
          <FolderOpen size={14} /> {t('icloud.importBtn')}
        </button>
      </div>
    </Modal>
  );
}
