import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { useDisplayableSrc } from '../../hooks/useDisplayableSrc';
import useWindowFullscreen from '../../hooks/useWindowFullscreen';
import { transformOrigin, panForZoomAtPoint, clampPan } from '../../utils/zoomPan';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Info,
  Star,
  Trash2,
  Copy,
  Pencil,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import VideoPlayer from '../common/VideoPlayer';
import AudioViewer from '../common/AudioViewer';
import './FileViewer.css';

export default function FileViewer({
  item,
  items,
  onClose,
  onNavigate,
  onToggleDetails,
  detailsOpen = false,
  onStarToggle,
  onRemove,
  onEditImage,
  onError,
  onFrameSaved,
  onNewItem,
  onItemUpdated,
  onRequestConfirm,
  onToast,
  cacheKey = 0,
  overrideSrc = null,
  filmstrip = false,
}) {
  const { t } = useTranslation();
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  // Native OS window fullscreen for images/GIFs (video manages its own,
  // internally, via the same hook + its onFullscreenChange prop).
  const { fullscreen: imageFullscreen, toggleFullscreen: toggleImageFullscreen } =
    useWindowFullscreen();
  const viewerRef = useRef(null);
  const filmWrapRef = useRef(null);
  const FILM_THUMB = 72; // 68px thumb + 4px gap, keep in sync with FileViewer.css

  // Pan & zoom (images only)
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const imgRef = useRef(null);
  const bodyRef = useRef(null);

  // Filmstrip: windowed (not free-scrolling) so only the thumbs actually on
  // screen are ever rendered — an album with hundreds of images doesn't load
  // hundreds of thumbnails, just however many fit the strip's width.
  const [filmVisible, setFilmVisible] = useState(10);

  // Auto-hide the prev/next nav arrows after a few seconds of no mouse
  // movement over the media body — mirrors VideoPlayer's chrome auto-hide.
  const [navVisible, setNavVisible] = useState(true);
  const navHideTimer = useRef(null);
  const revealNav = useCallback(() => {
    setNavVisible(true);
    clearTimeout(navHideTimer.current);
    navHideTimer.current = setTimeout(() => setNavVisible(false), 3000);
  }, []);
  useEffect(() => {
    revealNav();
    return () => clearTimeout(navHideTimer.current);
  }, [revealNav, item.id]);

  const idx = items.findIndex((i) => i.id === item.id);
  const prev = idx > 0 ? items[idx - 1] : null;
  const next = idx < items.length - 1 ? items[idx + 1] : null;
  const displaySrc = useDisplayableSrc(item.file_path);
  // overrideSrc is a blob URL set after an in-place edit — bypasses WKWebView cache entirely.
  // The `?v=` cache-buster only makes sense for a real asset:// URL — appending
  // a query string to a `data:` URL (HEIC's in-memory-converted src) corrupts
  // it, since everything after `?` becomes part of the base64 payload the
  // decoder then fails on.
  const imgSrc =
    overrideSrc ||
    (displaySrc
      ? displaySrc.startsWith('data:')
        ? displaySrc
        : `${displaySrc}?v=${cacheKey}`
      : null);

  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [item.id]);

  // How many thumbs actually fit the strip's width, so the window can fill
  // it exactly without over- or under-rendering.
  useEffect(() => {
    if (!filmstrip) return;
    const el = filmWrapRef.current;
    if (!el) return;
    const update = () => setFilmVisible(Math.max(1, Math.floor(el.clientWidth / FILM_THUMB)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [filmstrip]);

  // The visible window is derived fresh every render from (idx, filmVisible,
  // items.length) — no state of its own, so there's nothing to drift. It's
  // always centered on the current item (clamped at either edge). A window
  // resize just changes filmVisible, which recomputes this the same way —
  // it can't get stuck off-position the way a stateful "only correct if out
  // of range" effect could when filmVisible fluctuated transiently mid-drag.
  const filmMax = Math.max(0, items.length - filmVisible);
  const filmOffset =
    filmstrip && idx !== -1 ? Math.max(0, Math.min(filmMax, idx - Math.floor(filmVisible / 2))) : 0;

  // Safety net for zoom paths that don't compute pan themselves (keyboard
  // +/-, toolbar buttons): whenever scale changes, pull pan back in bounds
  // for the new scale so the image can never end up panned off-frame.
  useEffect(() => {
    const img = imgRef.current,
      body = bodyRef.current;
    if (!img || !body) return;
    const bodyRect = body.getBoundingClientRect();
    setPan((p) =>
      clampPan(p, scale, img.offsetWidth, img.offsetHeight, bodyRect.width, bodyRect.height),
    );
  }, [scale]);

  // Keyboard shortcuts. Space/ArrowLeft/ArrowRight for audio are owned by
  // AudioViewer's own capture-phase handler (mirroring VideoPlayer), so this
  // handler skips them entirely for audio items rather than double-handling.
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'Escape') {
        if (videoFullscreen) return;
        if (imageFullscreen) {
          toggleImageFullscreen();
          return;
        }
        if (scale !== 1) {
          setScale(1);
          setPan({ x: 0, y: 0 });
          return;
        }
        onClose();
        return;
      }

      if (item.media_type !== 'audio') {
        if (e.key === 'ArrowLeft' && prev) onNavigate(prev);
        if (e.key === 'ArrowRight' && next) onNavigate(next);
      }
      if (item.media_type === 'image') {
        if (e.key === '+' || e.key === '=') setScale((s) => Math.min(s + 0.25, 5));
        if (e.key === '-') setScale((s) => Math.max(s - 0.25, 0.25));
        if (e.key === '0') {
          setScale(1);
          setPan({ x: 0, y: 0 });
        }
      }
      if (item.media_type !== 'video') {
        if (e.key === 'f' || e.key === 'F') {
          toggleImageFullscreen();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [
    item,
    prev,
    next,
    onClose,
    onNavigate,
    scale,
    videoFullscreen,
    imageFullscreen,
    toggleImageFullscreen,
  ]);

  function handleWheel(e) {
    if (item.media_type !== 'image') return;
    e.preventDefault();
    const img = imgRef.current,
      body = bodyRef.current;
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    const newScale = Math.max(0.25, Math.min(5, +(scale + delta).toFixed(2)));
    if (newScale === scale || !img || !body) {
      setScale(newScale);
      return;
    }
    // Zoom around the cursor, not the image center, so the user can zoom
    // into any part of the image rather than always ending up re-centered.
    const rect = img.getBoundingClientRect();
    const origin = transformOrigin(rect, pan);
    const rawPan = panForZoomAtPoint(e.clientX, e.clientY, origin, scale, newScale, pan);
    const bodyRect = body.getBoundingClientRect();
    setScale(newScale);
    setPan(
      clampPan(
        rawPan,
        newScale,
        img.offsetWidth,
        img.offsetHeight,
        bodyRect.width,
        bodyRect.height,
      ),
    );
  }

  function handleImgMouseDown(e) {
    if (item.media_type !== 'image') return;
    e.stopPropagation();
    dragging.current = true;
    setIsDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
  }
  function handleMouseMove(e) {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setPan((p) => {
      const next = { x: p.x + dx, y: p.y + dy };
      const img = imgRef.current,
        body = bodyRef.current;
      if (!img || !body) return next;
      const bodyRect = body.getBoundingClientRect();
      return clampPan(
        next,
        scale,
        img.offsetWidth,
        img.offsetHeight,
        bodyRect.width,
        bodyRect.height,
      );
    });
  }
  function handleMouseUp() {
    dragging.current = false;
    setIsDragging(false);
  }

  async function handleCopy() {
    try {
      await invoke('copy_file_to_clipboard', {
        filePath: item.file_path,
        mediaType: item.media_type,
      });
    } catch (e) {
      onError?.(`Copy failed: ${e}`);
    }
  }

  const zoomed = scale !== 1 || pan.x !== 0 || pan.y !== 0;
  const imgTransform =
    [
      pan.x !== 0 || pan.y !== 0 ? `translate(${pan.x}px, ${pan.y}px)` : null,
      scale !== 1 ? `scale(${scale})` : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div
      ref={viewerRef}
      className={`viewer-page${imageFullscreen ? ' viewer-page-fullscreen' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* ── Header ── */}
      <div className="viewer-header" data-tauri-drag-region>
        <button className="viewer-back" onClick={onClose} title={t('viewer.close')}>
          <ArrowLeft size={16} />
        </button>
        <div className="viewer-title-group">
          <span className={`viewer-type-dot dot-${item.media_type}`} aria-hidden="true" />
          <span className="viewer-name">{item.display_name}</span>
          {items.length > 1 && (
            <span className="viewer-counter">
              {idx + 1} / {items.length}
            </span>
          )}
        </div>

        <div className="viewer-header-actions">
          {/* Bottom zoom controls promoted into the header (images only) */}
          {item.media_type === 'image' && (
            <>
              <button
                className="viewer-btn"
                onClick={() => setScale((s) => Math.max(s - 0.25, 0.25))}
                title={t('viewer.zoomOut')}
              >
                <ZoomOut size={15} />
              </button>
              <span
                className="viewer-zoom-pct"
                title={t('viewer.resetZoom')}
                onClick={() => {
                  setScale(1);
                  setPan({ x: 0, y: 0 });
                }}
                style={{ cursor: zoomed ? 'pointer' : 'default' }}
              >
                {Math.round(scale * 100)}%
              </span>
              <button
                className="viewer-btn"
                onClick={() => setScale((s) => Math.min(s + 0.25, 5))}
                title={t('viewer.zoomIn')}
              >
                <ZoomIn size={15} />
              </button>
              <button
                className="viewer-btn"
                onClick={toggleImageFullscreen}
                title={imageFullscreen ? t('viewer.exitFullScreen') : t('viewer.fullScreen')}
              >
                {imageFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <div className="viewer-btn-sep" />
            </>
          )}
          <button
            className={`viewer-btn${item.starred ? ' viewer-btn-starred' : ''}`}
            onClick={() => onStarToggle(item.id)}
            title={item.starred ? t('detail.unstar') : t('detail.star')}
          >
            <Star size={14} />
          </button>
          <button className="viewer-btn" onClick={handleCopy} title={t('viewer.copyFile')}>
            <Copy size={14} />
          </button>
          {item.media_type === 'image' &&
            !(item.file_path || '').toLowerCase().endsWith('.gif') && (
              <button
                className="viewer-btn"
                onClick={() => onEditImage(item)}
                title={t('viewer.editImage')}
              >
                <Pencil size={14} />
              </button>
            )}
          <button
            className={`viewer-btn${detailsOpen ? ' viewer-btn-active' : ''}`}
            onClick={onToggleDetails}
            title={t('viewer.viewDetails')}
          >
            <Info size={14} />
          </button>
          <button
            className="viewer-btn viewer-btn-danger"
            onClick={() => {
              onRemove(item.id);
              onClose();
            }}
            title={t('detail.removeFromLibrary')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* ── Media ── */}
      <div
        ref={bodyRef}
        className={`viewer-body${['video', 'audio'].includes(item.media_type) ? ' viewer-body-player' : ''}`}
        style={{ overflow: scale > 1 ? 'hidden' : undefined, position: 'relative' }}
        onWheel={handleWheel}
        onMouseMove={revealNav}
      >
        {item.media_type === 'image' && (
          <img
            ref={imgRef}
            src={imgSrc}
            alt={item.display_name}
            className="viewer-image"
            onMouseDown={handleImgMouseDown}
            style={{
              transform: imgTransform,
              transformOrigin: 'center',
              userSelect: 'none',
              cursor: isDragging ? 'grabbing' : 'grab',
            }}
            draggable={false}
          />
        )}
        {item.media_type === 'video' && (
          <VideoPlayer
            key={item.id}
            item={item}
            onFullscreenChange={setVideoFullscreen}
            onFrameSaved={onFrameSaved}
            onNewItem={onNewItem}
            onItemUpdated={onItemUpdated}
            onRequestConfirm={onRequestConfirm}
            onToast={onToast}
            onError={onError}
          />
        )}
        {item.media_type === 'audio' && (
          <AudioViewer key={item.id} item={item} queue={items} onNavigate={onNavigate} />
        )}

        {/* ── Navigation ── */}
        {prev && (
          <button
            className={`viewer-nav viewer-nav-prev${navVisible ? '' : ' viewer-nav-hidden'}`}
            onClick={() => onNavigate(prev)}
            title={t('viewer.prev')}
          >
            <ChevronLeft size={24} />
          </button>
        )}
        {next && (
          <button
            className={`viewer-nav viewer-nav-next${navVisible ? '' : ' viewer-nav-hidden'}`}
            onClick={() => onNavigate(next)}
            title={t('viewer.next')}
          >
            <ChevronRight size={24} />
          </button>
        )}
        {items.length > 1 && <div className="viewer-key-hint">{t('viewer.navHint')}</div>}
      </div>

      {filmstrip && items.length > 1 && (
        <div className="viewer-filmstrip-bar">
          <button
            className="viewer-film-arrow"
            onClick={() => prev && onNavigate(prev)}
            disabled={!prev}
            title={t('viewer.prev')}
          >
            <ChevronLeft size={18} />
          </button>
          <div className="viewer-filmstrip" ref={filmWrapRef}>
            {items.slice(filmOffset, filmOffset + filmVisible).map((it) => (
              <button
                key={it.id}
                className={`viewer-thumb ${it.id === item.id ? 'active' : ''}`}
                onClick={() => onNavigate(it)}
                title={it.display_name}
              >
                <img src={convertFileSrc(it.file_path)} alt="" draggable={false} />
              </button>
            ))}
          </div>
          <button
            className="viewer-film-arrow"
            onClick={() => next && onNavigate(next)}
            disabled={!next}
            title={t('viewer.next')}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
