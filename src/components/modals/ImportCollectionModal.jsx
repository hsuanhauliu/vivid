import { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, FolderOpen, BookImage, Disc, Plus, Library, Search, Check, Pencil } from 'lucide-react';
import CollectionAvatar from '../common/CollectionAvatar';
import ScrollArea from '../common/ScrollArea';
import { UNCATEGORIZED_ID } from '../../utils/folders';
import './ImportCollectionModal.css';

const KIND_ICON = { album: BookImage, playlist: Disc };

// A collection cover, falling back to a kind icon (album/playlist) when the
// collection has neither a cover image nor an emoji.
function CollectionRowAvatar({ group, allItems }) {
  const Icon = KIND_ICON[group.kind] ?? Library;
  return (
    <CollectionAvatar
      group={group}
      allItems={allItems}
      size={24}
      radius={6}
      allowAny
      fallback={<Icon size={13} />}
    />
  );
}

/**
 * Import destination chooser — two-pane layout.
 * Left: destination folder (required, searchable).
 * Right: optional album/playlist (searchable), hidden when no collections exist.
 */
export default function ImportCollectionModal({
  paths,
  collections,
  folders,
  allItems,
  defaultFolderId,
  defaultCollectionId,
  onConfirm,
  onClose,
}) {
  const { t } = useTranslation();
  const isSingleFile =
    paths.length === 1 && !paths[0].match(/[/\\]$/) && /\.[^./\\]+$/.test(paths[0]);
  const origName = isSingleFile ? (paths[0].match(/[/\\]([^/\\]+)$/)?.[1] ?? '') : '';
  const ext = origName.includes('.') ? origName.slice(origName.lastIndexOf('.')) : '';
  const origStem = ext ? origName.slice(0, -ext.length) : origName;

  const uncategorized = folders?.find((f) => f.id === UNCATEGORIZED_ID);
  // If dropped while already viewing a folder or collection page, default the
  // destination to that folder/collection instead of Uncategorized/None —
  // dropping a file on Album A's page should land it in Album A.
  const validDefaultFolder =
    defaultFolderId && folders?.some((f) => f.id === defaultFolderId) ? defaultFolderId : null;
  const [folderId, setFolderId] = useState(validDefaultFolder ?? uncategorized?.id ?? null);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderMode, setNewFolderMode] = useState(false); // input visible
  const [newFolderConfirmed, setNewFolderConfirmed] = useState(false); // confirmed, show as row
  const [folderSearch, setFolderSearch] = useState('');
  const [collectionId, setCollectionId] = useState(() => {
    const defaultColl = collections?.find((g) => g.id === defaultCollectionId);
    if (!defaultColl) return 'none';
    const pathExt = (p) => (p.split('.').pop() || '').toLowerCase();
    const audio = new Set([
      'mp3',
      'wav',
      'flac',
      'm4a',
      'aac',
      'ogg',
      'opus',
      'wma',
      'aiff',
      'aif',
      'alac',
    ]);
    const video = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']);
    const image = new Set([
      'jpg',
      'jpeg',
      'png',
      'gif',
      'webp',
      'heic',
      'heif',
      'bmp',
      'tiff',
      'avif',
    ]);
    const hasAudio = paths.some((p) => audio.has(pathExt(p)));
    const hasVideo = paths.some((p) => video.has(pathExt(p)));
    const hasImage = paths.some((p) => image.has(pathExt(p)));
    const fits =
      defaultColl.kind === 'album'
        ? hasImage || hasVideo
        : defaultColl.kind === 'playlist'
          ? hasAudio || hasVideo
          : true;
    return fits ? defaultColl.id : 'none';
  });
  const [collSearch, setCollSearch] = useState('');
  const [filename, setFilename] = useState(origStem);
  const nameInputRef = useRef(null);

  function pickFolder(id) {
    setNewFolderMode(false);
    setNewFolderConfirmed(false);
    setFolderId(id);
  }

  function openNewFolder() {
    setFolderId(null);
    setNewFolderMode(true);
    setNewFolderConfirmed(false);
  }

  function confirmNewFolder() {
    if (!newFolderName.trim()) {
      cancelNewFolder();
      return;
    }
    setNewFolderMode(false);
    setNewFolderConfirmed(true);
  }

  function cancelNewFolder() {
    setNewFolderMode(false);
    setNewFolderConfirmed(false);
    setFolderId(uncategorized?.id ?? null);
  }

  function editNewFolder() {
    setNewFolderConfirmed(false);
    setNewFolderMode(true);
  }

  function handleConfirm() {
    const finalFilename =
      isSingleFile && filename.trim() && filename.trim() !== origStem
        ? filename.trim() + ext
        : null;
    onConfirm({
      folderId: newFolderMode || newFolderConfirmed ? null : folderId,
      newFolderName:
        (newFolderMode || newFolderConfirmed) && newFolderName.trim() ? newFolderName.trim() : null,
      collectionId: collectionId !== 'none' ? collectionId : null,
      filename: finalFilename,
    });
  }

  const folderList = useMemo(
    () =>
      [...(folders ?? [])].sort((a, b) => {
        if (a.id === UNCATEGORIZED_ID) return -1;
        if (b.id === UNCATEGORIZED_ID) return 1;
        return a.rel_path.localeCompare(b.rel_path);
      }),
    [folders],
  );

  const filteredFolders = useMemo(() => {
    const q = folderSearch.trim().toLowerCase();
    return q
      ? folderList.filter(
          (f) => f.name.toLowerCase().includes(q) || f.rel_path.toLowerCase().includes(q),
        )
      : folderList;
  }, [folderList, folderSearch]);

  const AUDIO_EXTS = new Set([
    'mp3',
    'wav',
    'flac',
    'm4a',
    'aac',
    'ogg',
    'opus',
    'wma',
    'aiff',
    'aif',
    'alac',
  ]);
  const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']);
  const IMAGE_EXTS = new Set([
    'jpg',
    'jpeg',
    'png',
    'gif',
    'webp',
    'heic',
    'heif',
    'bmp',
    'tiff',
    'avif',
  ]);
  const pathExt = (p) => (p.split('.').pop() || '').toLowerCase();
  const hasAudio = useMemo(() => paths.some((p) => AUDIO_EXTS.has(pathExt(p))), [paths]);
  const hasVideo = useMemo(() => paths.some((p) => VIDEO_EXTS.has(pathExt(p))), [paths]);
  const hasImage = useMemo(() => paths.some((p) => IMAGE_EXTS.has(pathExt(p))), [paths]);
  // Albums: images or video, but not mixed with audio (albums don't accept
  // audio files). Playlists: audio or video, but not mixed with images
  // (playlists don't accept images) — video alone is ambiguous so it's
  // offered for both, matching DownloadModal's ytdlpCollectionKinds.
  const showAlbums = (hasImage || hasVideo) && !hasAudio;
  const showPlaylists = (hasAudio || hasVideo) && !hasImage;

  const pinned = useMemo(
    () =>
      collections.filter((g) => {
        // album_group only holds other albums, never actual files — it's
        // never a valid import destination regardless of pin state.
        if (g.kind === 'album') return showAlbums && g.sidebar_pin;
        if (g.kind === 'playlist') return showPlaylists && g.sidebar_pin;
        return false;
      }),
    [collections, showAlbums, showPlaylists],
  );
  const albums = useMemo(() => collections.filter((g) => g.kind === 'album'), [collections]);
  const playlists = useMemo(() => collections.filter((g) => g.kind === 'playlist'), [collections]);
  const hasCollections =
    pinned.length + (showAlbums ? albums.length : 0) + (showPlaylists ? playlists.length : 0) > 0;

  const collSections = useMemo(() => {
    const q = collSearch.trim().toLowerCase();
    const filter = (items) => (q ? items.filter((g) => g.name.toLowerCase().includes(q)) : items);
    return [
      {
        key: 'pinned',
        label: t('importModal.pinnedCollections'),
        showType: true,
        items: filter(pinned),
      },
      ...(showAlbums
        ? [
            {
              key: 'albums',
              label: t('importModal.albums'),
              showType: false,
              items: filter(albums),
            },
          ]
        : []),
      ...(showPlaylists
        ? [
            {
              key: 'playlists',
              label: t('importModal.playlists'),
              showType: false,
              items: filter(playlists),
            },
          ]
        : []),
    ].filter((s) => s.items.length > 0);
  }, [pinned, albums, playlists, showAlbums, showPlaylists, collSearch, t]);

  const selectedFolder = newFolderConfirmed
    ? { name: newFolderName.trim(), rel_path: newFolderName.trim() }
    : folderList.find((f) => f.id === folderId);
  const selectedColl = collections.find((g) => g.id === collectionId);
  const canImport = newFolderMode
    ? newFolderName.trim().length > 0
    : newFolderConfirmed || !!folderId;

  return (
    <div className="modal-backdrop">
      <div
        className={`igm-modal ${hasCollections ? 'igm-two-pane' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="igm-header">
          <div className="igm-header-left">
            <span className="igm-title">{t('importModal.title', { count: paths.length })}</span>
            <span className="igm-subtitle">
              {selectedFolder ? `→ ${selectedFolder.rel_path}` : ''}
              {selectedColl ? ` · ${selectedColl.name}` : ''}
            </span>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* Filename — full-width row, single file only */}
        {isSingleFile && (
          <div className="igm-filename-top">
            <span className="igm-filename-label">{t('importModal.filename')}</span>
            <div className="igm-filename-field">
              <input
                className="igm-filename-input"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder={origStem}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirm();
                }}
              />
              {ext && <span className="igm-filename-ext">{ext}</span>}
            </div>
          </div>
        )}

        {/* Two-pane body */}
        <div className="igm-panes">
          {/* ── Left: folder picker ── */}
          <div className="igm-pane">
            <div className="igm-pane-header">
              <span className="igm-pane-title">{t('importModal.destinationFolder')}</span>
            </div>
            {folderList.length > 6 && (
              <div className="igm-search">
                <Search size={12} />
                <input
                  className="igm-search-input"
                  placeholder={t('importModal.searchFolders')}
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                />
              </div>
            )}
            <ScrollArea className="igm-list" innerClassName="igm-list-inner">
              {filteredFolders.map((f) => {
                const active = !newFolderMode && !newFolderConfirmed && folderId === f.id;
                const depth = (f.rel_path.match(/\//g) || []).length;
                return (
                  <button
                    key={f.id}
                    className={`igm-row ${active ? 'igm-row-active' : ''}`}
                    onClick={() => pickFolder(f.id)}
                  >
                    <div
                      className="igm-row-icon igm-row-icon-folder"
                      style={{ marginLeft: depth * 10 }}
                    >
                      <FolderOpen size={14} />
                    </div>
                    <span className="igm-row-name">{f.name}</span>
                    {active && <Check size={13} className="igm-row-check" />}
                  </button>
                );
              })}
              {filteredFolders.length === 0 && folderSearch && (
                <div className="igm-empty">{t('importModal.noFoldersMatch')}</div>
              )}

              {/* New folder — confirmed state shows as a regular selected row */}
              {newFolderConfirmed ? (
                <button className="igm-row igm-row-active" onClick={editNewFolder}>
                  <div className="igm-row-icon igm-row-icon-new">
                    <Plus size={14} />
                  </div>
                  <span className="igm-row-name">{newFolderName.trim()}</span>
                  <Pencil size={11} className="igm-row-check" style={{ opacity: 0.6 }} />
                </button>
              ) : newFolderMode ? (
                <div className="igm-row igm-row-active igm-new-folder-input-row">
                  <div className="igm-row-icon igm-row-icon-new">
                    <Plus size={14} />
                  </div>
                  <input
                    ref={nameInputRef}
                    className="igm-name-input"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    autoFocus
                    placeholder={t('importModal.newFolderName')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        confirmNewFolder();
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelNewFolder();
                      }
                    }}
                    onBlur={confirmNewFolder}
                  />
                </div>
              ) : (
                <button className="igm-row" onClick={openNewFolder}>
                  <div className="igm-row-icon igm-row-icon-new">
                    <Plus size={14} />
                  </div>
                  <span className="igm-row-name">{t('importModal.newFolder')}</span>
                </button>
              )}
            </ScrollArea>
          </div>

          {/* ── Right: collection picker (only when collections exist) ── */}
          {hasCollections && (
            <div className="igm-pane igm-pane-right">
              <div className="igm-pane-header">
                <span className="igm-pane-title">
                  {t('importModal.collection')}{' '}
                  <span className="igm-pane-optional">{t('importModal.optional')}</span>
                </span>
              </div>
              {pinned.length + albums.length + playlists.length > 6 && (
                <div className="igm-search">
                  <Search size={12} />
                  <input
                    className="igm-search-input"
                    placeholder={t('importModal.searchCollections')}
                    value={collSearch}
                    onChange={(e) => setCollSearch(e.target.value)}
                  />
                </div>
              )}
              <ScrollArea className="igm-list" innerClassName="igm-list-inner">
                <button
                  className={`igm-row ${collectionId === 'none' ? 'igm-row-active' : ''}`}
                  onClick={() => setCollectionId('none')}
                >
                  <div className="igm-row-icon igm-row-icon-folder">
                    <Library size={14} />
                  </div>
                  <span className="igm-row-name">{t('importModal.none')}</span>
                  {collectionId === 'none' && <Check size={13} className="igm-row-check" />}
                </button>
                {collSections.map(({ key, label, showType, items }) => (
                  <div key={key}>
                    <div className="igm-section-label">{label}</div>
                    {items.map((g) => {
                      const active = collectionId === g.id;
                      return (
                        <button
                          key={g.id}
                          className={`igm-row ${active ? 'igm-row-active' : ''}`}
                          onClick={() => setCollectionId(g.id)}
                        >
                          <CollectionRowAvatar group={g} allItems={allItems} />
                          <span className="igm-row-name">{g.name}</span>
                          {showType && (
                            <span className="igm-row-type">
                              {g.kind === 'album'
                                ? t('importModal.album')
                                : g.kind === 'playlist'
                                  ? t('importModal.playlist')
                                  : t('importModal.collectionType')}
                            </span>
                          )}
                          {active && <Check size={13} className="igm-row-check" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {collSections.length === 0 && collSearch && (
                  <div className="igm-empty">{t('importModal.noCollectionsMatch')}</div>
                )}
              </ScrollArea>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="igm-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('importModal.cancel')}
          </button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={!canImport}>
            {t('importModal.import')}
          </button>
        </div>
      </div>
    </div>
  );
}
