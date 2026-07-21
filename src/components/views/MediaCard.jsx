import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { thumbSrcOf } from '../../utils/path';
import { Music, Video, Image, Star, Check, Clock } from 'lucide-react';
import { COLOR_LABELS } from '../common/FilterBar';
import { useDisplayableSrc } from '../../hooks/useDisplayableSrc';
import { acquireExtractSlot, releaseExtractSlot } from '../../utils/videoExtractQueue';
import './MediaCard.css';

const TYPE_ICONS = { image: Image, video: Video, audio: Music };

// Exported so MasonryItem in MediaGrid.jsx can reuse it.
// When `poster` is set (a cached backend-generated frame), the video is NOT
// loaded at rest — we show the poster image and only mount a <video> on hover.
// Mounting <video preload="auto"> for every card decodes every clip at once and
// freezes the webview, so client-side frame extraction is a fallback only.
export function VideoThumb({
  src,
  alt,
  poster = null,
  imgClassName = 'card-thumb-img',
  disableHoverPlay = false,
  onRatio,
}) {
  const [dataUrl, setDataUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [canExtract, setCanExtract] = useState(false);
  const extractRef = useRef(null);
  const rootRef = useRef(null);
  const hoverTimer = useRef(null);
  const doneRef = useRef(!!poster);
  const hasSlotRef = useRef(false);

  // The shown still: prefer the cached poster, fall back to a client-extracted
  // frame for videos that don't have one yet.
  const still = poster ?? dataUrl;

  // Report aspect ratio from the poster so masonry can size the cell without
  // loading the video.
  const handlePosterLoad = useCallback(
    (e) => {
      const { naturalWidth: w, naturalHeight: h } = e.target;
      if (w && h) onRatio?.(w / h);
    },
    [onRatio],
  );

  // ── Frame extraction ────────────────────────────────────
  const extractFrame = useCallback(() => {
    if (doneRef.current) return;
    const v = extractRef.current;
    if (!v) return;
    const { videoWidth: vw, videoHeight: vh } = v;
    if (!vw || !vh) return;
    requestAnimationFrame(() => {
      try {
        // Scale the frame so its longest edge is at most MAX, preserving aspect ratio
        const MAX = 320;
        const scale = Math.min(1, MAX / Math.max(vw, vh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vw * scale);
        canvas.height = Math.round(vh * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, vw, vh, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/jpeg', 0.85);
        if (url && url.length > 200) {
          doneRef.current = true;
          setDataUrl(url);
        }
      } catch {
        /* drawing on detached video is benign */
      } finally {
        if (hasSlotRef.current) {
          hasSlotRef.current = false;
          releaseExtractSlot();
        }
      }
    });
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const v = extractRef.current;
    if (!v) return;
    if (v.videoWidth && v.videoHeight) onRatio?.(v.videoWidth / v.videoHeight);
    v.currentTime = isFinite(v.duration) && v.duration > 0 ? Math.min(v.duration * 0.15, 3) : 0;
  }, [onRatio]);

  const handleSeeked = useCallback(() => {
    setTimeout(extractFrame, 80);
  }, [extractFrame]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // Only pull an extraction slot (and thus start buffering the full source
  // file) once this card is actually near the viewport — with no grid
  // virtualization, every off-screen card would otherwise queue up too,
  // just delaying the pile-up instead of preventing it. IntersectionObserver
  // is cheap to keep running since it only flips a boolean once.
  useEffect(() => {
    if (poster || doneRef.current || !rootRef.current) return undefined;
    const el = rootRef.current;
    let cancelled = false;
    let requested = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || requested) return;
        requested = true;
        acquireExtractSlot().then(() => {
          if (cancelled) {
            releaseExtractSlot();
            return;
          }
          hasSlotRef.current = true;
          setCanExtract(true);
        });
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      if (hasSlotRef.current) {
        hasSlotRef.current = false;
        releaseExtractSlot();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poster]);

  // Safety net: if extraction never fires (corrupt/unreadable file), release
  // the slot anyway so it doesn't stay stuck forever for other cards.
  useEffect(() => {
    if (!canExtract) return undefined;
    const timer = setTimeout(() => {
      if (hasSlotRef.current) {
        hasSlotRef.current = false;
        releaseExtractSlot();
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [canExtract]);

  // ── Hover-to-play (1.5 s delay) — disabled when disableHoverPlay ───────
  function onMouseEnter() {
    if (disableHoverPlay) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setIsPlaying(true), 1500);
  }
  function onMouseLeave() {
    clearTimeout(hoverTimer.current);
    setIsPlaying(false);
    setVideoReady(false);
  }

  return (
    <div
      className="media-thumb-root"
      ref={rootRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Thumbnail — always rendered, fades out once video is ready */}
      {still ? (
        <img
          src={still}
          alt={alt}
          className={imgClassName}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={poster ? handlePosterLoad : undefined}
          style={{
            position: 'absolute',
            inset: 0,
            opacity: isPlaying && videoReady ? 0 : 1,
            transition: 'opacity 0.25s ease',
            zIndex: 1,
          }}
        />
      ) : (
        <div
          className="card-thumb-placeholder"
          style={{
            background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
            position: 'absolute',
            inset: 0,
            opacity: isPlaying && videoReady ? 0 : 1,
            transition: 'opacity 0.25s ease',
            zIndex: 1,
          }}
        >
          <Video size={32} color="rgba(255,255,255,0.4)" />
        </div>
      )}

      {/* Playing video — always mounted when playing, fades in once ready.
          Deliberately NOT sized with `object-fit: cover` (unlike the poster
          image): WebKit has a known bug where a hardware-decoded <video>
          layer that needs real cropping via object-fit: cover renders
          upside-down for portrait-shot clips with a rotation matrix (common
          for phone-recorded .mov files) — hits Cards view (a fixed square
          box, so most non-square videos need substantial cropping) but not
          Masonry (whose cell is sized to the video's own aspect ratio via
          `onRatio`, so there's rarely real cropping to trigger it) or the
          full video player (which never crops to a fixed box at all). The
          manual centered-oversize technique below achieves the same visual
          "fill and crop" result without ever invoking object-fit on the
          video element, sidestepping the bug regardless of root cause. */}
      {isPlaying && (
        <div
          className="card-video-cover-wrap"
          style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 2 }}
        >
          <video
            key="play"
            src={src}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'auto',
              height: 'auto',
              minWidth: '100%',
              minHeight: '100%',
              opacity: videoReady ? 1 : 0,
              transition: 'opacity 0.25s ease',
            }}
            muted
            playsInline
            loop
            autoPlay
            onCanPlay={() => setVideoReady(true)}
          />
        </div>
      )}

      {/* Hidden extraction video — fallback only, for videos with no cached
          poster yet. Skipped entirely when a poster exists so the webview never
          decodes videos just to render the grid. Gated on `canExtract`
          (in-viewport + a free slot from the global concurrency queue) so
          scrolling a library full of not-yet-thumbnailed videos doesn't
          start buffering dozens of full source files at once. */}
      {!poster && !doneRef.current && canExtract && (
        <video
          ref={extractRef}
          src={src}
          className="card-thumb-offscreen-video"
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={handleLoadedMetadata}
          onSeeked={handleSeeked}
          onLoadedData={handleSeeked}
        />
      )}

      {/* Play button overlay — always visible when idle */}
      {!isPlaying && <span className="card-video-play-icon" style={{ zIndex: 3 }} />}
    </div>
  );
}

// GIF preview: shows the cached static first-frame thumbnail at rest (see
// ImageThumb — GIFs get one just like any other image now), swaps to the
// animated original on hover, mirroring VideoThumb's poster→video swap. No
// <video> element needed — mounting an <img src="*.gif"> just plays its
// animation natively; unmounting it on mouse-leave stops the decode/loop.
// Exported so MasonryItem in MediaGrid.jsx can reuse it.
export function GifThumb({
  thumbSrc,
  gifSrc,
  alt,
  imgClassName = 'card-thumb-img',
  disableHoverPlay = false,
  onRatio,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [gifReady, setGifReady] = useState(false);
  const hoverTimer = useRef(null);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  function onMouseEnter() {
    if (disableHoverPlay) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setIsPlaying(true), 1500);
  }
  function onMouseLeave() {
    clearTimeout(hoverTimer.current);
    setIsPlaying(false);
    setGifReady(false);
  }

  const handleStillLoad = useCallback(
    (e) => {
      const { naturalWidth: w, naturalHeight: h } = e.target;
      if (w && h) onRatio?.(w / h);
    },
    [onRatio],
  );

  return (
    <div className="media-thumb-root" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt={alt}
          className={imgClassName}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={handleStillLoad}
          style={{
            position: 'absolute',
            inset: 0,
            opacity: isPlaying && gifReady ? 0 : 1,
            transition: 'opacity 0.25s ease',
            zIndex: 1,
          }}
        />
      ) : (
        <div className="card-thumb-skeleton" style={{ position: 'absolute', inset: 0 }} />
      )}

      {isPlaying && (
        <img
          key="play"
          src={gifSrc}
          alt={alt}
          className={imgClassName}
          draggable={false}
          onLoad={() => setGifReady(true)}
          style={{
            position: 'absolute',
            inset: 0,
            opacity: gifReady ? 1 : 0,
            transition: 'opacity 0.25s ease',
            zIndex: 2,
          }}
        />
      )}

      {/* "GIF" badge overlay — always visible when idle, same chrome as the
          video play button and audio note. */}
      {!isPlaying && (
        <span className="card-gif-icon" style={{ zIndex: 3 }}>
          GIF
        </span>
      )}
    </div>
  );
}

// Presentational thumbnail: skeleton until the image loads. `src` may be null
// while a fallback is still resolving — keep showing the skeleton.
function ThumbImg({ src, alt }) {
  const [loaded, setLoaded] = useState(false);
  if (!src) return <div className="card-thumb-skeleton" />;
  return (
    <>
      {!loaded && <div className="card-thumb-skeleton" />}
      <img
        src={src}
        alt={alt}
        className={`card-thumb-img${loaded ? ' loaded' : ''}`}
        style={{ opacity: loaded ? 1 : 0 }}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}

// Images without a cached thumbnail fall back to the original, resolving HEIC
// via the backend. Kept as its own component so that hook — which fires a
// per-image backend decode for HEIC — only mounts for the uncommon
// no-thumbnail case, never for the cached-thumbnail path that covers most of
// the grid. (Calling it unconditionally flooded the backend with HEIC decodes
// on every grid mount, freezing the UI for HEIC-heavy libraries.)
function FallbackImageThumb({ item }) {
  const src = useDisplayableSrc(item.file_path);
  return <ThumbImg src={src} alt={item.display_name} />;
}

function ImageThumb({ item, freshThumbSrc, disableHoverPlay }) {
  // Prefer the cheap cached thumbnail — no per-card backend work, no HEIC
  // decode, and (for GIFs) no full animated-file decode either: a grid full
  // of live GIFs each independently decoding/looping is what made the grid
  // slow to begin with, so GIFs get a static first-frame thumbnail here just
  // like every other image — the full animated original only plays on hover
  // (via GifThumb) or in the single-item detail/viewer.
  const isGif = (item.file_path || '').toLowerCase().endsWith('.gif');
  const thumbSrc = freshThumbSrc || (item.thumb_path ? thumbSrcOf(item.thumb_path) : null);

  if (isGif && thumbSrc) {
    return (
      <GifThumb
        thumbSrc={thumbSrc}
        gifSrc={convertFileSrc(item.file_path)}
        alt={item.display_name}
        disableHoverPlay={disableHoverPlay}
      />
    );
  }
  if (thumbSrc) {
    return <ThumbImg src={thumbSrc} alt={item.display_name} />;
  }
  return <FallbackImageThumb item={item} />;
}

function MediaThumbnail({ item, disableHoverPlay, freshThumbSrc }) {
  if (item.media_type === 'image') {
    return (
      <ImageThumb item={item} freshThumbSrc={freshThumbSrc} disableHoverPlay={disableHoverPlay} />
    );
  }
  if (item.media_type === 'video') {
    return (
      <VideoThumb
        src={convertFileSrc(item.file_path)}
        poster={item.thumb_path ? thumbSrcOf(item.thumb_path) : null}
        alt={item.display_name}
        imgClassName="card-thumb-img"
        disableHoverPlay={disableHoverPlay}
      />
    );
  }
  // Prefer the user's custom cover; fall back to embedded album art that the
  // backend auto-extracted into thumb_path.
  const audioCover = item.audio_cover || item.thumb_path;
  if (audioCover) {
    return (
      <img
        src={thumbSrcOf(audioCover)}
        alt={item.display_name}
        className="card-thumb-img"
        loading="lazy"
        draggable={false}
      />
    );
  }
  return (
    <div
      className="card-thumb-placeholder"
      style={{ background: 'linear-gradient(135deg, #1c1917 0%, #44403c 100%)' }}
    >
      <Music size={32} color="rgba(255,255,255,0.4)" />
    </div>
  );
}

const QUICKLOOK_DELAY = 600;

function MediaCard({
  item,
  highlighted,
  checked,
  isSelecting,
  onOpen,
  onViewDetails,
  onContextMenu,
  onStarToggle,
  onCheckToggle,
  onQuickLook,
  onQuickLookEnd,
  onCardDragStart,
  freshThumbSrc = null,
}) {
  const { t } = useTranslation();
  const hoverTimer = useRef(null);
  const clickTimer = useRef(null);
  const dblFired = useRef(false);
  const cardRef = useRef(null);

  function handleClick(e) {
    if (isSelecting) {
      onCheckToggle(item.id, e);
      return;
    }
    dblFired.current = false;
    clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      if (!dblFired.current) onViewDetails(item);
    }, 300);
  }

  function handleDoubleClick(e) {
    e.preventDefault();
    if (isSelecting) return;
    dblFired.current = true;
    clearTimeout(clickTimer.current);
    onOpen(item);
  }

  function handleMouseEnter() {
    if (!onQuickLook) return;
    hoverTimer.current = setTimeout(() => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (rect) onQuickLook(item, rect);
    }, QUICKLOOK_DELAY);
  }

  function handleMouseLeave() {
    clearTimeout(hoverTimer.current);
    onQuickLookEnd?.();
  }

  const TypeIcon = TYPE_ICONS[item.media_type] || Image;

  return (
    <div
      ref={cardRef}
      className={`media-card ${highlighted ? 'highlighted' : ''} ${checked ? 'checked' : ''}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseDown={(e) => {
        if (e.detail > 1) e.preventDefault();
      }}
      onPointerDown={(e) => {
        // Skip the check/star buttons; they have their own handlers.
        if (e.target.closest('button')) return;
        onCardDragStart?.(e, item);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, item);
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="card-thumb">
        <MediaThumbnail item={item} disableHoverPlay={true} freshThumbSrc={freshThumbSrc} />

        <span className={`card-type-badge badge-${item.media_type}`}>
          <TypeIcon size={11} strokeWidth={2.5} />
          {item.media_type !== 'audio' && !item.date_taken && (
            <span className="card-no-capture-date" title={t('mediaGrid.noCaptureDate')}>
              <Clock size={10} />
            </span>
          )}
        </span>

        {item.color_label &&
          (() => {
            const col = COLOR_LABELS.find((c) => c.value === item.color_label);
            return col ? (
              <span
                className="card-color-label"
                style={{ background: col.hex }}
                title={col.label}
              />
            ) : null;
          })()}

        <button
          className={`card-check-btn ${checked ? 'checked' : ''} ${isSelecting ? 'always-show' : ''}`}
          title={checked ? 'Deselect' : 'Select'}
          onClick={(e) => {
            e.stopPropagation();
            onCheckToggle(item.id, e);
          }}
        >
          {checked && <Check size={11} strokeWidth={3} />}
        </button>

        <button
          className={`card-star-btn ${item.starred ? 'starred' : ''}`}
          title={item.starred ? 'Unstar' : 'Star'}
          onClick={(e) => {
            e.stopPropagation();
            onStarToggle(item.id);
          }}
        >
          <Star size={13} />
        </button>
      </div>
      <div className="card-info">
        <p className="card-name" title={item.display_name}>
          {item.display_name}
        </p>
      </div>
    </div>
  );
}

export default memo(MediaCard);
