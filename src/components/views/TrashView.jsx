import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Trash2, RotateCcw, AlertTriangle, Music, Video, Image, PackageX } from 'lucide-react';
import { formatBytes } from '../../utils/format';
import './TrashView.css';

function formatTimestamp(isoStr, t, lng) {
  if (!isoStr) return t('trash.dateUnknown');
  const d = new Date(isoStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0)
    return t('trash.dateToday', {
      time: d.toLocaleTimeString(lng, { hour: 'numeric', minute: '2-digit' }),
    });
  if (diffDays === 1) return d.toLocaleDateString(lng, { weekday: 'long' });
  if (diffDays < 7) return t('trash.daysAgo', { count: diffDays });
  return d.toLocaleDateString(lng, { month: 'short', day: 'numeric', year: 'numeric' });
}

const TYPE_ICONS = { image: Image, video: Video, audio: Music };
const TYPE_COLORS = {
  image: 'var(--accent)',
  video: '#3b82f6',
  audio: '#f59e0b',
};
const TYPE_LABEL_KEYS = { image: 'trash.typeImage', video: 'trash.typeVideo', audio: 'trash.typeAudio' };

function TrashThumb({ item }) {
  const [failed, setFailed] = useState(false);
  const isImage = item.media_type === 'image';
  const TypeIcon = TYPE_ICONS[item.media_type] ?? Image;
  const color = TYPE_COLORS[item.media_type] ?? TYPE_COLORS.audio;

  if (isImage && !failed) {
    return (
      <img
        src={convertFileSrc(item.file_path)}
        alt={item.display_name}
        className="trash-thumb-img"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="trash-thumb-icon" style={{ background: `${color}18`, color }}>
      <TypeIcon size={18} />
    </div>
  );
}

function TrashRow({ item, onRestore, onDeleteForever }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="trash-row">
      <div className="trash-thumb">
        <TrashThumb item={item} />
      </div>

      <div className="trash-info">
        <p className="trash-item-name" title={item.file_path}>
          {item.display_name}
        </p>
        <div className="trash-item-meta">
          <span className={`trash-type-chip trash-type-${item.media_type}`}>
            {t(TYPE_LABEL_KEYS[item.media_type] ?? 'trash.typeImage')}
          </span>
          <span className="trash-meta-size">{formatBytes(item.file_size)}</span>
          <span className="trash-meta-dot">·</span>
          <span className="trash-meta-date">
            {formatTimestamp(item.deleted_at, t, i18n.language)}
          </span>
        </div>
      </div>

      <div className="trash-actions">
        <button
          className="btn btn-sm btn-secondary trash-restore-btn"
          title={t('trash.restore')}
          onClick={() => onRestore(item.id)}
        >
          <RotateCcw size={13} />
        </button>
        <button
          className="btn btn-sm btn-danger-outline trash-delete-btn"
          title={t('trash.deleteForever')}
          onClick={() => onDeleteForever(item)}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export default function TrashView({ retentionDays, onItemsRestored, onItemsDeleted }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [confirmRestoreAll, setConfirmRestoreAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const trashed = await invoke('get_trash');
      setItems(trashed);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRestore(id) {
    try {
      await invoke('restore_media', { id });
      setItems((prev) => prev.filter((it) => it.id !== id));
      onItemsRestored?.([id]);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeleteForever(id) {
    try {
      await invoke('remove_media', { id });
      setItems((prev) => prev.filter((it) => it.id !== id));
      onItemsDeleted?.([id]);
    } catch (e) {
      console.error(e);
    }
    setConfirmDelete(null);
  }

  async function handleRestoreAll() {
    try {
      const ids = items.map((it) => it.id);
      await Promise.all(ids.map((id) => invoke('restore_media', { id })));
      setItems([]);
      onItemsRestored?.(ids);
    } catch (e) {
      console.error(e);
    }
    setConfirmRestoreAll(false);
  }

  async function handleEmptyTrash() {
    try {
      const ids = items.map((it) => it.id);
      await invoke('empty_trash');
      setItems([]);
      onItemsDeleted?.(ids);
    } catch (e) {
      console.error(e);
    }
    setConfirm(false);
  }

  const totalSize = items.reduce((sum, i) => sum + (i.file_size || 0), 0);

  const subtitle = loading
    ? t('common.loading')
    : items.length === 0
      ? t('trash.subtitleEmpty')
      : t('trash.subtitle', { count: items.length, size: formatBytes(totalSize) });

  return (
    <div className="trash-view">
      {/* Page header */}
      <div className="trash-page-header">
        <div className="trash-page-title-row">
          <div className="trash-page-icon">
            <Trash2 size={20} />
          </div>
          <div>
            <h2 className="trash-page-title">{t('trash.title')}</h2>
            <p className="trash-page-subtitle">{subtitle}</p>
          </div>
        </div>
        {items.length > 0 && (
          <div className="trash-header-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmRestoreAll(true)}>
              <RotateCcw size={13} />
              {t('trash.restoreAll')}
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => setConfirm(true)}>
              <Trash2 size={13} />
              {t('trash.emptyTrash')}
            </button>
          </div>
        )}
      </div>

      <div className="trash-retention-banner">
        <span>
          {retentionDays > 0 ? (
            <>
              {t('trash.retentionBannerBefore')}{' '}
              <strong>
                {retentionDays} {t('trash.retentionDay', { count: retentionDays })}
              </strong>{' '}
              {t('trash.retentionBannerAfter')}
            </>
          ) : (
            t('trash.retentionNeverBanner')
          )}
        </span>
      </div>

      {loading ? (
        <div className="trash-loading">
          <div className="trash-loading-spinner" />
          <p>{t('trash.loadingItems')}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="trash-empty-state">
          <div className="trash-empty-icon">
            <PackageX size={48} strokeWidth={1} />
          </div>
          <h3>{t('trash.nothingInTrash')}</h3>
          <p>{t('trash.nothingInTrashDesc')}</p>
        </div>
      ) : (
        <div className="page-scroll">
          <div className="page-panel">
            <div className="trash-list">
              {items.map((item) => (
                <TrashRow
                  key={item.id}
                  item={item}
                  onRestore={handleRestore}
                  onDeleteForever={setConfirmDelete}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Restore-all confirmation */}
      {confirmRestoreAll && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmRestoreAll(false);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div
              className="modal-icon"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              <RotateCcw size={20} />
            </div>
            <h3 className="modal-title">{t('trash.confirmRestoreTitle')}</h3>
            <p className="modal-message">{t('trash.confirmRestore', { count: items.length })}</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmRestoreAll(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleRestoreAll}>
                {t('trash.restoreAll')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single-item delete confirmation */}
      {confirmDelete && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmDelete(null);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">
              <Trash2 size={20} />
            </div>
            <h3 className="modal-title">{t('trash.confirmDeleteTitle')}</h3>
            <p className="modal-message">
              {t('trash.confirmDelete', { name: confirmDelete.display_name })}
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-danger-solid"
                onClick={() => handleDeleteForever(confirmDelete.id)}
              >
                {t('trash.deleteForever')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty-trash confirmation */}
      {confirm && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirm(false);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">
              <AlertTriangle size={20} />
            </div>
            <h3 className="modal-title">{t('trash.confirmEmptyTitle')}</h3>
            <p className="modal-message">
              {t('trash.confirmEmpty', { count: items.length, size: formatBytes(totalSize) })}
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirm(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-danger-solid" onClick={handleEmptyTrash}>
                {t('trash.emptyTrash')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
