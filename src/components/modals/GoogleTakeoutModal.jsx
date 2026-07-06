import { ExternalLink, FolderOpen, Cloud } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import Modal from '../common/Modal';

export default function GoogleTakeoutModal({ onClose, onImportPaths }) {
  const { t } = useTranslation();
  async function pickFolder() {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Select Google Takeout Folder',
    });
    if (selected) {
      onClose();
      onImportPaths([selected]);
    }
  }

  return (
    <Modal
      wide
      className="import-source-modal"
      onClose={onClose}
      icon={<Cloud size={20} />}
      title={t('googlePhotos.title')}
    >
      <div className="import-source-body">
        <p>{t('googlePhotos.body')}</p>
        <ol className="import-source-steps">
          <li>{t('googlePhotos.step1')}</li>
          <li>{t('googlePhotos.step2')}</li>
          <li>{t('googlePhotos.step3')}</li>
          <li>{t('googlePhotos.step4')}</li>
        </ol>
        <p className="import-source-note">{t('googlePhotos.note')}</p>
      </div>

      <div className="import-source-actions">
        <button className="btn btn-secondary" onClick={() => openUrl('https://takeout.google.com')}>
          <ExternalLink size={14} /> {t('googlePhotos.openTakeout')}
        </button>
        <button className="btn btn-primary" onClick={pickFolder}>
          <FolderOpen size={14} /> {t('googlePhotos.chooseFolder')}
        </button>
      </div>
    </Modal>
  );
}
