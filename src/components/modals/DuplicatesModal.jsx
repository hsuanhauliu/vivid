import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Trash2, CheckCircle, Image, Video, Music, HardDrive, Loader } from 'lucide-react';
import Modal from '../common/Modal';
import { formatBytes } from '../../utils/format';
import { thumbSrcOf } from '../../utils/path';
import './DuplicatesModal.css';

function ItemCard({ item, isKept, onToggleKeep }) {
  const { t } = useTranslation();
  // Prefer the cached thumbnail (covers video poster frames too, not just
  // images) — only images without one yet fall back to the raw file; audio
  // and thumbnail-less video get the placeholder icon below.
  const src = item.thumb_path
    ? thumbSrcOf(item.thumb_path)
    : item.media_type === 'image'
      ? convertFileSrc(item.file_path)
      : null;
  const TypeIcon =
    item.media_type === 'video' ? Video : item.media_type === 'audio' ? Music : Image;

  return (
    <div
      className={`dup-card ${isKept ? 'dup-card-keep' : 'dup-card-delete'}`}
      onClick={onToggleKeep}
    >
      <div className="dup-card-thumb">
        {src ? (
          <img src={src} alt={item.display_name} className="dup-thumb-img" />
        ) : (
          <div className="dup-thumb-placeholder">
            <TypeIcon size={32} strokeWidth={1} />
          </div>
        )}
        <div className="dup-card-badge">
          {isKept ? (
            <span className="dup-badge dup-badge-keep">
              <CheckCircle size={12} /> {t('duplicates.keep')}
            </span>
          ) : (
            <span className="dup-badge dup-badge-del">
              <Trash2 size={12} /> {t('duplicates.delete')}
            </span>
          )}
        </div>
      </div>
      <div className="dup-card-info">
        <p className="dup-name" title={item.display_name}>
          {item.display_name}
        </p>
        <p className="dup-meta">
          <HardDrive size={11} /> {formatBytes(item.file_size)}
        </p>
        <p className="dup-meta">{item.created_at?.slice(0, 10)}</p>
        <p className="dup-path" title={item.file_path}>
          {item.file_path.split('/').pop()}
        </p>
      </div>
    </div>
  );
}

export default function DuplicatesModal({ collections, onClose, onItemsRemoved }) {
  const { t } = useTranslation();
  // keepSets: Map<groupIndex, Set<id>>  — which IDs to keep in each group
  const [keepSets, setKeepSets] = useState(() => {
    const m = new Map();
    collections.forEach((g, i) => {
      // default: keep the one with largest file_size
      const best = [...g].sort((a, b) => b.file_size - a.file_size)[0];
      m.set(i, new Set([best.id]));
    });
    return m;
  });
  const [deleting, setDeleting] = useState(false);
  const [groupIdx, setGroupIdx] = useState(0);

  const group = collections[groupIdx];

  function toggleKeep(groupI, itemId) {
    setKeepSets((prev) => {
      const next = new Map(prev);
      const kept = new Set(next.get(groupI) ?? []);
      if (kept.has(itemId)) {
        if (kept.size > 1) kept.delete(itemId); // always keep at least one
      } else {
        kept.add(itemId);
      }
      next.set(groupI, kept);
      return next;
    });
  }

  const toDelete = collections.flatMap((g, i) =>
    g.filter((item) => !keepSets.get(i)?.has(item.id)),
  );

  async function handleDelete() {
    if (toDelete.length === 0) {
      onClose();
      return;
    }
    setDeleting(true);
    const removed = [];
    for (const item of toDelete) {
      try {
        await invoke('trash_media', { id: item.id });
        removed.push(item.id);
      } catch (e) {
        console.error('Remove failed:', e);
      }
    }
    setDeleting(false);
    onItemsRemoved(removed);
    onClose();
  }

  if (!collections.length) {
    return (
      <Modal header={false} onClose={onClose} width={340}>
        <div className="modal-confirm">
          <div className="modal-confirm-icon modal-confirm-icon-success">
            <CheckCircle size={20} />
          </div>
          <h3 className="modal-confirm-title">{t('duplicates.noDuplicatesTitle')}</h3>
          <p className="modal-confirm-desc">{t('duplicates.noDuplicatesDesc')}</p>
          <div className="modal-confirm-actions">
            <button className="btn btn-primary" onClick={onClose}>
              {t('duplicates.close')}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal className="dup-modal" onClose={onClose} title={t('duplicates.title')}>
      {/* Group tabs */}
      <div className="dup-group-tabs">
        {collections.map((g, i) => (
          <button
            key={i}
            className={`dup-group-tab ${i === groupIdx ? 'active' : ''}`}
            onClick={() => setGroupIdx(i)}
          >
            {t('duplicates.group', { number: i + 1 })}
            <span className="dup-count-badge">{g.length}</span>
          </button>
        ))}
        <span className="dup-summary">
          {t('duplicates.groupsCount', { count: collections.length })} ·{' '}
          {t('duplicates.toDeleteCount', { count: toDelete.length })}
        </span>
      </div>

      {/* Cards for current group */}
      <div className="dup-cards">
        {group.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            isKept={keepSets.get(groupIdx)?.has(item.id) ?? false}
            onToggleKeep={() => toggleKeep(groupIdx, item.id)}
          />
        ))}
      </div>

      <div className="modal-footer">
        <p className="dup-hint">{t('duplicates.hint')}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>
            {t('duplicates.cancel')}
          </button>
          <button
            className="btn btn-danger"
            onClick={handleDelete}
            disabled={deleting || toDelete.length === 0}
          >
            {deleting ? (
              <>
                <Loader size={13} className="spin" /> {t('duplicates.deleting')}
              </>
            ) : (
              t('duplicates.deleteCount', { count: toDelete.length })
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
