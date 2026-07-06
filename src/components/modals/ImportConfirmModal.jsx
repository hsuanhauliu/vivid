import { useTranslation } from 'react-i18next';
import { AlertTriangle, FileCheck2, FileX2, CopyX, FolderPlus } from 'lucide-react';
import Modal from '../common/Modal';
import './ImportConfirmModal.css';

/**
 * Final confirmation shown before an import copies anything, but only when the
 * preview turned up something noteworthy: files that will be skipped
 * (unsupported type or already-in-library duplicates) or new folders that will
 * be created from the imported directory structure.
 *
 * @param {object} preview - { to_import, skipped_type, skipped_dupe, new_folders }
 */
export default function ImportConfirmModal({ preview, onConfirm, onCancel }) {
  const { t } = useTranslation();
  const { to_import, skipped_type, skipped_dupe, new_folders } = preview;

  return (
    <Modal header={false}>
      <div className="modal-icon">
        <AlertTriangle size={22} />
      </div>
      <h3 className="modal-title">{t('importConfirm.title')}</h3>

      <ul className="import-confirm-list">
        <li className="import-confirm-row">
          <FileCheck2 size={15} className="import-confirm-ok" />
          <span>{t('importConfirm.toImport', { count: to_import })}</span>
        </li>
        {skipped_type > 0 && (
          <li className="import-confirm-row">
            <FileX2 size={15} className="import-confirm-warn" />
            <span>{t('importConfirm.skipType', { count: skipped_type })}</span>
          </li>
        )}
        {skipped_dupe > 0 && (
          <li className="import-confirm-row">
            <CopyX size={15} className="import-confirm-warn" />
            <span>{t('importConfirm.skipDupe', { count: skipped_dupe })}</span>
          </li>
        )}
        {new_folders.length > 0 && (
          <li className="import-confirm-row import-confirm-row-folders">
            <FolderPlus size={15} className="import-confirm-folder" />
            <div>
              <span>{t('importConfirm.newFolders', { count: new_folders.length })}</span>
              <ul className="import-confirm-folders">
                {new_folders.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          </li>
        )}
      </ul>

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onCancel}>
          {t('importConfirm.cancel')}
        </button>
        <button className="btn btn-primary" onClick={onConfirm} disabled={to_import === 0}>
          {t('importConfirm.confirm')}
        </button>
      </div>
    </Modal>
  );
}
