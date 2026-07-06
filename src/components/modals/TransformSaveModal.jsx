import { Copy, RefreshCw } from 'lucide-react';
import Modal from '../common/Modal';
import './TransformSaveModal.css';

export default function TransformSaveModal({
  operationCount,
  onSaveCopy,
  onOverwrite,
  onDiscard,
  onKeepEditing,
}) {
  return (
    <Modal header={false}>
      <h3 className="modal-title" style={{ marginBottom: 6 }}>
        Save edited image
      </h3>
      <p className="modal-message">
        You made{' '}
        <strong>
          {operationCount} edit{operationCount !== 1 ? 's' : ''}
        </strong>
        . How would you like to save?
      </p>

      <div className="transform-save-options">
        <button className="transform-save-option" onClick={onSaveCopy}>
          <Copy size={20} strokeWidth={1.5} />
          <span className="transform-save-label">Save as Copy</span>
          <span className="transform-save-desc">
            Keeps the original intact, adds the edited version to your library
          </span>
        </button>
        <button className="transform-save-option transform-save-option-warn" onClick={onOverwrite}>
          <RefreshCw size={20} strokeWidth={1.5} />
          <span className="transform-save-label">Replace Original</span>
          <span className="transform-save-desc">
            Overwrites the library file — cannot be undone
          </span>
        </button>
      </div>

      <div className="modal-actions" style={{ marginTop: 0 }}>
        <button
          className="btn btn-secondary"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={onDiscard}
        >
          Discard
        </button>
        <button
          className="btn btn-primary"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={onKeepEditing}
        >
          Keep editing
        </button>
      </div>
    </Modal>
  );
}
