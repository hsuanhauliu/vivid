import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { FolderOpen, Upload, Music, GripVertical, Check, Star, Play, Clock } from 'lucide-react';
import MediaCard, { VideoThumb, GifThumb } from './MediaCard';
import { useDisplayableSrc } from '../../hooks/useDisplayableSrc';
import { thumbSrcOf } from '../../utils/path';
import { formatBytes, formatDate, formatDuration } from '../../utils/format';
import { groupByMonth } from '../../utils/timeline';
import ScrollArea from '../common/ScrollArea';
import './MediaGrid.css';

// Images without a cached thumbnail fall back to the original, resolving HEIC
// via the backend — same reasoning as MediaCard's FallbackImageThumb (see its
// comment): kept as its own component so the HEIC-decoding hook only mounts
// for the uncommon no-thumbnail case, never for the common cached-thumbnail
// path that covers most of a normal grid. This matters most right after
// adopting a large external workspace, where thumbnail generation for a
// folder that already had thousands of files can take a while to catch up —
// without this, HEIC originals (the default iPhone photo format) would render
// as a broken image in the meantime instead of the real photo.
function MasonryFallbackImg({ item, onRatio }) {
  const src = useDisplayableSrc(item.file_path);
  return (
    <img
      src={src ?? undefined}
      alt=""
      className="masonry-img"
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.target;
        if (w && h) onRatio(w / h);
      }}
    />
  );
}

const MasonryItem = memo(function MasonryItem({
  item,
  onOpen,
  onViewDetails,
  onContextMenu,
  checked,
  isSelecting,
  onCheckToggle,
  highlighted,
  onCardDragStart,
  freshThumbSrc,
}) {
  const { t } = useTranslation();
  // Stable src — convertFileSrc output is deterministic for a given path.
  const src = useMemo(() => convertFileSrc(item.file_path ?? ''), [item.file_path]);
  // Images (GIFs included) render the cheap cached static thumbnail when
  // available — huge decode win on fast scroll, and for GIFs specifically
  // avoids every tile independently decoding/looping its full animated
  // original at once. Falls back to the original until a thumbnail exists.
  const hasCachedThumb = !!freshThumbSrc || (item.media_type === 'image' && !!item.thumb_path);
  const imgSrc = useMemo(
    () =>
      freshThumbSrc ||
      (item.media_type === 'image' && item.thumb_path ? thumbSrcOf(item.thumb_path) : src),
    [freshThumbSrc, item.media_type, item.thumb_path, src],
  );
  const isGif = (item.file_path || '').toLowerCase().endsWith('.gif');
  // Seed the tile's aspect ratio from stored dimensions when present; otherwise
  // measure it once the media loads.
  const seeded = item.width && item.height ? item.width / item.height : null;
  const [ratio, setRatio] = useState(seeded ?? 4 / 3);
  const handleRatio = useCallback(
    (r) => {
      // When we already have a seeded ratio, ignore the on-load measurement. Each
      // setRatio changes the tile's flex-basis, which forces the whole justified
      // masonry row to re-layout; doing that per image as hundreds of thumbnails
      // stream in is an O(n²) reflow cascade (pathologically slow in WebKit). The
      // stored dimensions already give the correct ratio, so one layout suffices.
      if (seeded != null) return;
      if (r && isFinite(r) && r > 0) setRatio(r);
    },
    [seeded],
  );

  const dblFired = useRef(false);
  const clickTimer = useRef(null);

  const handleClick = useCallback(
    (e) => {
      if (isSelecting) {
        onCheckToggle?.(item.id, e);
        return;
      }
      dblFired.current = false;
      clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => {
        if (!dblFired.current) onViewDetails(item);
      }, 300);
    },
    [item, onViewDetails, isSelecting, onCheckToggle],
  );

  const handleDoubleClick = useCallback(() => {
    if (isSelecting) return;
    dblFired.current = true;
    clearTimeout(clickTimer.current);
    onOpen(item);
  }, [item, onOpen, isSelecting]);

  const handleContextMenu = useCallback(
    (e) => {
      e.preventDefault();
      onContextMenu(e, item);
    },
    [item, onContextMenu],
  );

  return (
    <div
      className={`masonry-item ${checked ? 'checked' : ''} ${highlighted ? 'highlighted' : ''}`}
      style={{ flexGrow: ratio, flexBasis: `calc(var(--masonry-basis, 160px) * ${ratio})` }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onPointerDown={(e) => {
        if (e.target.closest('button')) return;
        onCardDragStart?.(e, item);
      }}
      title={item.display_name}
    >
      <button
        className={`card-check-btn masonry-check-btn ${checked ? 'checked' : ''} ${isSelecting ? 'always-show' : ''}`}
        title={checked ? 'Deselect' : 'Select'}
        onClick={(e) => {
          e.stopPropagation();
          onCheckToggle?.(item.id, e);
        }}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </button>
      {item.media_type !== 'audio' && !item.date_taken && (
        <span className="masonry-no-capture-date" title={t('mediaGrid.noCaptureDate')}>
          <Clock size={10} />
        </span>
      )}
      {item.media_type === 'video' ? (
        <VideoThumb
          src={src}
          poster={item.thumb_path ? thumbSrcOf(item.thumb_path) : null}
          alt=""
          imgClassName="masonry-img"
          onRatio={handleRatio}
        />
      ) : item.media_type === 'image' && isGif && item.thumb_path ? (
        <GifThumb
          thumbSrc={imgSrc}
          gifSrc={src}
          alt=""
          imgClassName="masonry-img"
          onRatio={handleRatio}
        />
      ) : item.media_type === 'image' && hasCachedThumb ? (
        <img
          src={imgSrc}
          alt=""
          className="masonry-img"
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.target;
            if (w && h) handleRatio(w / h);
          }}
        />
      ) : item.media_type === 'image' ? (
        <MasonryFallbackImg item={item} onRatio={handleRatio} />
      ) : item.media_type === 'audio' ? (
        <>
          {item.audio_cover || item.thumb_path ? (
            <img
              src={thumbSrcOf(item.audio_cover || item.thumb_path)}
              alt=""
              className="masonry-img"
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.target;
                if (w && h) handleRatio(w / h);
              }}
            />
          ) : (
            <div className="masonry-audio-placeholder">
              <Music size={28} color="rgba(255,255,255,0.4)" />
            </div>
          )}
          {/* Play-style badge so audio reads as playable, like the video badge */}
          <span className="card-audio-play-icon" style={{ zIndex: 3 }}>
            ♪
          </span>
        </>
      ) : (
        <div className="masonry-audio-placeholder">
          <Music size={28} color="rgba(255,255,255,0.4)" />
        </div>
      )}
    </div>
  );
});

