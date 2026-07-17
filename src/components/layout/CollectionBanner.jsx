import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play,
  Shuffle,
  Repeat,
  Repeat1,
  MonitorPlay,
  Map as MapIcon,
  Pin,
  PinOff,
  MoreVertical,
  Pencil,
  Image,
  AlignLeft,
  Trash2,
} from 'lucide-react';
import CollectionAvatar from '../common/CollectionAvatar';
import useDismiss from '../../hooks/useDismiss';
import { DESCRIPTION_MAX_LEN, COLLECTION_NAME_MAX_LEN } from '../../utils/limits';
import './CollectionBanner.css';

/** Inline single-line editor — focuses & selects on mount, commits on Enter/blur. */
function InlineNameEditor({ value, onCommit, onCancel }) {
  const [val, setVal] = useState(value);
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <form
      className="collection-banner-name-form"
      onSubmit={(e) => {
        e.preventDefault();
        onCommit(val);
      }}
    >
      <input
        ref={ref}
        className="collection-banner-name-input"
        value={val}
        maxLength={COLLECTION_NAME_MAX_LEN}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => onCommit(val)}
      />
    </form>
  );
}

/** Inline multi-line editor for the description — commits on blur / ⌘↵, cancels on Esc. */
function InlineDescriptionEditor({ value, placeholder, onCommit, onCancel }) {
  const [val, setVal] = useState(value);
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      className="collection-banner-desc-input"
      rows={2}
      value={val}
      placeholder={placeholder}
      maxLength={DESCRIPTION_MAX_LEN}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onCommit(val);
        }
      }}
      onBlur={() => onCommit(val)}
    />
  );
}

/**
 * Header shown at the top of a collection (album/playlist) page: cover, name,
 * count, optional description, the playback/slideshow actions, the pin toggle,
 * and an overflow (⋮) menu wiring up the existing rename / set-cover / pin /
 * delete handlers plus description editing.
 */
