import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCog } from 'lucide-react';
import Modal from '../common/Modal';
import { NAME_MAX_LEN } from '../../utils/limits';
import './BatchRenameModal.css';

function stemOf(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}
function extOf(fileName) {
  const m = fileName.match(/\.[^.]+$/);
  return m ? m[0] : '';
}

function applyPattern(pattern, item, index) {
  const date = item.created_at ? item.created_at.slice(0, 10) : '';
  const stem = stemOf(item.file_name);
  const result =
    pattern
      .replace(/\{name\}/g, stem)
      .replace(/\{index\}/g, String(index + 1).padStart(2, '0'))
      .replace(/\{date\}/g, date)
      .trim() || stem;
  return result.slice(0, NAME_MAX_LEN);
}

/**
 * Renames the actual on-disk filename (just the stem — extension and
 * directory are untouched), not `display_name`/library metadata (that's
 * BatchRenameModal). A single file gets a plain text field — a pattern
 * with {index}/{date} tokens is meaningless for one file — while a
 * multi-item selection keeps the {name}/{index}/{date} pattern UI so a
 * whole batch can be renamed consistently in one go.
 */
export default function RenameFileModal({ items, allItems, onRename, onClose }) {
  if (items.length === 1) {
    return (
      <SingleRenameFileModal
        item={items[0]}
        allItems={allItems}
        onRename={onRename}
        onClose={onClose}
      />
    );
  }
  return (
    <BatchRenameFileModal items={items} allItems={allItems} onRename={onRename} onClose={onClose} />
  );
}

function SingleRenameFileModal({ item, allItems, onRename, onClose }) {
  const { t } = useTranslation();
  const oldStem = stemOf(item.file_name);
  const ext = extOf(item.file_name);
  const [stem, setStem] = useState(oldStem);

  const trimmed = stem.trim();
  const conflict = useMemo(() => {
    if (!trimmed || trimmed === oldStem) return false;
    const finalName = (trimmed + ext).toLowerCase();
    return allItems.some(
      (other) =>
        other.id !== item.id &&
        other.folder_id === item.folder_id &&
        other.file_name.toLowerCase() === finalName,
    );
  }, [trimmed, oldStem, ext, allItems, item]);

  const canRename = trimmed.length > 0 && !conflict;

  function handleApply() {
    if (!canRename) return;
    if (trimmed !== oldStem) onRename([{ id: item.id, newStem: trimmed }]);
    onClose();
  }

  return (
    <Modal onClose={onClose} icon={<FileCog size={20} />} title={t('renameFile.titleSingle')}>
      <div className="modal-form">
        <div>
          <label className="rename-label">{t('renameFile.newName')}</label>
          <div className="rename-single-input">
            <input
              className="input"
              value={stem}
              onChange={(e) => setStem(e.target.value)}
              autoFocus
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => e.key === 'Enter' && handleApply()}
              maxLength={NAME_MAX_LEN}
            />
            {ext && <span className="rename-single-ext">{ext}</span>}
          </div>
          {conflict && (
            <p className="rename-conflict-hint">{t('renameFile.conflictHint', { count: 1 })}</p>
          )}
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>
          {t('batchRename.cancel')}
        </button>
        <button className="btn btn-primary" onClick={handleApply} disabled={!canRename}>
          {t('renameFile.rename')}
        </button>
      </div>
    </Modal>
  );
}

function BatchRenameFileModal({ items, allItems, onRename, onClose }) {
  const { t } = useTranslation();
  const [pattern, setPattern] = useState('{name}');

  const planned = useMemo(
    () =>
      items.map((item, i) => ({
        item,
        oldStem: stemOf(item.file_name),
        ext: extOf(item.file_name),
        newStem: applyPattern(pattern, item, i),
      })),
    [items, pattern],
  );

  // A planned rename conflicts if its final filename (case-insensitive,
  // same on-disk folder) collides with another item also being renamed in
  // this batch, or with an existing file that isn't part of it.
  const conflicts = useMemo(() => {
    const renamedIds = new Set(items.map((i) => i.id));
    const countInBatch = new Map();
    for (const p of planned) {
      const key = `${p.item.folder_id ?? ''}|${(p.newStem + p.ext).toLowerCase()}`;
      countInBatch.set(key, (countInBatch.get(key) ?? 0) + 1);
    }
    const bad = new Set();
    for (const p of planned) {
      const finalName = (p.newStem + p.ext).toLowerCase();
      const key = `${p.item.folder_id ?? ''}|${finalName}`;
      if (countInBatch.get(key) > 1) {
        bad.add(p.item.id);
        continue;
      }
      const existsElsewhere = allItems.some(
        (other) =>
          !renamedIds.has(other.id) &&
          other.folder_id === p.item.folder_id &&
          other.file_name.toLowerCase() === finalName,
      );
      if (existsElsewhere) bad.add(p.item.id);
    }
    return bad;
  }, [planned, items, allItems]);

  const hasConflicts = conflicts.size > 0;
  const previews = planned.slice(0, 8);

  function handleApply() {
    if (hasConflicts) return;
    const renames = planned
      .filter((p) => p.newStem !== p.oldStem)
      .map((p) => ({ id: p.item.id, newStem: p.newStem }));
    onRename(renames);
    onClose();
  }

  return (
    <Modal
      wide
      onClose={onClose}
      icon={<FileCog size={20} />}
      title={t('renameFile.title', { count: items.length })}
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
            {previews.map((p) => (
              <div
                key={p.item.id}
                className={`rename-preview-row ${conflicts.has(p.item.id) ? 'rename-conflict' : ''}`}
              >
                <span className="rename-old">
                  {p.oldStem}
                  {p.ext}
                </span>
                <span className="rename-arrow">→</span>
                <span className="rename-new">
                  {p.newStem}
                  {p.ext}
                </span>
              </div>
            ))}
            {items.length > 8 && (
              <p className="rename-more">
                {t('batchRename.moreCount', { count: items.length - 8 })}
              </p>
            )}
          </div>
          {hasConflicts && (
            <p className="rename-conflict-hint">
              {t('renameFile.conflictHint', { count: conflicts.size })}
            </p>
          )}
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>
          {t('batchRename.cancel')}
        </button>
        <button className="btn btn-primary" onClick={handleApply} disabled={hasConflicts}>
          {t('batchRename.renameAll')}
        </button>
      </div>
    </Modal>
  );
}
