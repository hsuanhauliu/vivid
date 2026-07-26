import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader } from 'lucide-react';
import Modal from '../common/Modal';

/**
 * Shared yes/no confirmation dialog. `tone="accent"` swaps the danger-red
 * icon/confirm-button styling for the accent color, for non-destructive
 * confirmations (e.g. "Restore") that shouldn't read as alarming.
 *
 * `onConfirm` may be async (most callers await one or more `invoke()` calls,
 * e.g. trashing dozens of multi-selected items) — both buttons disable and
 * the confirm button shows a spinner for its duration, so a slow confirm
 * reads as "working" instead of a dialog that's silently stuck.
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
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal header={false} onClose={onCancel}>
      <div className={`modal-icon${tone === 'accent' ? ' modal-icon-accent' : ''}`}>
        <Icon size={22} />
      </div>
      <h3 className="modal-title">{title}</h3>
      <p className="modal-message">{message}</p>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel ?? t('common.cancel')}
        </button>
        <button
          className={`btn ${tone === 'accent' ? 'btn-primary' : 'btn-danger-solid'}`}
          onClick={handleConfirm}
          disabled={busy}
        >
          {busy ? <Loader size={13} className="spin" /> : (confirmLabel ?? t('common.ok'))}
        </button>
      </div>
    </Modal>
  );
}