export default function CollectionBanner({
  group,
  allItems,
  visible,
  onPlayAll,
  playerLoop,
  onCyclePlayerLoop,
  onSlideshow,
  onViewAlbumOnMap,
  onSidebarPin,
  onRename,
  onSetCover,
  onDelete,
  onSetDescription,
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const menuRef = useRef(null);
  useDismiss(menuRef, () => setMenuOpen(false), { enabled: menuOpen, escape: true });

  const typeLabel =
    group.kind === 'album'
      ? t('common.album')
      : group.kind === 'playlist'
        ? t('common.playlist')
        : t('common.folder');

  // Videos in a collection are treated as audio tracks (the player plays their
  // audio), so play-all / shuffle include them alongside audio. The controls
  // still only appear when the collection actually has audio.
  const hasAudio = visible.some((i) => i.media_type === 'audio');
  const audioTracks = visible.filter((i) => i.media_type === 'audio' || i.media_type === 'video');
  const albumImages = visible.filter((i) => i.media_type === 'image');

  const totalDuration = (() => {
    if (group.kind !== 'playlist' || audioTracks.length === 0) return null;
    const secs = audioTracks.reduce((sum, i) => sum + (i.audio_duration ?? 0), 0);
    if (secs === 0) return null;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  })();

  function commitName(name) {
    setEditingName(false);
    if (name.trim() && name.trim() !== group.name) onRename(group.id, name);
  }
  function commitDesc(desc) {
    setEditingDesc(false);
    if ((desc ?? '').trim() !== (group.description ?? '')) onSetDescription(group.id, desc);
  }

  const menuItems = [
    {
      icon: <Pencil size={13} />,
      label: t('panel.rename'),
      onClick: () => setEditingName(true),
    },
    {
      icon: <AlignLeft size={13} />,
      label: group.description ? t('collection.editDescription') : t('collection.addDescription'),
      onClick: () => setEditingDesc(true),
    },
    {
      icon: <Image size={13} />,
      label: t('panel.setCover'),
      onClick: () => onSetCover(group),
    },
    {
      icon: group.sidebar_pin ? <PinOff size={13} /> : <Pin size={13} />,
      label: group.sidebar_pin ? t('panel.unpin') : t('panel.pin'),
      onClick: () => onSidebarPin(group.id, !group.sidebar_pin),
    },
    {
      icon: <Trash2 size={13} />,
      label: t('panel.delete'),
      onClick: () => onDelete(group.id, group.name),
      danger: true,
    },
  ];

  return (
    <div className="collection-banner">
      <CollectionAvatar
        group={group}
        allItems={allItems}
        size={52}
        radius={10}
        className="collection-banner-avatar"
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onDragStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      <div className="collection-banner-info">
        <span className="collection-banner-type">{typeLabel}</span>
        {editingName ? (
          <InlineNameEditor
            value={group.name}
            onCommit={commitName}
            onCancel={() => setEditingName(false)}
          />
        ) : (
          <h2 className="collection-banner-name">{group.name}</h2>
        )}
        <span className="collection-banner-count">
          {t('common.item', { count: visible.length })}
          {totalDuration && <span className="collection-banner-duration"> · {totalDuration}</span>}
        </span>
      </div>
      <div className="collection-banner-desc-area">
        {editingDesc ? (
          <InlineDescriptionEditor
            value={group.description ?? ''}
            placeholder={t('collection.descriptionPlaceholder')}
            onCommit={commitDesc}
            onCancel={() => setEditingDesc(false)}
          />
        ) : (
          <p
            className={`collection-banner-desc ${group.description ? '' : 'collection-banner-desc-empty'}`}
            onDoubleClick={() => setEditingDesc(true)}
            title={
              group.description ? t('collection.editDescription') : t('collection.addDescription')
            }
          >
            {group.description || ''}
          </p>
        )}
      </div>
      <div className="collection-banner-actions">
        {hasAudio && (
          <>
            <button
              className="btn btn-primary collection-banner-btn"
              onClick={() => onPlayAll(audioTracks, group.name)}
            >
              <Play size={13} /> {t('common.playAll')}
            </button>
            <button
              className="btn btn-secondary collection-banner-btn collection-banner-btn-icon"
              onClick={() => {
                const shuffled = [...audioTracks].sort(() => Math.random() - 0.5);
                onPlayAll(shuffled, group.name);
              }}
              title={t('common.shuffle')}
            >
              <Shuffle size={13} />
            </button>
            <button
              className={`btn btn-secondary collection-banner-btn collection-banner-btn-icon ${playerLoop !== 'none' ? 'active' : ''}`}
              onClick={onCyclePlayerLoop}
              title={
                playerLoop === 'none'
                  ? 'Loop off'
                  : playerLoop === 'all'
                    ? 'Loop playlist'
                    : 'Loop track'
              }
            >
              {playerLoop === 'one' ? <Repeat1 size={13} /> : <Repeat size={13} />}
            </button>
          </>
        )}
        {group.kind === 'album' && albumImages.length > 0 && (
          <>
            <button
              className="btn btn-secondary collection-banner-btn"
              onClick={() => onSlideshow(albumImages)}
            >
              <MonitorPlay size={13} /> {t('common.slideshow')}
            </button>
            <button
              className="btn btn-secondary collection-banner-btn"
              onClick={() => onViewAlbumOnMap(albumImages)}
            >
              <MapIcon size={13} /> {t('detail.viewOnMap')}
            </button>
          </>
        )}
        <div className="collection-banner-menu-wrap" ref={menuRef}>
          <button
            className="btn btn-secondary collection-banner-btn collection-banner-menu-btn"
            onClick={() => setMenuOpen((v) => !v)}
            title={t('common.more')}
          >
            <MoreVertical size={13} />
          </button>
          {menuOpen && (
            <div className="collection-banner-menu">
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  className={`collection-banner-menu-item ${item.danger ? 'danger' : ''}`}
                  onClick={() => {
                    setMenuOpen(false);
                    item.onClick();
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