// Cached cover art (album art or a generated thumbnail) renders directly; an
// image with neither yet falls back to the original, same HEIC-safe path as
// MasonryFallbackImg above — otherwise a HEIC original would show broken in
// list view until its thumbnail catches up.
function ListRowCover({ item }) {
  const cachedCover = item.audio_cover || item.thumb_path;
  if (cachedCover) {
    return <img src={thumbSrcOf(cachedCover)} alt="" loading="lazy" draggable={false} />;
  }
  if (item.media_type === 'image') {
    return <ListRowFallbackCover item={item} />;
  }
  return <Music size={15} color="rgba(255,255,255,0.4)" />;
}

function ListRowFallbackCover({ item }) {
  const src = useDisplayableSrc(item.file_path);
  return <img src={src ?? undefined} alt="" loading="lazy" draggable={false} />;
}

// A single line in the music-player "list" view. Shares the selection / open
// semantics of MasonryItem (single click = details, double click = play/open,
// click while selecting = toggle check). The optional `reorderHandle` slot holds
// the drag grip in manual-sort mode.
const ListRow = memo(function ListRow({
  item,
  index,
  checked,
  isSelecting,
  highlighted,
  onOpen,
  onViewDetails,
  onContextMenu,
  onStarToggle,
  onCheckToggle,
  onCardDragStart,
  reorderHandle = null,
}) {
  const { t } = useTranslation();
  const dblFired = useRef(false);
  const clickTimer = useRef(null);

  const handleClick = useCallback(
    (e) => {
      if (isSelecting) {
        onCheckToggle?.(item.id, e);
        return;
      }
      dblFired.current = false;
      clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => {
        if (!dblFired.current) onViewDetails(item);
      }, 300);
    },
    [item, onViewDetails, isSelecting, onCheckToggle],
  );

  const handleDoubleClick = useCallback(() => {
    if (isSelecting) return;
    dblFired.current = true;
    clearTimeout(clickTimer.current);
    onOpen(item);
  }, [item, onOpen, isSelecting]);

  // Only audio tracks get a hover play button in the index column — images
  // and videos don't "play" inline in a list row, so the overlay there was
  // just a misleading affordance.
  const playable = item.media_type === 'audio';

  return (
    <div
      className={`media-list-row ${checked ? 'checked' : ''} ${highlighted ? 'highlighted' : ''} ${isSelecting ? 'selecting' : ''} ${playable ? 'playable' : ''}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, item);
      }}
      onPointerDown={(e) => {
        if (e.target.closest('button, .list-row-grip')) return;
        onCardDragStart?.(e, item);
      }}
      title={item.display_name}
    >
      {reorderHandle}
      <button
        className={`list-row-check ${checked ? 'checked' : ''} ${isSelecting ? 'always-show' : ''}`}
        title={checked ? 'Deselect' : 'Select'}
        onClick={(e) => {
          e.stopPropagation();
          onCheckToggle?.(item.id, e);
        }}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </button>
      <span className="list-row-index">{index + 1}</span>
      {playable && (
        <button
          className="list-row-play"
          title="Play"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(item);
          }}
        >
          <span className="list-row-play-circle">
            <Play size={13} />
          </span>
        </button>
      )}
      <span className="list-row-cover">
        <ListRowCover item={item} />
      </span>
      <span className="list-row-main">
        <span className="list-row-title">{item.audio_title || item.display_name}</span>
        {item.audio_artist && <span className="list-row-artist">{item.audio_artist}</span>}
      </span>
      <span className="list-row-album">
        {item.media_type === 'audio' ? (item.audio_album ?? '') : formatBytes(item.file_size)}
      </span>
      <span className="list-row-dur">
        {item.media_type === 'audio' ? (
          formatDuration(item.audio_duration)
        ) : item.date_taken ? (
          formatDate(item.date_taken)
        ) : (
          <span className="list-row-date-estimated" title={t('mediaGrid.noCaptureDate')}>
            <Clock size={10} />
            {formatDate(item.created_at)}
          </span>
        )}
      </span>
      <button
        className={`list-row-star ${item.starred ? 'starred' : ''}`}
        title={item.starred ? 'Unstar' : 'Star'}
        onClick={(e) => {
          e.stopPropagation();
          onStarToggle(item.id);
        }}
      >
        <Star size={13} />
      </button>
    </div>
  );
});

function monthLabel(key, locale) {
  if (key === 'Unknown') return 'Unknown Date';
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(locale || undefined, {
    year: 'numeric',
    month: 'long',
  });
}

// Calendar-friendly label intervals (months). Snap to the smallest that fits.
const LABEL_STEPS = [1, 2, 3, 6, 12];
const LABEL_MIN_PX = 16; // minimum pixels between two labeled entries

function TimelineScrubber({ monthKeys, scrollAreaRef, activeMonth }) {
  const { i18n } = useTranslation();
  const ref = useRef(null);
  const dragRef = useRef(null);
  const [containerH, setContainerH] = useState(0);

  // Measure available height so we know how many labels can fit
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerH(el.clientHeight));
    ro.observe(el);
    setContainerH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function onDown(e) {
      const scrollEl = scrollAreaRef.current;
      if (!scrollEl) return;
      dragRef.current = {
        startY: e.clientY,
        startScroll: scrollEl.scrollTop,
        moved: false,
      };

      function onMove(ev) {
        const delta = ev.clientY - dragRef.current.startY;
        if (Math.abs(delta) > 3) {
          if (!dragRef.current.moved) {
            dragRef.current.moved = true;
            el.classList.add('tl-scrubber-dragging');
          }
          const ratio = scrollEl.scrollHeight / el.getBoundingClientRect().height;
          scrollEl.scrollTop = dragRef.current.startScroll + delta * ratio;
        }
      }

      function onUp() {
        el.classList.remove('tl-scrubber-dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setTimeout(() => {
          dragRef.current = null;
        }, 0);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    el.addEventListener('mousedown', onDown);
    return () => el.removeEventListener('mousedown', onDown);
  }, []);

  function handleClick(e, key) {
    if (dragRef.current?.moved) return;
    document.getElementById(`tl-${key}`)?.scrollIntoView({ behavior: 'smooth' });
  }

  const n = monthKeys.length;

  // Pick the smallest calendar-friendly step where labeled items fit
  const rawStep = containerH > 0 && n > 1 ? Math.ceil((n * LABEL_MIN_PX) / containerH) : 1;
  const step = LABEL_STEPS.find((s) => s >= rawStep) ?? 12;

  return (
    <div className="timeline-scrubber" ref={ref}>
      <div className="tl-scrub-inner">
        {monthKeys.map((key, i) => {
          const year = key.slice(0, 4);
          const month = new Date(Number(year), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString(
            i18n.language || undefined,
            { month: 'short' },
          );
          const newYear = i === 0 || key.slice(0, 4) !== monthKeys[i - 1].slice(0, 4);
          const isActive = activeMonth === key;
          const onCadence = i % step === 0;
          const yearCadence = newYear && (i % step === 0 || step >= 12);
          const showLabel = isActive || onCadence || yearCadence;

          return (
            <button
              key={key}
              className={`tl-scrub-btn${isActive ? ' tl-active' : ''}${showLabel ? '' : ' tl-scrub-dot'}`}
              onClick={(e) => handleClick(e, key)}
              title={`${month} ${year}`}
            >
              {showLabel ? (
                <>
                  {newYear && <span className="tl-scrub-year">{year}</span>}
                  <span className="tl-scrub-month">{month}</span>
                </>
              ) : (
                <span className="tl-scrub-tick" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuickLookPopup({ item, rect, onClose }) {
  if (!item || !rect) return null;
  const WIN_W = window.innerWidth,
    WIN_H = window.innerHeight;
  const POP_W = 280,
    POP_H = 290;
  let left = rect.right + 8,
    top = rect.top;
  if (left + POP_W > WIN_W) left = rect.left - POP_W - 8;
  if (top + POP_H > WIN_H) top = WIN_H - POP_H - 8;
  return (
    <div className="quick-look-popup" style={{ left, top, width: POP_W }} onMouseEnter={onClose}>
      <div className="ql-media">
        {item.media_type === 'image' && (
          <img src={convertFileSrc(item.file_path)} alt={item.display_name} className="ql-img" />
        )}
        {item.media_type === 'video' && (
          <video
            src={convertFileSrc(item.file_path)}
            className="ql-video"
            autoPlay
            muted
            loop
            playsInline
          />
        )}
        {item.media_type === 'audio' &&
          (item.audio_cover || item.thumb_path ? (
            <img
              src={thumbSrcOf(item.audio_cover || item.thumb_path)}
              alt={item.display_name}
              className="ql-img"
            />
          ) : (
            <div className="ql-audio-icon">
              <Music size={48} strokeWidth={1} color="rgba(255,255,255,0.3)" />
            </div>
          ))}
      </div>
      <div className="ql-info">
        <p className="ql-name">{item.display_name}</p>
        <p className="ql-meta">
          {item.media_type} · {item.created_at?.slice(0, 10)}
        </p>
      </div>
    </div>
  );
}

/** Sortable grid that supports drag-reorder in manual mode */
// Pointer-based drag reorder. WKWebView is unreliable with native HTML5
// drag-and-drop, so we use the same pointer-move + elementFromPoint hit-testing
// approach as useCollectionDrag (which works reliably in this app).
function SortableGrid({ items, gridStyle, onReorder, variant = 'grid', ...cardProps }) {
  const [overId, setOverId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [ghost, setGhost] = useState(null); // { x, y, label } while dragging
  const [localItems, setLocalItems] = useState(items);
  const prevItemsRef = useRef(items);
  const dragRef = useRef(null); // { id, label, startX, startY, active, overId }

  // Sync local order when external items change (e.g. after reload)
  if (items !== prevItemsRef.current) {
    prevItemsRef.current = items;
    setLocalItems(items);
  }

  function beginDrag(e, item) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      id: item.id,
      label: item.audio_title || item.display_name,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      overId: null,
    };

    function onMove(ev) {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 6) return;
        d.active = true;
        document.body.classList.add('reorder-dragging');
        setDragId(d.id);
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetId = el?.closest('[data-reorder-id]')?.getAttribute('data-reorder-id') ?? null;
      d.overId = targetId && targetId !== d.id ? targetId : null;
      setOverId(d.overId);
      setGhost({ x: ev.clientX, y: ev.clientY, label: d.label });
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const d = dragRef.current;
      dragRef.current = null;
      document.body.classList.remove('reorder-dragging');
      setDragId(null);
      setOverId(null);
      setGhost(null);
      if (!d?.active) return;

      // Swallow the click that fires after a drag so we don't open the file.
      const swallow = (ce) => {
        ce.stopPropagation();
        ce.preventDefault();
        document.removeEventListener('click', swallow, true);
      };
      document.addEventListener('click', swallow, true);

      if (!d.overId || d.overId === d.id) return;
      setLocalItems((cur) => {
        const fromIdx = cur.findIndex((i) => i.id === d.id);
        const toIdx = cur.findIndex((i) => i.id === d.overId);
        if (fromIdx < 0 || toIdx < 0) return cur;
        const reordered = [...cur];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);
        reordered.forEach((it, i) =>
          invoke('update_item_order', { id: it.id, sortOrder: i }).catch(console.error),
        );
        onReorder?.(reordered);
        return reordered;
      });
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  const isList = variant === 'list';

  return (
    <div
      className={isList ? 'media-list media-list-sortable' : 'media-grid'}
      style={isList ? undefined : gridStyle}
    >
      {localItems.map((item, idx) =>
        isList ? (
          <div
            key={item.id}
            data-reorder-id={item.id}
            className={`media-list-reorder ${item.id === overId ? 'reorder-over' : ''} ${item.id === dragId ? 'reorder-source' : ''}`}
          >
            <ListRow
              item={item}
              index={idx}
              highlighted={item.id === cardProps.highlightedId}
              checked={cardProps.checkedIds.has(item.id)}
              isSelecting={cardProps.isSelecting}
              onOpen={cardProps.onOpen}
              onViewDetails={cardProps.onViewDetails}
              onContextMenu={cardProps.onContextMenu}
              onStarToggle={cardProps.onStarToggle}
              onCheckToggle={cardProps.onCheckToggle}
              onCardDragStart={cardProps.onCardDragStart}
              reorderHandle={
                <span
                  className="list-row-grip"
                  title="Drag to reorder"
                  onPointerDown={(e) => beginDrag(e, item)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical size={14} />
                </span>
              }
            />
          </div>
        ) : (
          <div
            key={item.id}
            data-reorder-id={item.id}
            className={`reorder-wrap ${item.id === overId ? 'reorder-over' : ''} ${item.id === dragId ? 'reorder-source' : ''}`}
          >
            <div
              className="reorder-handle"
              title="Drag to reorder"
              onPointerDown={(e) => beginDrag(e, item)}
            >
              <GripVertical size={14} />
            </div>
            <MediaCard
              item={item}
              highlighted={item.id === cardProps.highlightedId}
              checked={cardProps.checkedIds.has(item.id)}
              isSelecting={cardProps.isSelecting}
              onOpen={cardProps.onOpen}
              onViewDetails={cardProps.onViewDetails}
              onContextMenu={cardProps.onContextMenu}
              onStarToggle={cardProps.onStarToggle}
              onCheckToggle={cardProps.onCheckToggle}
              onQuickLook={cardProps.onQuickLook}
              onQuickLookEnd={cardProps.onQuickLookEnd}
              onCardDragStart={cardProps.onCardDragStart}
            />
          </div>
        ),
      )}
      {ghost && (
        <div className="reorder-ghost" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>
          {ghost.label}
        </div>
      )}
    </div>
  );
}

export default function MediaGrid({
  items,
  isFiltered,
  highlightedId,
  checkedIds,
  onOpen,
  onViewDetails,
  onContextMenu,
  onStarToggle,
  onCheckToggle,
  onCheckRange,
  onImport,
  isDragging,
  onClearSearch,
  sortBy,
  gridZoom,
  viewMode,
  timelineGrouping,
  onReorder,
  onCardDragStart,
  reorderable = false,
  freshThumbUrls = {},
  restoreScrollRef = null,
  onScrollStateChange,
}) {
  const { t, i18n } = useTranslation();
  const isSelecting = checkedIds.size > 0;
  const [qlItem, setQlItem] = useState(null);
  const [qlRect, setQlRect] = useState(null);

  // Shift-click range select: extends the selection from the last-clicked
  // item to the one just clicked (inclusive), Finder/Photos-style — additive,
  // not a toggle. The anchor resets whenever the selection is emptied so a
  // fresh selection session starts from a clean slate.
  const lastCheckedIndexRef = useRef(null);
  useEffect(() => {
    if (!isSelecting) lastCheckedIndexRef.current = null;
  }, [isSelecting]);

  const handleCheckToggle = useCallback(
    (id, e) => {
      const idx = items.findIndex((it) => it.id === id);
      if (e?.shiftKey && lastCheckedIndexRef.current != null && idx !== -1) {
        const from = Math.min(lastCheckedIndexRef.current, idx);
        const to = Math.max(lastCheckedIndexRef.current, idx);
        onCheckRange?.(items.slice(from, to + 1).map((it) => it.id));
      } else {
        onCheckToggle?.(id);
      }
      if (idx !== -1) lastCheckedIndexRef.current = idx;
    },
    [items, onCheckToggle, onCheckRange],
  );

  // Timeline group header's select-all button: additive (onCheckRange) when
  // the group isn't fully selected yet, otherwise flips each one off —
  // there's no batch-uncheck action, so that direction just toggles each id.
  const handleGroupSelectToggle = useCallback(
    (group) => {
      const allChecked = group.every((it) => checkedIds.has(it.id));
      if (allChecked) group.forEach((it) => onCheckToggle?.(it.id));
      else onCheckRange?.(group.map((it) => it.id));
    },
    [checkedIds, onCheckToggle, onCheckRange],
  );

  const handleQuickLook = useCallback((item, rect) => {
    setQlItem(item);
    setQlRect(rect);
  }, []);
  const handleQuickLookEnd = useCallback(() => {
    setQlItem(null);
    setQlRect(null);
  }, []);

  // Stable derived values — memo so child cards only see new references when the value changes
  const gridStyle = useMemo(
    () => ({ gridTemplateColumns: `repeat(auto-fill, minmax(${gridZoom ?? 160}px, 1fr))` }),
    [gridZoom],
  );
  const masonryStyle = useMemo(() => ({ '--masonry-basis': `${gridZoom ?? 160}px` }), [gridZoom]);

  const isEmpty = items.length === 0;
  // Drag-to-reorder is only offered on reorderable pages (playlists), and only
  // when the user has chosen manual sort.
  const isManual = sortBy === 'manual' && reorderable;

  // ── Incremental rendering ────────────────────────────────────────────────
  // Mount only a sliding window [windowStart, limit) of cards and grow/shift
  // it as the user scrolls, instead of accumulating every item ever scrolled
  // past. Keeps the DOM bounded for very large libraries (tens of thousands
  // of items) rather than growing forever across a long scroll session.
  // Manual (drag-reorder) and timeline render in full — drag needs every
  // node, timeline is already chunked by month.
  const CHUNK = 250;
  const MAX_WINDOW = CHUNK * 4; // evict once the mounted range exceeds this
  const capEnabled = !timelineGrouping && !isManual;
  const [limit, setLimit] = useState(() => restoreScrollRef?.current?.limit || CHUNK);
  // Seed consistently with the restored `limit` so a deep scroll position
  // doesn't briefly re-mount every item up to it before the eviction effect
  // below has a chance to catch up.
  const [windowStart, setWindowStart] = useState(() => Math.max(0, limit - MAX_WINDOW));
  const gridScrollRef = useRef(null);
  const sentinelRef = useRef(null);
  const topSentinelRef = useRef(null);
  // Snapshot of scrollHeight taken right before a windowStart-shifting DOM
  // change, so the compensating useLayoutEffect below can keep the viewport
  // visually still (adding/removing content above it would otherwise cause
  // a jump) regardless of masonry's variable item heights.
  const pendingScrollAdjustRef = useRef(null);
  // scrollAreaRef lives on a stable object so TimelineScrubber doesn't remount on re-render.
  // Timeline mode scrolls this nested element instead of gridScrollRef itself.
  const scrollAreaRef = useRef(null);
  const getScrollEl = useCallback(
    () => (timelineGrouping ? scrollAreaRef.current : gridScrollRef.current),
    [timelineGrouping],
  );

  // Reset the window when the result set changes (new filter/sort/view), but not
  // on in-place edits (star/color), which keep length and the first item stable,
  // and not on the very first mount (so a restored scroll-window from
  // restoreScrollRef isn't immediately clobbered back down to CHUNK).
  const resetSig = `${items.length}:${items[0]?.id ?? ''}:${viewMode}:${timelineGrouping}`;
  const prevResetSig = useRef(resetSig);
  useEffect(() => {
    if (prevResetSig.current !== resetSig) {
      setLimit(CHUNK);
      setWindowStart(0);
    }
    prevResetSig.current = resetSig;
  }, [resetSig]);

  // Once the mounted window grows past MAX_WINDOW, evict a chunk from the
  // trailing edge (opposite the edge that just grew) so the DOM stays bounded
  // no matter how far the user keeps scrolling in one direction.
  useEffect(() => {
    if (limit - windowStart <= MAX_WINDOW) return;
    const el = getScrollEl();
    if (el) pendingScrollAdjustRef.current = el.scrollHeight;
    setWindowStart((s) => Math.min(s + CHUNK, limit - CHUNK));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, windowStart]);

  // Compensate scrollTop for whatever just changed the rendered range above
  // the viewport (eviction from the front, or growth back into it below).
  useLayoutEffect(() => {
    const el = getScrollEl();
    if (el && pendingScrollAdjustRef.current != null) {
      el.scrollTop += el.scrollHeight - pendingScrollAdjustRef.current;
      pendingScrollAdjustRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowStart]);

  // Top sentinel: scrolling back up near the start of the mounted window
  // brings earlier items back in, symmetric to the bottom sentinel below.
  useEffect(() => {
    if (!capEnabled || windowStart === 0) return undefined;
    const root = gridScrollRef.current;
    const sentinel = topSentinelRef.current;
    if (!root || !sentinel) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        const el = getScrollEl();
        if (el) pendingScrollAdjustRef.current = el.scrollHeight;
        setWindowStart((s) => Math.max(0, s - CHUNK));
      },
      { root, rootMargin: '800px 0px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [capEnabled, windowStart, getScrollEl]);

  // Restore scroll position once, after the restored chunk-window above has
  // had a chance to render (returning from the file viewer, for instance).
  useLayoutEffect(() => {
    const el = getScrollEl();
    const top = restoreScrollRef?.current?.top;
    if (el && top) {
      el.scrollTop = top;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = getScrollEl();
    if (!el || !onScrollStateChange) return;
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        onScrollStateChange({ top: el.scrollTop, limit });
        ticking = false;
      });
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [onScrollStateChange, limit, getScrollEl]);

  const shownItems = capEnabled ? items.slice(windowStart, limit) : items;
  const hasMore = capEnabled && items.length > limit;

  useEffect(() => {
    if (!hasMore) return;
    const root = gridScrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + CHUNK);
      },
      { root, rootMargin: '800px 0px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore]);

  // Shared props for every card — kept as stable ref-object so spread doesn't invalidate memo
  const sharedCardProps = useMemo(
    () => ({
      isSelecting,
      onOpen,
      onViewDetails,
      onContextMenu,
      onStarToggle,
      onCheckToggle: handleCheckToggle,
      onQuickLook: handleQuickLook,
      onQuickLookEnd: handleQuickLookEnd,
      onCardDragStart,
    }),
    [
      isSelecting,
      onOpen,
      onViewDetails,
      onContextMenu,
      onStarToggle,
      handleCheckToggle,
      handleQuickLook,
      handleQuickLookEnd,
      onCardDragStart,
    ],
  );

  const renderGroup = useCallback(
    (groupItems) => {
      if (viewMode === 'list') {
        // Line-by-line music-player layout. Manual sort gets the drag-reorder
        // grip via SortableGrid; other sorts render a plain (non-draggable) list.
        if (isManual && !timelineGrouping) {
          return (
            <SortableGrid
              variant="list"
              items={groupItems}
              highlightedId={highlightedId}
              checkedIds={checkedIds}
              isSelecting={isSelecting}
              onOpen={onOpen}
              onViewDetails={onViewDetails}
              onContextMenu={onContextMenu}
              onStarToggle={onStarToggle}
              onCheckToggle={handleCheckToggle}
              onReorder={onReorder}
              onCardDragStart={onCardDragStart}
            />
          );
        }
        return (
          <div className="media-list">
            {groupItems.map((item, idx) => (
              <ListRow
                key={item.id}
                item={item}
                index={idx}
                highlighted={item.id === highlightedId}
                checked={checkedIds.has(item.id)}
                isSelecting={isSelecting}
                onOpen={onOpen}
                onViewDetails={onViewDetails}
                onContextMenu={onContextMenu}
                onStarToggle={onStarToggle}
                onCheckToggle={handleCheckToggle}
                onCardDragStart={onCardDragStart}
              />
            ))}
          </div>
        );
      }
      if (viewMode === 'masonry') {
        return (
          <div className="masonry-grid" style={masonryStyle}>
            {groupItems.map((item) => (
              <MasonryItem
                key={item.id}
                item={item}
                onOpen={onOpen}
                onViewDetails={onViewDetails}
                onContextMenu={onContextMenu}
                checked={checkedIds.has(item.id)}
                isSelecting={isSelecting}
                onCheckToggle={handleCheckToggle}
                highlighted={item.id === highlightedId}
                onCardDragStart={onCardDragStart}
                freshThumbSrc={freshThumbUrls[item.id] || null}
              />
            ))}
            <div className="masonry-filler" style={{ flexGrow: 10, flexBasis: 400 }} />
          </div>
        );
      }
      if (isManual && !timelineGrouping) {
        return (
          <SortableGrid
            items={groupItems}
            gridStyle={gridStyle}
            highlightedId={highlightedId}
            checkedIds={checkedIds}
            isSelecting={isSelecting}
            onOpen={onOpen}
            onViewDetails={onViewDetails}
            onContextMenu={onContextMenu}
            onStarToggle={onStarToggle}
            onCheckToggle={handleCheckToggle}
            onQuickLook={handleQuickLook}
            onQuickLookEnd={handleQuickLookEnd}
            onReorder={onReorder}
            onCardDragStart={onCardDragStart}
          />
        );
      }
      return (
        <div className="media-grid" style={gridStyle}>
          {groupItems.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              highlighted={item.id === highlightedId}
              checked={checkedIds.has(item.id)}
              freshThumbSrc={freshThumbUrls[item.id] || null}
              {...sharedCardProps}
            />
          ))}
        </div>
      );
    },
    [
      viewMode,
      isManual,
      timelineGrouping,
      gridStyle,
      masonryStyle,
      highlightedId,
      checkedIds,
      sharedCardProps,
      onOpen,
      onViewDetails,
      onContextMenu,
      onStarToggle,
      handleCheckToggle,
      handleQuickLook,
      handleQuickLookEnd,
      onReorder,
      isSelecting,
      onCardDragStart,
      freshThumbUrls,
    ],
  );

  const monthGroups = useMemo(
    () => (timelineGrouping ? groupByMonth(items, timelineGrouping) : null),
    [items, timelineGrouping],
  );
  const monthKeys = useMemo(() => monthGroups?.map((g) => g.month) ?? [], [monthGroups]);

  const [activeMonth, setActiveMonth] = useState(null);

  // Track which timeline section is visible to highlight scrubber
  useEffect(() => {
    if (!timelineGrouping || !scrollAreaRef.current) return;
    const scrollEl = scrollAreaRef.current;

    const observer = new IntersectionObserver(
      (entries) => {
        const topVisible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (topVisible.length > 0) {
          setActiveMonth(topVisible[0].target.id.replace('tl-', ''));
        }
      },
      { root: scrollEl, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );

    const sections = scrollEl.querySelectorAll('.timeline-section');
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [timelineGrouping, monthGroups]);

  return (
    <ScrollArea
      className="grid-container-wrap"
      innerClassName={`grid-container ${isDragging ? 'dragging' : ''} ${isEmpty ? 'is-empty' : ''} ${timelineGrouping ? 'timeline-mode' : ''} ${viewMode === 'masonry' ? 'masonry-mode' : ''} ${viewMode === 'list' ? 'list-mode' : ''}`}
      scrollRef={gridScrollRef}
    >
      {isDragging && (
        <div className="drop-overlay">
          <Upload size={40} />
          <span>Drop to import</span>
        </div>
      )}

      {isEmpty ? (
        <div className="empty-state">
          <div className="empty-icon">
            <FolderOpen size={48} strokeWidth={1.2} />
          </div>
          {isFiltered ? (
            <>
              <h2>{t('mediaGrid.noResults')}</h2>
              <p>{t('mediaGrid.noResultsDesc')}</p>
              {onClearSearch && (
                <button className="empty-clear-btn" onClick={onClearSearch}>
                  {t('mediaGrid.clearFilters')}
                </button>
              )}
            </>
          ) : (
            <>
              <h2>{t('mediaGrid.noFiles')}</h2>
              <p>{t('mediaGrid.noFilesDesc')}</p>
              <div className="empty-actions">
                <button className="btn btn-primary" onClick={onImport}>
                  {t('import.importFiles')}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {timelineGrouping ? (
            <div className="timeline-with-scrubber">
              <div className="timeline-scroll-area" ref={scrollAreaRef}>
                {monthGroups.map(({ month, items: group }) => {
                  const groupAllChecked = group.every((it) => checkedIds.has(it.id));
                  return (
                    <div key={month} id={`tl-${month}`} className="timeline-section">
                      <div className="timeline-section-header">
                        <button
                          className={`timeline-select-btn ${groupAllChecked ? 'checked' : ''}`}
                          onClick={() => handleGroupSelectToggle(group)}
                          title={
                            groupAllChecked
                              ? t('mediaGrid.deselectGroup')
                              : t('mediaGrid.selectGroup')
                          }
                        >
                          {groupAllChecked && <Check size={11} strokeWidth={3} />}
                        </button>
                        <h3 className="timeline-month">{monthLabel(month, i18n.language)}</h3>
                        <span className="timeline-month-count">
                          {t('common.item', { count: group.length })}
                        </span>
                      </div>
                      {renderGroup(group)}
                    </div>
                  );
                })}
              </div>
              <TimelineScrubber
                monthKeys={monthKeys}
                scrollAreaRef={scrollAreaRef}
                activeMonth={activeMonth}
              />
            </div>
          ) : (
            <>
              {windowStart > 0 && (
                <div ref={topSentinelRef} className="grid-load-sentinel" aria-hidden="true" />
              )}
              {renderGroup(shownItems)}
              {hasMore && (
                <div ref={sentinelRef} className="grid-load-sentinel" aria-hidden="true" />
              )}
            </>
          )}

          <QuickLookPopup item={qlItem} rect={qlRect} onClose={handleQuickLookEnd} />
        </>
      )}
    </ScrollArea>
  );
}
