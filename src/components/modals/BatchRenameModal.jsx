import { useState, useMemo } from 'react';
import Modal from '../common/Modal';
import { NAME_MAX_LEN } from '../../utils/limits';
import './BatchRenameModal.css';

function applyPattern(pattern, item, index) {
  const date = item.created_at ? item.created_at.slice(0, 10) : '';
  const result =
    pattern
      .replace(/\{name\}/g, item.display_name)
      .replace(/\{index\}/g, String(index + 1).padStart(2, '0'))
      .replace(/\{date\}/g, date)
      .trim() || item.display_name;
  return result.slice(0, NAME_MAX_LEN);
}

export default function BatchRenameModal({ items, onRename, onClose }) {
  const [pattern, setPattern] = useState('{name}');

  const previews = useMemo(
    () =>
      items.slice(0, 8).map((item, i) => ({
        old: item.display_name,
        next: applyPattern(pattern, item, i),
      })),
    [items, pattern],
  );

  function handleApply() {
    const renames = items.map((item, i) => ({
      id: item.id,
      display_name: applyPattern(pattern, item, i),
    }));
    onRename(renames);
    onClose();
  }

  return (
    <Modal onClose={onClose} width={480} title={`Rename ${items.length} Items`}>
      <div
        className="modal-body"
        style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div>
          <label className="rename-label">Pattern</label>
          <input
            className="input"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            autoFocus
            placeholder="{name} — {index} — {date}"
            maxLength={NAME_MAX_LEN}
          />
          <p className="rename-hint">
            Variables: <code>{'{name}'}</code> original name &nbsp;·&nbsp;
            <code>{'{index}'}</code> sequence number &nbsp;·&nbsp;
            <code>{'{date}'}</code> import date
          </p>
        </div>

        <div>
          <label className="rename-label">Preview</label>
          <div className="rename-preview">
            {previews.map((p, i) => (
              <div key={i} className="rename-preview-row">
                <span className="rename-old">{p.old}</span>
                <span className="rename-arrow">→</span>
                <span className="rename-new">{p.next}</span>
              </div>
            ))}
            {items.length > 8 && <p className="rename-more">…and {items.length - 8} more</p>}
          </div>
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={handleApply}>
          Rename All
        </button>
      </div>
    </Modal>
  );
}
