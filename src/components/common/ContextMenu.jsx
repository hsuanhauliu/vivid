import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { folderIdOf, UNCATEGORIZED_ID } from '../../utils/folders';
import {
  Info,
  Star,
  Trash2,
  Copy,
  Headphones,
  Download,
  FileOutput,
  Image,
  Tag,
  Share2,
  ScanSearch,
  Pencil,
  FileCog,
  Columns2,
  ShieldOff,
  FolderInput,
  FolderMinus,
  FolderOpen,
  FolderTree,
  ChevronLeft,
  Check,
  Search,
} from 'lucide-react';
import { COLOR_LABELS } from './FilterBar';
import CollectionAvatar from './CollectionAvatar';
import useDismiss from '../../hooks/useDismiss';
import './ContextMenu.css';

const IMAGE_FORMATS = [
  { ext: 'jpg', label: 'JPEG' },
  { ext: 'png', label: 'PNG' },
  { ext: 'webp', label: 'WebP' },
  { ext: 'bmp', label: 'BMP' },
  { ext: 'tiff', label: 'TIFF' },
];

const MAX_VISIBLE = 8; // show up to this many before "More…"

export default function ContextMenu({
  x,
  y,
  item,
  collections,
  diskFolders,
  allItems,
  onClose,
  onOpen,
  onViewDetails,
  onStarToggle,
  onRemove,
  onPlayAsAudio,
  onColorLabel,
  onShare,
  onFindSimilar,
  onCompare,
  onSetCollection,
  onMoveToFolder,
  onSetAudioCover,
  onRemoveAudioCover,
  activeCollection,
  onSetCover,
  onEdit,
  onRenameFile,
  onError,
}) {
  const { t } = useTranslation();
  const ref = useRef(null);
  // mode: 'main' | 'color' | 'format' | 'move' | 'movefolder'
  const [mode, setMode] = useState('main');
  const [chosenFormat, setChosenFormat] = useState(null);
  const [showAllCollections, setShowAllCollections] = useState(false);
  const [folderSearch, setFolderSearch] = useState('');

  useDismiss(ref, onClose);

  const isImage = item.media_type === 'image';
  const isVideo = item.media_type === 'video';
  const isAudio = item.media_type === 'audio';
  const isGif = (item.file_path || '').toLowerCase().endsWith('.gif');

  const albums = collections?.filter((g) => g.kind === 'album') ?? [];
  const playlists = collections?.filter((g) => g.kind === 'playlist') ?? [];

  // Build collection list relevant to this item type
  const collectionItems = [
    ...(albums.length > 0 && (isImage || isVideo) ? [{ _header: 'Photo Albums' }, ...albums] : []),
    ...(playlists.length > 0 && isAudio ? [{ _header: 'Playlists' }, ...playlists] : []),
  ];
  const realCollections = collectionItems.filter((c) => !c._header);
  const visibleCollections = showAllCollections
    ? collectionItems
    : collectionItems.slice(0, MAX_VISIBLE + Math.ceil(MAX_VISIBLE * 0.5));
  const hasMore = !showAllCollections && realCollections.length > MAX_VISIBLE;

  // Anchor the menu at the cursor; only shift it up/left by the exact overflow
  // amount so it stays in view. Measured from the real rendered size after each
  // mode switch, so a short submenu sits right next to the cursor instead of
  // floating far above it (the old fixed-height estimate caused that jump).
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const left = x + width > window.innerWidth - pad ? Math.max(pad, x - width) : x;
    const top =
      y + height > window.innerHeight - pad ? Math.max(pad, window.innerHeight - height - pad) : y;
    setPos({ left, top });
  }, [mode, x, y, showAllCollections, folderSearch, chosenFormat]);

  async function handleCopy() {
    try {
      await invoke('copy_file_to_clipboard', {
        filePath: item.file_path,
        mediaType: item.media_type,
      });
    } catch (e) {
      onError?.(`Copy failed: ${e}`);
    }
    onClose();
  }

  async function handleSaveAs() {
    onClose();
    try {
      const ext = item.file_name.split('.').pop();
      const dest = await save({
        defaultPath: item.file_name,
        filters: [{ name: 'Media', extensions: [ext] }],
      });
      if (dest) await invoke('export_file', { srcPath: item.file_path, destPath: dest });
    } catch (e) {
      onError?.(`Save failed: ${e}`);
    }
  }

  async function handleExportAs() {
    onClose();
    try {
      const origExt = item.file_name.split('.').pop();
      const ext = chosenFormat ?? origExt;
      const stem = item.file_name.replace(/\.[^.]+$/, '');
      const dest = await save({
        defaultPath: chosenFormat ? `${stem}.${chosenFormat}` : item.file_name,
        filters: [
          { name: chosenFormat ? chosenFormat.toUpperCase() : 'Original', extensions: [ext] },
        ],
      });
      if (dest) await invoke('export_as', { srcPath: item.file_path, destPath: dest, isImage });
    } catch (e) {
      onError?.(`Export failed: ${e}`);
    }
  }

  async function handleSaveClean() {
    onClose();
    try {
      const ext = item.file_name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const stem = item.file_name.replace(/\.[^.]+$/, '');
      const dest = await save({
        defaultPath: `${stem}-clean.${ext}`,
        filters: [{ name: 'Image', extensions: [ext, 'jpg', 'png'] }],
      });
      if (dest) await invoke('export_stripped', { srcPath: item.file_path, destPath: dest });
    } catch (e) {
      onError?.(`Save clean copy failed: ${e}`);
    }
  }

  function handleLabelClick(value) {
    const newLabel = item.color_label === value ? null : value;
    onColorLabel?.(item.id, newLabel);
    onClose();
  }

  // ── Collection picker mode ────────────────────────────────────────────────
  if (mode === 'move') {
    return (
      <div
        ref={ref}
        className="context-menu"
        style={{ left: pos.left, top: pos.top }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="context-mode-header">
          <button
            className="context-mode-back"
            onClick={() => {
              setMode('main');
              setShowAllCollections(false);
            }}
          >
            <ChevronLeft size={14} />
          </button>
          <span>{t('contextMenu.moveToCollTitle')}</span>
        </div>
        <div className="context-separator" />
        {visibleCollections.map((g, i) =>
          g._header ? (
            <div key={`h-${i}`} className="context-submenu-label">
              {g._header}
            </div>
          ) : (
            <button
              key={g.id}
              className={`context-subitem ${item.collection_ids?.includes(g.id) ? 'active' : ''}`}
              onClick={() => {
                onSetCollection(item.id, g.id, !!item.collection_ids?.includes(g.id));
              }}
            >
              <CollectionAvatar group={g} allItems={allItems} size={18} radius="round" />
              <span style={{ flex: 1 }}>{g.name}</span>
              {item.collection_ids?.includes(g.id) && <Check size={12} />}
            </button>
          ),
        )}
        {hasMore && (
          <button
            className="context-subitem context-more-btn"
            onClick={() => setShowAllCollections(true)}
          >
            More ({realCollections.length - MAX_VISIBLE} more)…
          </button>
        )}
      </div>
    );
  }

  // ── Move-to-folder mode (on-disk relocation) ──────────────────────────────
  if (mode === 'movefolder') {
    const sorted = [...(diskFolders ?? [])].sort((a, b) => {
      if (a.id === UNCATEGORIZED_ID) return -1;
      if (b.id === UNCATEGORIZED_ID) return 1;
      return a.rel_path.localeCompare(b.rel_path);
    });
    const q = folderSearch.trim().toLowerCase();
    const shown = q ? sorted.filter((f) => f.name.toLowerCase().includes(q)) : sorted;
    const showSearch = sorted.length > MAX_VISIBLE;
    return (
      <div
        ref={ref}
        className="context-menu"
        style={{ left: pos.left, top: pos.top }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="context-mode-header">
          <button
            className="context-mode-back"
            onClick={() => {
              setMode('main');
              setFolderSearch('');
            }}
          >
            <ChevronLeft size={14} />
          </button>
          <span>{t('contextMenu.moveToFolderTitle')}</span>
        </div>
        <div className="context-separator" />
        {showSearch && (
          <div className="sel-collection-search" style={{ margin: '4px 8px' }}>
            <Search size={12} />
            <input
              autoFocus
              className="sel-collection-search-input"
              placeholder={t('panel.searchFolders')}
              value={folderSearch}
              onChange={(e) => setFolderSearch(e.target.value)}
            />
          </div>
        )}
        <div className="context-folder-list">
          {shown.map((f) => {
            const depth = (f.rel_path.match(/\//g) || []).length;
            const isCurrent = folderIdOf(item) === f.id;
            return (
              <button
                key={f.id}
                className={`context-subitem ${isCurrent ? 'active' : ''}`}
                onClick={() => {
                  onMoveToFolder(item.id, f.id);
                  onClose();
                }}
              >
                <span className="context-folder-icon" style={{ marginLeft: depth * 12 }}>
                  <FolderInput size={13} />
                </span>
                <span style={{ flex: 1 }}>{f.name}</span>
                {isCurrent && <Check size={12} />}
              </button>
            );
          })}
          {shown.length === 0 && (
            <div className="context-submenu-label">{t('panel.noFolderResults')}</div>
          )}
        </div>
      </div>
    );
  }

  // ── Color label mode ──────────────────────────────────────────────────────
  if (mode === 'color') {
    return (
      <div
        ref={ref}
        className="context-menu"
        style={{ left: pos.left, top: pos.top }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="context-mode-header">
          <button className="context-mode-back" onClick={() => setMode('main')}>
            <ChevronLeft size={14} />
          </button>
          <span>{t('contextMenu.colorLabelTitle')}</span>
        </div>
        <div className="context-separator" />
        <div className="context-color-picker context-color-picker-full">
          <button
            className={`context-color-none ${!item.color_label ? 'active' : ''}`}
            onClick={() => handleLabelClick(null)}
            title="No label"
          >
            ✕
          </button>
          {COLOR_LABELS.map(({ value, hex, labelKey }) => (
            <button
              key={value}
              className={`context-color-swatch ${item.color_label === value ? 'active' : ''}`}
              style={{ background: hex }}
              title={t(labelKey)}
              onClick={() => handleLabelClick(value)}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Export format mode ────────────────────────────────────────────────────
  if (mode === 'format') {
    return (
      <div
        ref={ref}
        className="context-menu"
        style={{ left: pos.left, top: pos.top }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="context-mode-header">
          <button className="context-mode-back" onClick={() => setMode('main')}>
            <ChevronLeft size={14} />
          </button>
          <span>{t('contextMenu.exportAsTitle')}</span>
        </div>
        <div className="context-separator" />
        <div className="context-format-picker" style={{ padding: '6px 10px 8px' }}>
          <span className="context-format-label">{t('contextMenu.format')}</span>
          <div className="context-format-row">
            <button
              className={`context-format-btn ${chosenFormat === null ? 'active' : ''}`}
              onClick={() => setChosenFormat(null)}
            >
              Orig
            </button>
            {IMAGE_FORMATS.map(({ ext, label }) => (
              <button
                key={ext}
                className={`context-format-btn ${chosenFormat === ext ? 'active' : ''}`}
                onClick={() => setChosenFormat(ext)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 8, width: '100%', fontSize: 11 }}
            onClick={handleExportAs}
          >
            {t('contextMenu.chooseDestination')}
          </button>
        </div>
      </div>
    );
  }

  // ── Main menu ─────────────────────────────────────────────────────────────
  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {onOpen && (
        <button
          className="context-item"
          onClick={() => {
            onOpen(item);
            onClose();
          }}
        >
          <FolderOpen size={14} /> {t('contextMenu.open')}
        </button>
      )}
      <button
        className="context-item"
        onClick={() => {
          onViewDetails(item);
          onClose();
        }}
      >
        <Info size={14} /> {t('contextMenu.viewDetails')}
      </button>
      <button
        className="context-item"
        onClick={() => {
          onStarToggle(item.id);
          onClose();
        }}
      >
        <Star size={14} className={item.starred ? 'starred' : ''} />
        {item.starred ? t('contextMenu.unstar') : t('contextMenu.star')}
      </button>
      <button className="context-item" onClick={() => setMode('color')}>
        <Tag size={14} /> {t('contextMenu.colorLabel')}
        {item.color_label && (
          <span
            className="context-color-dot"
            style={{ background: COLOR_LABELS.find((c) => c.value === item.color_label)?.hex }}
          />
        )}
      </button>

      {((onSetCollection && collections?.length > 0) ||
        (onMoveToFolder && diskFolders?.length > 0)) && <div className="context-separator" />}
      {onSetCollection && collections?.length > 0 && (
        <button className="context-item" onClick={() => setMode('move')}>
          <FolderInput size={14} />
          {t('contextMenu.moveToCollection')}
        </button>
      )}
      {onSetCollection && activeCollection && item.collection_ids?.includes(activeCollection) && (
        <button
          className="context-item"
          onClick={() => {
            onSetCollection(item.id, activeCollection, true);
            onClose();
          }}
        >
          <FolderMinus size={14} />
          {t('contextMenu.removeFromCollection')}
        </button>
      )}
      {onMoveToFolder && diskFolders?.length > 0 && (
        <button className="context-item" onClick={() => setMode('movefolder')}>
          <FolderTree size={14} />
          {t('contextMenu.moveToFolder')}
        </button>
      )}

      <div className="context-separator" />

      <button className="context-item" onClick={handleCopy}>
        <Copy size={14} /> {t('contextMenu.copyFile')}
      </button>
      <button className="context-item" onClick={handleSaveAs}>
        <Download size={14} /> {t('contextMenu.saveTo')}
      </button>
      {isImage && (
        <button className="context-item" onClick={() => setMode('format')}>
          <FileOutput size={14} /> {t('contextMenu.exportAs')}
        </button>
      )}
      {isImage && (
        <button className="context-item" onClick={handleSaveClean}>
          <ShieldOff size={14} /> {t('contextMenu.cleanCopy')}
        </button>
      )}
      <button
        className="context-item"
        onClick={async () => {
          await invoke('reveal_in_finder', { filePath: item.file_path });
          onClose();
        }}
      >
        <FolderOpen size={14} /> {t('contextMenu.showInFinder')}
      </button>
      {onRenameFile && (
        <button
          className="context-item"
          onClick={() => {
            onRenameFile(item);
            onClose();
          }}
        >
          <FileCog size={14} /> {t('contextMenu.renameFile')}
        </button>
      )}
      {isImage && activeCollection && onSetCover && (
        <button
          className="context-item"
          onClick={() => {
            onSetCover(activeCollection, item.id);
            onClose();
          }}
        >
          <Image size={14} /> {t('contextMenu.setThumbnail')}
        </button>
      )}

      <div className="context-separator" />

      <button
        className="context-item"
        onClick={() => {
          onShare?.([item.file_path]);
          onClose();
        }}
      >
        <Share2 size={14} /> {t('contextMenu.share')}
      </button>
      {onEdit && isImage && !isGif && (
        <button
          className="context-item"
          onClick={() => {
            onEdit(item);
            onClose();
          }}
        >
          <Pencil size={14} /> {t('contextMenu.editImage')}
        </button>
      )}
      {onFindSimilar && (isImage || isVideo) && (
        <button
          className="context-item"
          onClick={() => {
            onFindSimilar(item);
            onClose();
          }}
        >
          <ScanSearch size={14} /> {t('contextMenu.findSimilar')}
        </button>
      )}
      {onCompare && isImage && (
        <button
          className="context-item"
          onClick={() => {
            onCompare(item);
            onClose();
          }}
        >
          <Columns2 size={14} /> {t('contextMenu.sideBySide')}
        </button>
      )}

      {isVideo && (
        <>
          <div className="context-separator" />
          <button
            className="context-item"
            onClick={() => {
              onPlayAsAudio(item);
              onClose();
            }}
          >
            <Headphones size={14} /> {t('contextMenu.playAsAudio')}
          </button>
        </>
      )}
      {isAudio && onSetAudioCover && (
        <>
          <div className="context-separator" />
          <button
            className="context-item"
            onClick={() => {
              onSetAudioCover(item);
              onClose();
            }}
          >
            <Image size={14} /> {t('contextMenu.setCoverArt')}
          </button>
          {onRemoveAudioCover && item.audio_cover && (
            <button
              className="context-item"
              onClick={() => {
                onRemoveAudioCover(item);
                onClose();
              }}
            >
              <Image size={14} /> {t('contextMenu.removeCoverArt')}
            </button>
          )}
        </>
      )}

      <div className="context-separator" />

      <button
        className="context-item context-item-danger"
        onClick={() => {
          onRemove(item.id);
          onClose();
        }}
      >
        <Trash2 size={14} /> {t('contextMenu.remove')}
      </button>
    </div>
  );
}
