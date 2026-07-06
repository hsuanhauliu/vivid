import { AlertTriangle } from 'lucide-react';
import Modal from '../common/Modal';

export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}) {
  return (
    <Modal header={false}>
      <div className="modal-icon">
        <AlertTriangle size={22} />
      </div>
      <h3 className="modal-title">{title}</h3>
      <p className="modal-message">{message}</p>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-danger-solid" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
