import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
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
  const { t } = useTranslation();
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
    <Modal
      wide
      onClose={onClose}
      icon={<Pencil size={20} />}
      title={t('batchRename.title', { count: items.length })}
    >
      <div className="modal-form">
        <div>
          <label className="rename-label">{t('batchRename.pattern')}</label>
          <input
            className="input"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            autoFocus
            placeholder="{name} — {index} — {date}"
            maxLength={NAME_MAX_LEN}
          />
          <p className="rename-hint">
            {t('batchRename.variablesLabel')} <code>{'{name}'}</code>{' '}
            {t('batchRename.originalName')} &nbsp;·&nbsp;
            <code>{'{index}'}</code> {t('batchRename.sequenceNumber')} &nbsp;·&nbsp;
            <code>{'{date}'}</code> {t('batchRename.importDate')}
          </p>
        </div>

        <div>
          <label className="rename-label">{t('batchRename.preview')}</label>
          <div className="rename-preview">
            {previews.map((p, i) => (
              <div key={i} className="rename-preview-row">
                <span className="rename-old">{p.old}</span>
                <span className="rename-arrow">→</span>
                <span className="rename-new">{p.next}</span>
              </div>
            ))}
            {items.length > 8 && (
              <p className="rename-more">
                {t('batchRename.moreCount', { count: items.length - 8 })}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>
          {t('batchRename.cancel')}
        </button>
        <button className="btn btn-primary" onClick={handleApply}>
          {t('batchRename.renameAll')}
        </button>
      </div>
    </Modal>
  );
}
