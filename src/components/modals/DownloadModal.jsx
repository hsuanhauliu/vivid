import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Link,
  Music,
  Video,
  Image,
  ListMusic,
  FolderOpen,
  ChevronDown,
  FolderPlus,
  ListPlus,
  Check as CheckIcon,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import Modal from '../common/Modal';
import { UNCATEGORIZED_ID } from '../../utils/folders';

const KIND_ICONS = { playlist: ListMusic, album: Image };

// Picks an existing playlist/album collection, with optional inline "New playlist" creation.
// Pass `onNew` to enable the create-new row; it receives the new name string.
function CollectionPicker({
  collections,
  value,
  onChange,
  filterKinds,
  onNew,
  newLabel,
  newPlaceholder,
  pendingNewName,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef(null);
  const newInputRef = useRef(null);

  useEffect(() => {
    function onDown(e) {
      if (!ref.current?.contains(e.target)) {
        setOpen(false);
        setCreating(false);
        setNewName('');
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (creating) newInputRef.current?.focus();
  }, [creating]);

  const kindLabel = (kind) => t(`download.kind${kind.charAt(0).toUpperCase() + kind.slice(1)}`);
  const eligible = collections.filter((g) => !filterKinds || filterKinds.includes(g.kind));
  const selected = eligible.find((g) => g.id === value);

  function commitNew() {
    const name = newName.trim();
    if (!name) return;
    onNew?.(name);
    setCreating(false);
    setNewName('');
    setOpen(false);
  }

  return (
    <div className="collection-picker" ref={ref}>
      <button type="button" className="collection-picker-btn" onClick={() => setOpen((o) => !o)}>
        {selected ? (
          <>
            {(() => {
              const Icon = KIND_ICONS[selected.kind] || ListMusic;
              return <Icon size={13} />;
            })()}
            <span className="collection-picker-name">{selected.name}</span>
            <span className="collection-picker-kind">{kindLabel(selected.kind)}</span>
          </>
        ) : pendingNewName ? (
          <>
            <ListPlus size={13} style={{ flexShrink: 0, color: 'var(--accent)' }} />
            <span className="collection-picker-name" style={{ color: 'var(--accent)' }}>
              {pendingNewName}
            </span>
            <span className="collection-picker-kind">{t('download.createNew')}</span>
          </>
        ) : (
          <span className="collection-picker-placeholder">{t('download.none')}</span>
        )}
        <ChevronDown size={13} className={`collection-picker-chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="collection-picker-menu">
          <button
            type="button"
            className={`collection-picker-item ${!value ? 'active' : ''}`}
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            <span className="collection-picker-none">{t('download.none')}</span>
          </button>
          {eligible.map((g) => {
            const Icon = KIND_ICONS[g.kind] || ListMusic;
            return (
              <button
                key={g.id}
                type="button"
                className={`collection-picker-item ${value === g.id ? 'active' : ''}`}
                onClick={() => {
                  onChange(g.id);
                  setOpen(false);
                }}
              >
                <Icon size={13} className="collection-picker-item-icon" />
                <span className="collection-picker-item-name">{g.name}</span>
                <span className="collection-picker-item-kind">{kindLabel(g.kind)}</span>
              </button>
            );
          })}

          {onNew && (
            <>
              <div className="collection-picker-divider" />
              {creating ? (
                <div className="collection-picker-new-form" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={newInputRef}
                    className="collection-picker-new-input"
                    type="text"
                    placeholder={newPlaceholder ?? t('download.collectionPlaceholder')}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        commitNew();
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setCreating(false);
                        setNewName('');
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="collection-picker-new-confirm"
                    disabled={!newName.trim()}
                    onClick={(e) => {
                      e.stopPropagation();
                      commitNew();
                    }}
                  >
                    <CheckIcon size={13} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="collection-picker-item collection-picker-new-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreating(true);
                  }}
                >
                  <ListPlus size={13} className="collection-picker-item-icon" />
                  <span className="collection-picker-item-name">
                    {newLabel ?? t('download.createNew')}
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Picks a destination folder from the on-disk folder tree, with inline "New folder" creation.
function FolderPicker({ folders: initialFolders, value, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState(initialFolders ?? []);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');
  const ref = useRef(null);
  const newInputRef = useRef(null);

  useEffect(() => {
    setFolders(initialFolders ?? []);
  }, [initialFolders]);

  useEffect(() => {
    function onDown(e) {
      if (!ref.current?.contains(e.target)) {
        setOpen(false);
        setCreating(false);
        setNewName('');
        setCreateError('');
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (creating) newInputRef.current?.focus();
  }, [creating]);

  const ordered = useMemo(
    () =>
      [...folders].sort((a, b) => {
        if (a.id === UNCATEGORIZED_ID) return -1;
        if (b.id === UNCATEGORIZED_ID) return 1;
        return a.rel_path.localeCompare(b.rel_path);
      }),
    [folders],
  );

  const selected = ordered.find((f) => f.id === value);

  async function handleCreate(e) {
    e.preventDefault();
    e.stopPropagation();
    const name = newName.trim();
    if (!name) return;
    setCreateError('');
    try {
      const folder = await invoke('create_folder', { name, parentId: null });
      setFolders((prev) => [...prev, folder]);
      onChange(folder.id);
      setCreating(false);
      setNewName('');
      setOpen(false);
    } catch (err) {
      setCreateError(String(err).replace('DUPLICATE_NAME', t('download.folderExists')));
    }
  }

  return (
    <div className="collection-picker" ref={ref}>
      <button type="button" className="collection-picker-btn" onClick={() => setOpen((o) => !o)}>
        <FolderOpen size={13} />
        <span className="collection-picker-name">
          {selected ? selected.name : t('download.uncategorized')}
        </span>
        <ChevronDown size={13} className={`collection-picker-chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="collection-picker-menu">
          {ordered.map((f) => {
            const depth = (f.rel_path.match(/\//g) || []).length;
            return (
              <button
                key={f.id}
                type="button"
                className={`collection-picker-item ${value === f.id ? 'active' : ''}`}
                onClick={() => {
                  onChange(f.id);
                  setOpen(false);
                }}
              >
                <FolderOpen
                  size={13}
                  className="collection-picker-item-icon"
                  style={{ marginLeft: depth * 12 }}
                />
                <span className="collection-picker-item-name">{f.name}</span>
              </button>
            );
          })}
          <div className="collection-picker-divider" />
          {creating ? (
            <div className="collection-picker-new-form" onClick={(e) => e.stopPropagation()}>
              <input
                ref={newInputRef}
                className="collection-picker-new-input"
                type="text"
                placeholder={t('download.newFolderPlaceholder')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCreate(e);
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setCreating(false);
                    setNewName('');
                    setCreateError('');
                  }
                }}
              />
              <button
                type="button"
                className="collection-picker-new-confirm"
                disabled={!newName.trim()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCreate(e);
                }}
              >
                <CheckIcon size={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="collection-picker-item collection-picker-new-btn"
              onClick={(e) => {
                e.stopPropagation();
                setCreating(true);
              }}
            >
              <FolderPlus size={13} className="collection-picker-item-icon" />
              <span className="collection-picker-item-name">{t('download.newFolder')}</span>
            </button>
          )}
          {createError && <p className="collection-picker-error">{createError}</p>}
        </div>
      )}
    </div>
  );
}

export default function DownloadModal({ onClose, collections = [], folders = [] }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('direct'); // 'direct' | 'ytdlp' | 'playlist'
  const [ytFormat, setYtFormat] = useState('audio'); // 'audio' | 'video'
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [ytFilename, setYtFilename] = useState('');
  // Empty folderId means "Uncategorized" — the backend defaults a null folder there.
  const [folderId, setFolderId] = useState('');
  const [collectionId, setCollectionId] = useState(''); // audio playlist collection (single track)
  const [ytdlpNewCollectionName, setYtdlpNewCollectionName] = useState('');
  const [playlistCollectionName, setPlaylistCollectionName] = useState('');
  const [playlistCollectionId, setPlaylistCollectionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submittedCount, setSubmittedCount] = useState(0);
  const submittedTimerRef = useRef(null);

  function resetForm() {
    setUrl('');
    setFilename('');
    setYtFilename('');
    setCollectionId('');
    setYtdlpNewCollectionName('');
    setPlaylistCollectionName('');
    setPlaylistCollectionId('');
    setFolderId('');
    setError('');
  }

  function switchTab(t) {
    resetForm();
    setTab(t);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setError('');
    setLoading(true);
    try {
      if (tab === 'playlist') {
        await invoke('start_playlist_bg', {
          url: trimmed,
          collectionName: playlistCollectionId ? null : playlistCollectionName.trim() || null,
          collectionId: playlistCollectionId || null,
          format: ytFormat,
          folderId: folderId || null,
        });
      } else if (tab === 'ytdlp') {
        await invoke('start_ytdlp_bg', {
          url: trimmed,
          format: ytFormat,
          filename: ytFilename.trim() || null,
          folderId: folderId || null,
          collectionId: collectionId || null,
          collectionName: collectionId ? null : ytdlpNewCollectionName.trim() || null,
        });
      } else {
        await invoke('start_download_bg', {
          url: trimmed,
          filename: filename.trim() || null,
          folderId: folderId || null,
        });
      }
      // Background task started — clear URL only, keep other settings for repeat use.
      setUrl('');
      setError('');
      setSubmittedCount((c) => c + 1);
      clearTimeout(submittedTimerRef.current);
      submittedTimerRef.current = setTimeout(() => setSubmittedCount(0), 4000);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const isVideo = ytFormat === 'video';

  const submitLabel =
    tab === 'playlist'
      ? isVideo
        ? t('download.submitPlaylistVideo')
        : t('download.submitPlaylistAudio')
      : tab === 'ytdlp'
        ? isVideo
          ? t('download.submitVideo')
          : t('download.submitAudio')
        : t('download.submitDownload');

  // For ytdlp tab: audio → playlists only; video → both albums and playlists.
  const ytdlpCollectionKinds = ytFormat === 'audio' ? ['playlist'] : ['album', 'playlist'];
  const ytdlpEligibleCollections = collections.filter((g) => ytdlpCollectionKinds.includes(g.kind));
  // Playlist tab: only audio tracks go into playlists.
  const showPlaylistCollection = ytFormat === 'audio';

  return (
    <Modal wide onClose={onClose} icon={<Link size={20} />} title={t('download.title')}>
      {/* Tab bar */}
      <div className="download-tab-bar">
        <button
          className={`download-tab ${tab === 'direct' ? 'active' : ''}`}
          onClick={() => switchTab('direct')}
        >
          <Image size={13} /> {t('download.tabImage')}
        </button>
        <button
          className={`download-tab ${tab === 'ytdlp' ? 'active' : ''}`}
          onClick={() => switchTab('ytdlp')}
        >
          <Music size={13} /> {t('download.tabMedia')}
        </button>
        <button
          className={`download-tab ${tab === 'playlist' ? 'active' : ''}`}
          onClick={() => switchTab('playlist')}
        >
          <ListMusic size={13} /> {t('download.tabPlaylist')}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="modal-form">
        <div className="field">
          <label>{t('download.urlLabel')}</label>
          <input
            className="input"
            type="url"
            placeholder={
              tab === 'playlist'
                ? 'https://www.youtube.com/playlist?list=…'
                : tab === 'ytdlp'
                  ? 'https://www.youtube.com/watch?v=…'
                  : 'https://example.com/photo.jpg'
            }
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
            required
          />
          {(tab === 'ytdlp' || tab === 'playlist') && (
            <p className="field-hint" style={{ marginTop: 4, lineHeight: 1.4 }}>
              {tab === 'playlist' ? t('download.playlistHint') : t('download.ytdlpHint')}
            </p>
          )}
        </div>

        {/* Format toggle for ytdlp and playlist */}
        {(tab === 'ytdlp' || tab === 'playlist') && (
          <div className="field">
            <label>{t('download.formatLabel')}</label>
            <div className="download-format-toggle">
              <button
                type="button"
                className={`download-format-btn ${ytFormat === 'audio' ? 'active' : ''}`}
                onClick={() => {
                  setYtFormat('audio');
                  setCollectionId('');
                  setYtdlpNewCollectionName('');
                  setPlaylistCollectionId('');
                }}
              >
                <Music size={13} /> {t('download.audioFormat')}
              </button>
              <button
                type="button"
                className={`download-format-btn ${ytFormat === 'video' ? 'active' : ''}`}
                onClick={() => {
                  setYtFormat('video');
                  setCollectionId('');
                  setYtdlpNewCollectionName('');
                  setPlaylistCollectionId('');
                }}
              >
                <Video size={13} /> {t('download.videoFormat')}
              </button>
            </div>
          </div>
        )}

        {/* Save-as filename (single track only) */}
        {tab === 'direct' && (
          <div className="field">
            <label>
              {t('download.saveAs')} <span className="field-hint">({t('download.optional')})</span>
            </label>
            <input
              className="input"
              type="text"
              placeholder={t('download.photoPlaceholder')}
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />
          </div>
        )}
        {tab === 'ytdlp' && (
          <div className="field">
            <label>
              {t('download.saveAs')}{' '}
              <span className="field-hint">({t('download.optionalNoExt')})</span>
            </label>
            <input
              className="input"
              type="text"
              placeholder={
                ytFormat === 'video'
                  ? t('download.videoPlaceholder')
                  : t('download.songPlaceholder')
              }
              value={ytFilename}
              onChange={(e) => setYtFilename(e.target.value)}
            />
          </div>
        )}

        {/* Destination folder — applies to every download mode */}
        {folders.length > 0 && (
          <div className="field">
            <label>{t('download.saveToFolder')}</label>
            <FolderPicker folders={folders} value={folderId} onChange={setFolderId} />
          </div>
        )}

        {/* Add to collection — single track; audio→playlists, video→albums+playlists */}
        {tab === 'ytdlp' && (
          <div className="field">
            <label>
              {t('download.addToCollection')}{' '}
              <span className="field-hint">({t('download.optional')})</span>
            </label>
            <CollectionPicker
              collections={collections}
              value={collectionId}
              onChange={(id) => {
                setCollectionId(id);
                setYtdlpNewCollectionName('');
              }}
              filterKinds={ytdlpCollectionKinds}
              onNew={(name) => {
                setYtdlpNewCollectionName(name);
                setCollectionId('');
              }}
              pendingNewName={!collectionId ? ytdlpNewCollectionName : ''}
              newLabel={t('download.createNew')}
              newPlaceholder={t('download.collectionPlaceholder')}
            />
          </div>
        )}

        {/* Playlist: save to playlist (audio only) — existing picker + inline create */}
        {tab === 'playlist' && showPlaylistCollection && (
          <div className="field">
            <label>
              {t('download.saveToPlaylist')}{' '}
              <span className="field-hint">({t('download.optional')})</span>
            </label>
            <CollectionPicker
              collections={collections}
              value={playlistCollectionId}
              onChange={(id) => {
                setPlaylistCollectionId(id);
                setPlaylistCollectionName('');
              }}
              filterKinds={['playlist']}
              onNew={(name) => {
                setPlaylistCollectionName(name);
                setPlaylistCollectionId('');
              }}
              pendingNewName={!playlistCollectionId ? playlistCollectionName : ''}
              newLabel={t('download.createNew')}
              newPlaceholder={t('download.collectionPlaceholder')}
            />
          </div>
        )}

        {error && <p className="modal-error">{error}</p>}
        {submittedCount > 0 && !error && (
          <p className="modal-submitted-notice">
            <CheckIcon size={13} />
            {submittedCount === 1
              ? t('download.downloadStarted')
              : t('download.downloadStartedN', { count: submittedCount })}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
            {t('download.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading || !url.trim()}>
            {loading ? (
              <>
                <span className="loading-dot" />
                {t('download.starting')}
              </>
            ) : (
              <>
                <Download size={14} />
                {submitLabel}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
