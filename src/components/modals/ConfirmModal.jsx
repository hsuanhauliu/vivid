import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import Modal from '../common/Modal';

/**
 * Shared yes/no confirmation dialog. `tone="accent"` swaps the danger-red
 * icon/confirm-button styling for the accent color, for non-destructive
 * confirmations (e.g. "Restore") that shouldn't read as alarming.
 */
export default function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  icon: Icon = AlertTriangle,
  tone = 'danger',
  onConfirm,
  onCancel,
}) {
  const { t } = useTranslation();
  return (
    <Modal header={false} onClose={onCancel}>
      <div className={`modal-icon${tone === 'accent' ? ' modal-icon-accent' : ''}`}>
        <Icon size={22} />
      </div>
      <h3 className="modal-title">{title}</h3>
      <p className="modal-message">{message}</p>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onCancel}>
          {cancelLabel ?? t('common.cancel')}
        </button>
        <button
          className={`btn ${tone === 'accent' ? 'btn-primary' : 'btn-danger-solid'}`}
          onClick={onConfirm}
        >
          {confirmLabel ?? t('common.ok')}
        </button>
      </div>
    </Modal>
  );
}
