import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import {
  Play,
  Pause,
  Volume2,
  Volume1,
  VolumeX,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Repeat,
  Repeat1,
  Rewind,
  FlipHorizontal,
  FlipVertical,
  ZoomIn,
  ZoomOut,
  Settings2,
  RotateCcw,
  Camera,
  StepBack,
  StepForward,
  Clipboard,
  Scissors,
  Expand,
  X,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { formatClock } from '../../utils/format';
import { useVideoSrc } from '../../hooks/useVideoSrc';
import useDismiss from '../../hooks/useDismiss';
import useWindowFullscreen from '../../hooks/useWindowFullscreen';
import './VideoPlayer.css';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
// Below this native height, "fit to screen" (upscale to fill the wrap) is
// offered — larger videos already fill the viewport at their own size.
const LOW_RES_HEIGHT_THRESHOLD = 720;
const RESOLUTIONS = [240, 360, 480, 720, 1080, 4096];
// 4096 stands in for "original" (never upscaled, so any real source height
// passes through it as a no-op cap) — the one entry that isn't an "Xp" label.
const resolutionLabel = (r, t) => (r === 4096 ? t('viewer.resolutionOriginal') : `${r}p`);

// Shortest trim range the drag handles allow and the save actions accept —
// mirrors the backend's MIN_TRIM_DURATION_SECS in export.rs. 1 full second,
// not just "long enough to be nonzero": formatClock truncates to whole
// seconds, so anything under 1s can display as e.g. "0:00 – 0:00" for both
// handles even though it's technically a valid few-frame range — visually
// indistinguishable from an empty selection despite producing a real (if
// nearly useless) output. A 1s floor guarantees the two displayed times can
// never read the same value (adding >=1.0 to any number always crosses at
// least one integer boundary), so a non-empty-looking range is always a
// non-empty range.
const MIN_TRIM_DURATION = 1;

// <video> doesn't expose the real frame rate, so frame-stepping uses this as
// an estimate — close enough to land on-frame after a couple of taps even
// when the source is a different rate.
const FRAME_DURATION = 1 / 30;

// Vertical drag distance (px above the seek bar) → horizontal scrub sensitivity.
// Dragging up trades speed for precision, iOS-scrubber style: the higher the
// cursor, the finer each pixel of horizontal movement seeks.
const FINE_TIERS = [
  { maxDy: 40, factor: 1, level: 0 },
  { maxDy: 100, factor: 0.5, level: 1 },
  { maxDy: 170, factor: 0.25, level: 2 },
  { maxDy: Infinity, factor: 0.1, level: 3 },
];
const FINE_LABEL_KEYS = ['scrubNormal', 'scrubHalf', 'scrubQuarter', 'scrubFine'];
const PREVIEW_HALF = 84; // half the preview tooltip width, for edge clamping

function fineTier(dy) {
  return FINE_TIERS.find((tier) => dy <= tier.maxDy) ?? FINE_TIERS[0];
}

export default function VideoPlayer({
  item,
  onFullscreenChange,
  keyboardDisabled = false,
  onFrameSaved,
  onNewItem,
  onItemUpdated,
  onRequestConfirm,
  onToast,
  onError,
}) {
  const { t } = useTranslation();
  const { src: videoSrc, error: videoSrcError } = useVideoSrc(item.file_path);
  const videoRef = useRef(null);
  const wrapRef = useRef(null);
  const seekRef = useRef(null);
  const previewRef = useRef(null); // hidden <video> used to render frame thumbnails
  const dragRef = useRef(null); // active scrub: { lastX, scrubTime }
  const lastPreviewSeek = useRef(-1); // throttle redundant preview seeks
  const lastLeftRef = useRef(0); // cached tooltip x, so it fades out in place
  const hideTimer = useRef(null);
  const hasPlayedRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [looped, setLooped] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [chrome, setChrome] = useState(true);
  const { fullscreen, fullscreenRef, toggleFullscreen, exitFullscreen } =
    useWindowFullscreen(onFullscreenChange);
  const [speedMenu, setSpeedMenu] = useState(false);
  const [hover, setHover] = useState(null); // { left, time } preview tooltip, or null
  const [fineLevel, setFineLevel] = useState(0); // 0=normal … 3=finest, during drag

  // ── Image transforms (zoom / mirror) + reverse playback ────────────────────
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [panning, setPanning] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [transformMenu, setTransformMenu] = useState(false);
  const [videoDims, setVideoDims] = useState(null); // { width, height } from loadedmetadata
  const [fitToScreen, setFitToScreen] = useState(false);
  const isLowRes = videoDims != null && videoDims.height < LOW_RES_HEIGHT_THRESHOLD;

  // ── Trim ─────────────────────────────────────────────────────────────────────
  const [trimMode, setTrimMode] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimBusy, setTrimBusy] = useState(false);
  const [trimMaxHeight, setTrimMaxHeight] = useState(720);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const saveMenuRef = useRef(null);
  const [resMenuOpen, setResMenuOpen] = useState(false);
  const resMenuRef = useRef(null);
  const trimTooShort = trimEnd - trimStart < MIN_TRIM_DURATION;
  // While trimming, every seek path (arrows, frame-step, scrubbing) is
  // confined to the selected range — otherwise "preview the trim" and
  // "the trim is what gets exported" would silently disagree.
  const clampToTrim = useCallback(
    (t) => (trimMode ? Math.max(trimStart, Math.min(trimEnd, t)) : t),
    [trimMode, trimStart, trimEnd],
  );
  const reverseRef = useRef(null); // { raf, last } while playing backward
  const speedRef = useRef(1); // latest speed, read by the reverse loop
  const zoomRef = useRef(1);
  const panPosRef = useRef({ x: 0, y: 0 });
  const panMovedRef = useRef(false); // did the last mousedown turn into a pan?
  // Mirror zoom/pan into refs so the imperative wheel/pan handlers read current
  // values without being recreated each change.
  useEffect(() => {
    zoomRef.current = zoom;
    panPosRef.current = pan;
  }, [zoom, pan]);

  // ── Reveal/auto-hide the control chrome ────────────────────────────────────
  // Auto-hides after idle mouse time regardless of play state or fullscreen —
  // paused-but-untouched should tuck the controls away just like playing does.
  // Suppressed entirely while the cursor is over the controls/center-play
  // button, or while a submenu (speed/advanced) is open — read via refs since
  // the timeout callback shouldn't be recreated every time these toggle.
  const chromeHeldRef = useRef(false); // hovering controls or center-play
  const speedMenuRef = useRef(false);
  const transformMenuRef = useRef(false);
  const trimModeRef = useRef(false);
  useEffect(() => {
    speedMenuRef.current = speedMenu;
  }, [speedMenu]);
  useEffect(() => {
    transformMenuRef.current = transformMenu;
  }, [transformMenu]);
  useEffect(() => {
    trimModeRef.current = trimMode;
  }, [trimMode]);

  const revealChrome = useCallback(() => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (
        chromeHeldRef.current ||
        speedMenuRef.current ||
        transformMenuRef.current ||
        trimModeRef.current
      )
        return;
      setChrome(false);
    }, 3000);
  }, []);

  // Pause the countdown while the cursor sits over the play button or the
  // toolbar; resume (fresh 3s window) once it leaves.
  const holdChrome = useCallback(() => {
    chromeHeldRef.current = true;
    clearTimeout(hideTimer.current);
    setChrome(true);
  }, []);
  const releaseChrome = useCallback(() => {
    chromeHeldRef.current = false;
    revealChrome();
  }, [revealChrome]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // (Re)start the auto-hide timer on mount and whenever fullscreen toggles.
  useEffect(() => {
    revealChrome();
  }, [fullscreen, revealChrome]);

  // ── Reverse playback ────────────────────────────────────────────────────────
  // HTML media elements don't reliably support negative playbackRate, so we step
  // currentTime backwards each animation frame (scaled by the chosen speed).
  const stopReverse = useCallback(() => {
    if (reverseRef.current) {
      cancelAnimationFrame(reverseRef.current.raf);
      reverseRef.current = null;
    }
    setReverse(false);
  }, []);

  const startReverse = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.currentTime <= 0) return;
    v.pause(); // stop forward playback; we drive currentTime ourselves
    setReverse(true);
    const step = (ts) => {
      const vv = videoRef.current;
      const state = reverseRef.current;
      if (!vv || !state) return;
      const dt = (ts - state.last) / 1000;
      state.last = ts;
      const next = vv.currentTime - dt * speedRef.current;
      if (next <= 0) {
        vv.currentTime = 0;
        setCurrent(0);
        stopReverse();
        return;
      }
      vv.currentTime = next;
      setCurrent(next);
      state.raf = requestAnimationFrame(step);
    };
    reverseRef.current = { last: performance.now(), raf: requestAnimationFrame(step) };
  }, [stopReverse]);

  const toggleReverse = useCallback(() => {
    if (reverseRef.current) stopReverse();
    else startReverse();
  }, [startReverse, stopReverse]);

  useEffect(() => () => stopReverse(), [stopReverse]); // cancel on unmount

  // ── Imperative helpers ─────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (reverseRef.current) {
      // Pressing play while reversing resumes normal forward playback.
      stopReverse();
      v.play();
      return;
    }
    if (v.paused) {
      // While trimming, playback previews just the selected range: jump back
      // to the start if we're currently outside it, and (via onTimeUpdate)
      // loop at the end instead of playing past it.
      if (trimMode && (v.currentTime < trimStart || v.currentTime >= trimEnd)) {
        v.currentTime = trimStart;
        setCurrent(trimStart);
      }
      v.play();
    } else v.pause();
  }, [stopReverse, trimMode, trimStart, trimEnd]);

  // Nudge exactly one frame forward/back, for precisely picking a frame to save.
  const stepFrame = useCallback(
    (dir) => {
      const v = videoRef.current;
      if (!v) return;
      if (reverseRef.current) stopReverse();
      if (!v.paused) v.pause();
      const t = v.currentTime + dir * FRAME_DURATION;
      v.currentTime = clampToTrim(Math.max(0, Math.min(v.duration || 0, t)));
      setCurrent(v.currentTime);
      revealChrome();
    },
    [stopReverse, revealChrome, clampToTrim],
  );

  // ── Zoom / mirror transforms ────────────────────────────────────────────────
  const changeZoom = useCallback((next) => {
    const nz = Math.max(1, Math.min(4, +next.toFixed(2)));
    setZoom(nz);
    // Pan re-clamping for the new zoom level happens in the effect below.
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFlipH(false);
    setFlipV(false);
  }, []);

  // ── Save / copy current frame as an image ───────────────────────────────────
  // Draws the raw decoded frame (untransformed by zoom/mirror, which are just
  // CSS on the <video> element) onto a canvas.
  const grabFrameDataUrl = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  }, []);

  // Hands the frame to the backend, which drops it straight into the library
  // (Uncategorized) — no import dialog.
  const handleSaveFrame = useCallback(async () => {
    const dataUrl = grabFrameDataUrl();
    if (!dataUrl) return;
    setTransformMenu(false);
    try {
      const stem = item.display_name || 'frame';
      const fileName = `${stem} frame @ ${Math.floor(videoRef.current.currentTime)}s.jpg`;
      const saved = await invoke('save_video_frame', { dataUrl, fileName });
      onFrameSaved?.(saved);
    } catch (e) {
      onError?.(`Save frame failed: ${e}`);
    }
    releaseChrome();
  }, [grabFrameDataUrl, item.display_name, onFrameSaved, onError, releaseChrome]);

  // Writes real image data to the system clipboard — never touches the
  // library, just a scratch temp file on the Rust side.
  const handleCopyFrame = useCallback(async () => {
    const dataUrl = grabFrameDataUrl();
    if (!dataUrl) return;
    setTransformMenu(false);
    try {
      await invoke('copy_frame_to_clipboard', { dataUrl });
      onToast?.('success', t('viewer.frameCopied'));
    } catch (e) {
      onError?.(`Copy frame failed: ${e}`);
    }
    releaseChrome();
  }, [grabFrameDataUrl, onToast, onError, t, releaseChrome]);

  // ── Trim ─────────────────────────────────────────────────────────────────────
  const openTrim = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setTrimStart(0);
    setTrimEnd(v.duration || 0);
    setTransformMenu(false);
    setTrimMode(true);
    holdChrome();
  }, [holdChrome]);

  const closeTrim = useCallback(() => {
    setTrimMode(false);
    releaseChrome();
  }, [releaseChrome]);

  // Drag either trim handle, or the highlighted range itself (moves both
  // edges together, preserving its length). `edge`'s opposite boundary is
  // read once at drag-start and held for the whole gesture — it can't change
  // mid-drag since only one handle moves at a time, so there's no staleness
  // to guard against with a ref.
  const beginTrimDrag = useCallback(
    (edge) => (e) => {
      e.stopPropagation();
      e.preventDefault();
      const bar = seekRef.current;
      const v = videoRef.current;
      const dur = duration;
      if (!bar || !v || !dur) return;
      v.pause(); // don't fight the trim-loop logic in onTimeUpdate while dragging
      const rect = bar.getBoundingClientRect();
      const ratioAt = (clientX) => Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

      const rangeWidth = trimEnd - trimStart;
      const startRatio = ratioAt(e.clientX);

      const move = (ev) => {
        const t = ratioAt(ev.clientX) * dur;
        let scrubTo;
        if (edge === 'start') {
          scrubTo = Math.min(t, trimEnd - MIN_TRIM_DURATION);
          setTrimStart(scrubTo);
        } else if (edge === 'end') {
          scrubTo = Math.max(t, trimStart + MIN_TRIM_DURATION);
          setTrimEnd(scrubTo);
        } else {
          // Dragging the range body: shift both edges by the same delta.
          const deltaRatio = ratioAt(ev.clientX) - startRatio;
          scrubTo = Math.max(0, Math.min(dur - rangeWidth, trimStart + deltaRatio * dur));
          setTrimStart(scrubTo);
          setTrimEnd(scrubTo + rangeWidth);
        }
        v.currentTime = scrubTo;
        setCurrent(scrubTo);
      };
      const up = () => {
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', up, true);
      };
      move(e);
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    },
    [trimStart, trimEnd, duration],
  );

  const doTrim = useCallback(
    async (mode) => {
      const v = videoRef.current;
      if (!v) return;
      setTrimBusy(true);
      try {
        if (mode === 'gif') {
          const saved = await invoke('export_video_gif', {
            filePath: item.file_path,
            start: trimStart,
            end: trimEnd,
            maxHeight: trimMaxHeight,
          });
          onNewItem?.(saved);
          onToast?.('success', t('viewer.gifSaved'));
        } else {
          const result = await invoke('trim_video', {
            filePath: item.file_path,
            id: item.id,
            start: trimStart,
            end: trimEnd,
            saveMode: mode,
            maxHeight: trimMaxHeight,
          });
          if (mode === 'copy') {
            onNewItem?.(result);
            onToast?.('success', t('viewer.trimSavedNew'));
          } else {
            onItemUpdated?.(result);
            onToast?.('success', t('viewer.trimSaved'));
          }
        }
        setTrimMode(false);
        releaseChrome();
      } catch (e) {
        onError?.(`Trim failed: ${e}`);
      } finally {
        setTrimBusy(false);
      }
    },
    [
      item,
      trimStart,
      trimEnd,
      trimMaxHeight,
      onNewItem,
      onItemUpdated,
      onToast,
      onError,
      t,
      releaseChrome,
    ],
  );

  const handleTrimReplace = useCallback(() => {
    onRequestConfirm?.({
      title: t('viewer.trimReplaceTitle'),
      message: t('viewer.trimReplaceConfirm'),
      confirmLabel: t('viewer.trimReplace'),
      onConfirm: () => {
        onRequestConfirm?.(null);
        doTrim('overwrite');
      },
    });
  }, [onRequestConfirm, doTrim, t]);

  useDismiss(saveMenuRef, () => setSaveMenuOpen(false), { enabled: saveMenuOpen, escape: false });
  useDismiss(resMenuRef, () => setResMenuOpen(false), { enabled: resMenuOpen, escape: false });

  const clampPan = useCallback((x, y) => {
    const wrap = wrapRef.current;
    const z = zoomRef.current;
    if (!wrap || z <= 1) return { x: 0, y: 0 };
    const maxX = (wrap.clientWidth * (z - 1)) / 2;
    const maxY = (wrap.clientHeight * (z - 1)) / 2;
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  }, []);

  // Safety net for zoom paths that don't compute pan themselves (wheel,
  // keyboard +/-, toolbar buttons): whenever zoom changes, pull pan back in
  // bounds for the new zoom level so zooming out can never leave the frame
  // panned off-screen (the valid pan range shrinks as zoom decreases).
  useEffect(() => {
    if (!wrapRef.current) return;
    setPan((p) => clampPan(p.x, p.y));
  }, [zoom, clampPan]);

  const onWheelZoom = useCallback(
    (e) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      changeZoom(zoomRef.current + (e.deltaY > 0 ? -0.25 : 0.25));
    },
    [changeZoom],
  );

  // Drag-to-pan when zoomed in. Registered imperatively (like the scrubber) so a
  // pan that turns into movement can suppress the click-to-play that follows.
  const beginPan = useCallback(
    (e) => {
      if (zoomRef.current <= 1) return;
      e.preventDefault();
      panMovedRef.current = false;
      const base = {
        sx: e.clientX,
        sy: e.clientY,
        px: panPosRef.current.x,
        py: panPosRef.current.y,
      };
      setPanning(true);
      const move = (ev) => {
        const dx = ev.clientX - base.sx;
        const dy = ev.clientY - base.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panMovedRef.current = true;
        setPan(clampPan(base.px + dx, base.py + dy));
      };
      const up = () => {
        setPanning(false);
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', up, true);
      };
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    },
    [clampPan],
  );

  const onVideoClick = useCallback(() => {
    // A pan drag shouldn't also toggle playback.
    if (panMovedRef.current) {
      panMovedRef.current = false;
      return;
    }
    togglePlay();
  }, [togglePlay]);

  const cycleSpeed = useCallback((dir) => {
    setSpeed((s) => {
      const i = SPEEDS.indexOf(s);
      return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))];
    });
  }, []);

  const nudgeVolume = useCallback((delta) => {
    setMuted(false);
    setVolume((v) => Math.max(0, Math.min(1, +(v + delta).toFixed(2))));
  }, []);

  const seekBy = useCallback(
    (delta) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = clampToTrim(Math.max(0, Math.min(v.duration || 0, v.currentTime + delta)));
    },
    [clampToTrim],
  );

  const togglePip = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture?.();
    else v.requestPictureInPicture?.();
  }, []);

  // ── Sync declarative state → media element ──────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const v = videoRef.current;
    speedRef.current = speed;
    if (v) v.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.loop = looped;
  }, [looped]);

  // ── Re-activate preview video after app regains focus ──────────────────────
  // WKWebView suspends media elements when the app loses focus, so currentTime
  // assignments silently fail until a play/pause cycle re-activates the session.
  useEffect(() => {
    const onFocus = () => {
      lastPreviewSeek.current = -1; // force next hover to re-seek
      const p = previewRef.current;
      if (p)
        p.play()
          .then(() => p.pause())
          .catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // ── Frame preview ─────────────────────────────────────────────────────────────
  // Seek the hidden preview <video> to show the frame at `time`. Throttled so
  // rapid mouse movement doesn't queue a flood of seeks.
  const seekPreview = useCallback((time) => {
    const p = previewRef.current;
    if (!p) return;
    if (Math.abs(time - lastPreviewSeek.current) < 0.03) return;
    lastPreviewSeek.current = time;
    try {
      p.currentTime = time;
    } catch {
      /* metadata not loaded yet */
    }
  }, []);

  // Place the preview tooltip at `ratio` along the bar, clamped to stay on-screen.
  const previewLeft = useCallback((ratio, width) => {
    const x = ratio * width;
    return Math.max(PREVIEW_HALF, Math.min(width - PREVIEW_HALF, x));
  }, []);

  // ── Scrubbing ───────────────────────────────────────────────────────────────
  // Hover (no button) just previews the frame under the cursor.
  const onSeekHover = useCallback(
    (e) => {
      if (dragRef.current) return; // a drag is in progress; the window handler owns it
      const bar = seekRef.current;
      if (!bar || !duration) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const time = ratio * duration;
      setHover({ left: previewLeft(ratio, rect.width), time });
      seekPreview(time);
    },
    [duration, previewLeft, seekPreview],
  );

  // Read duration via ref so the drag handlers always see the current value
  // without needing to be recreated when duration changes.
  const durationRef = useRef(0);
  durationRef.current = duration;

  const beginScrub = useCallback(
    (e) => {
      const bar = seekRef.current;
      const v = videoRef.current;
      const dur = durationRef.current;
      if (!bar || !v || !dur) return;

      // Scrubbing and the reverse-playback loop both drive currentTime; stop
      // reverse so they don't fight over the position.
      const wasReversing = !!reverseRef.current;
      if (wasReversing) stopReverse();

      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const time = clampToTrim(ratio * dur);
      const wasPlaying = !v.paused && !wasReversing;
      if (wasPlaying) v.pause();
      dragRef.current = { lastX: e.clientX, scrubTime: time, wasPlaying };
      setCurrent(time);
      v.currentTime = time;
      setHover({ left: previewLeft(ratio, rect.width), time });
      seekPreview(time);
      setSeeking(true);

      // Register handlers imperatively so moves are never missed due to the
      // React render cycle that would delay a useEffect-based registration.
      const move = (ev) => {
        const vv = videoRef.current;
        const drag = dragRef.current;
        const b = seekRef.current;
        const d = durationRef.current;
        if (!b || !vv || !drag || !d) return;
        const r = b.getBoundingClientRect();
        const dy = Math.max(0, r.top - ev.clientY);
        const tier = fineTier(dy);

        let t;
        if (tier.level === 0) {
          const rx = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
          t = rx * d;
        } else {
          const dx = ev.clientX - drag.lastX;
          t = Math.max(0, Math.min(d, drag.scrubTime + (dx / r.width) * d * tier.factor));
        }
        t = clampToTrim(t);

        drag.lastX = ev.clientX;
        drag.scrubTime = t;
        setCurrent(t);
        vv.currentTime = t;
        setFineLevel(tier.level);
        setHover({ left: previewLeft(t / d, r.width), time: t });
        seekPreview(t);
      };

      const up = () => {
        const vv = videoRef.current;
        const drag = dragRef.current;
        if (vv && drag?.wasPlaying) vv.play();
        setSeeking(false);
        setFineLevel(0);
        setHover(null);
        dragRef.current = null;
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', up, true);
        window.removeEventListener('blur', up);
      };

      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
      window.addEventListener('blur', up);
    },
    [previewLeft, seekPreview, stopReverse, clampToTrim],
  );

  // ── Close the speed menu on outside click ───────────────────────────────────
  useEffect(() => {
    if (!speedMenu) return;
    const close = (e) => {
      if (!e.target.closest?.('.vp-speed')) {
        setSpeedMenu(false);
        releaseChrome();
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [speedMenu, releaseChrome]);

  // ── Close the transform menu on outside click ───────────────────────────────
  useEffect(() => {
    if (!transformMenu) return;
    const close = (e) => {
      if (!e.target.closest?.('.vp-transform')) {
        setTransformMenu(false);
        releaseChrome();
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [transformMenu, releaseChrome]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (keyboardDisabled) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case 'Escape':
          if (fullscreenRef.current) {
            // Consume the event so FileViewer doesn't also close
            e.stopImmediatePropagation();
            exitFullscreen();
          }
          break;
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          if (!hasPlayedRef.current) break;
          e.preventDefault();
          e.stopImmediatePropagation();
          seekBy(-5);
          revealChrome();
          break;
        case 'ArrowRight':
          if (!hasPlayedRef.current) break;
          e.preventDefault();
          e.stopImmediatePropagation();
          seekBy(5);
          revealChrome();
          break;
        case ',':
          e.preventDefault();
          stepFrame(-1);
          break;
        case '.':
          e.preventDefault();
          stepFrame(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          nudgeVolume(0.1);
          revealChrome();
          break;
        case 'ArrowDown':
          e.preventDefault();
          nudgeVolume(-0.1);
          revealChrome();
          break;
        case 'm':
        case 'M':
          setMuted((v) => !v);
          break;
        case 'l':
        case 'L':
          setLooped((v) => !v);
          break;
        case '[':
          cycleSpeed(-1);
          break;
        case ']':
          cycleSpeed(1);
          break;
        case '+':
        case '=':
          changeZoom(zoomRef.current + 0.25);
          break;
        case '-':
          changeZoom(zoomRef.current - 0.25);
          break;
        case '0':
          resetView();
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        default:
          break;
      }
    };
    // Capture phase so we can stopImmediatePropagation before FileViewer's handler
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [
    keyboardDisabled,
    togglePlay,
    seekBy,
    stepFrame,
    nudgeVolume,
    cycleSpeed,
    toggleFullscreen,
    exitFullscreen,
    revealChrome,
    changeZoom,
    resetView,
  ]);

  // ── Media element events ────────────────────────────────────────────────────
  function onTimeUpdate() {
    const v = videoRef.current;
    if (!seeking) setCurrent(v?.currentTime ?? 0);
    // Trim preview: loop the selected range instead of playing past it.
    if (trimMode && v && !v.paused && v.currentTime >= trimEnd) {
      v.currentTime = trimStart;
      setCurrent(trimStart);
    }
  }
  function onLoadedMetadata() {
    const v = videoRef.current;
    setDuration(v?.duration ?? 0);
    if (v) setVideoDims({ width: v.videoWidth, height: v.videoHeight });
  }
  function onProgress() {
    const v = videoRef.current;
    if (v && v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
  }

  const progress = duration > 0 ? current / duration : 0;
  const bufferedPct = duration > 0 ? Math.min(1, buffered / duration) * 100 : 0;
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  // Hold the last preview position so the tooltip fades out in place instead of
  // jumping back to the start when `hover` clears.
  if (hover) lastLeftRef.current = hover.left;
  const previewPos = hover?.left ?? lastLeftRef.current;

  const transformed = zoom !== 1 || flipH || flipV;
  const videoTransform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom * (flipH ? -1 : 1)}, ${zoom * (flipV ? -1 : 1)})`;
  const videoCursor = zoom > 1 ? (panning ? 'grabbing' : 'grab') : undefined;

  return (
    <div
      ref={wrapRef}
      className={`vp-wrap${chrome ? '' : ' vp-chrome-off'}${fullscreen ? ' vp-fullscreen' : ''}`}
      onMouseMove={revealChrome}
      onMouseLeave={() => setChrome(false)}
    >
      <video
        ref={videoRef}
        src={videoSrc ?? undefined}
        className={`vp-video${fitToScreen ? ' vp-video-fit' : ''}`}
        style={{
          transform: videoTransform,
          transition: panning ? 'none' : 'transform 0.18s ease',
          cursor: videoCursor,
        }}
        onClick={onVideoClick}
        onDoubleClick={toggleFullscreen}
        onMouseDown={beginPan}
        onWheel={onWheelZoom}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onProgress={onProgress}
        onPlay={() => {
          hasPlayedRef.current = true;
          setPlaying(true);
          revealChrome();
        }}
        onPause={() => {
          setPlaying(false);
          setChrome(true);
        }}
        playsInline
      />

      {/* Formats WKWebView can't decode natively get transcoded (via ffmpeg,
          if installed) on first play; that can take a while for a large
          file, so show progress instead of a player that looks broken/frozen. */}
      {!videoSrc && !videoSrcError && (
        <div className="vp-converting">
          <div className="vp-converting-spinner" />
          <span>{t('viewer.convertingVideo')}</span>
        </div>
      )}

      {/* Transcode failed — most commonly ffmpeg isn't installed. Show the
          real reason instead of silently trying to play the untranscoded
          file (which would just be a blank/broken player). */}
      {videoSrcError && (
        <div className="vp-converting vp-convert-error">
          <AlertTriangle size={22} />
          <span>{t('viewer.transcodeFailed')}</span>
          <span className="vp-convert-error-detail">{videoSrcError}</span>
        </div>
      )}

      {/* Center play affordance while paused (hidden while playing backward) */}
      {videoSrc && !playing && !reverse && (
        <button
          className="vp-center-play"
          onClick={togglePlay}
          onMouseEnter={holdChrome}
          onMouseLeave={releaseChrome}
          title={t('viewer.play')}
        >
          <Play size={30} fill="currentColor" />
        </button>
      )}

      {/* Control bar */}
      <div
        className="vp-controls"
        onClick={(e) => e.stopPropagation()}
        onMouseMove={(e) => e.stopPropagation()}
        onMouseEnter={holdChrome}
        onMouseLeave={releaseChrome}
      >
        {trimMode && (
          <div className="vp-trim-bar">
            <span className="vp-trim-range-label">
              {formatClock(trimStart)} – {formatClock(trimEnd)} ({formatClock(trimEnd - trimStart)})
            </span>
            <span className="vp-trim-hint">{t('viewer.trimDragHint')}</span>
            <div className="vp-trim-spacer" />
            <div className="vp-trim-res-wrap" ref={resMenuRef}>
              <button
                className="vp-trim-btn vp-trim-res-btn"
                onClick={() => setResMenuOpen((v) => !v)}
                disabled={trimBusy}
                title={t('viewer.resolutionTitle')}
              >
                {resolutionLabel(trimMaxHeight, t)}
                <ChevronDown size={12} />
              </button>
              {resMenuOpen && (
                <div className="vp-trim-res-menu">
                  {RESOLUTIONS.map((r) => (
                    <button
                      key={r}
                      className={`vp-trim-res-item${r === trimMaxHeight ? ' selected' : ''}`}
                      onClick={() => {
                        setTrimMaxHeight(r);
                        setResMenuOpen(false);
                      }}
                    >
                      {resolutionLabel(r, t)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="vp-trim-save-wrap" ref={saveMenuRef}>
              <button
                className="vp-trim-btn vp-trim-save-btn"
                onClick={() => setSaveMenuOpen((v) => !v)}
                disabled={trimBusy || trimTooShort}
              >
                {t('common.save')}
                <ChevronDown size={12} />
              </button>
              {saveMenuOpen && (
                <div className="vp-trim-save-menu">
                  <button
                    className="vp-trim-save-item"
                    onClick={() => {
                      setSaveMenuOpen(false);
                      doTrim('copy');
                    }}
                  >
                    {t('viewer.trimSaveNew')}
                  </button>
                  <button
                    className="vp-trim-save-item"
                    onClick={() => {
                      setSaveMenuOpen(false);
                      handleTrimReplace();
                    }}
                  >
                    {t('viewer.trimReplace')}
                  </button>
                  <button
                    className="vp-trim-save-item"
                    onClick={() => {
                      setSaveMenuOpen(false);
                      doTrim('gif');
                    }}
                  >
                    {t('viewer.trimSaveGif')}
                  </button>
                </div>
              )}
            </div>
            <button
              className="vp-trim-btn vp-trim-cancel"
              onClick={closeTrim}
              disabled={trimBusy}
              title={t('common.cancel')}
            >
              <X size={13} />
            </button>
          </div>
        )}

        <div className="vp-bar">
          <button
            className="vp-btn"
            onClick={() => {
              seekBy(-5);
              revealChrome();
            }}
            title={t('viewer.seekBack5')}
          >
            <StepBack size={15} />
          </button>

          <button
            className="vp-btn vp-btn-play"
            onClick={togglePlay}
            title={playing ? t('viewer.pause') : t('viewer.play')}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>

          <button
            className="vp-btn"
            onClick={() => {
              seekBy(5);
              revealChrome();
            }}
            title={t('viewer.seekForward5')}
          >
            <StepForward size={15} />
          </button>

          <div className="vp-volume">
            <button
              className="vp-btn"
              onClick={() => setMuted((v) => !v)}
              title={muted || volume === 0 ? t('viewer.unmute') : t('viewer.mute')}
            >
              <VolIcon size={17} />
            </button>
            <input
              type="range"
              className="vp-volume-slider"
              min="0"
              max="1"
              step="0.02"
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                setMuted(false);
              }}
              title={t('viewer.volume')}
              style={{ '--vol-pct': `${(muted ? 0 : volume) * 100}%` }}
            />
          </div>

          <span className="vp-time">
            {formatClock(current)} <span className="vp-time-sep">/</span> {formatClock(duration)}
          </span>

          <div
            ref={seekRef}
            className="vp-seek"
            onMouseDown={beginScrub}
            onMouseMove={onSeekHover}
            onMouseLeave={() => {
              if (!dragRef.current) setHover(null);
            }}
          >
            {/* Frame preview tooltip — follows the cursor (or scrub point while dragging) */}
            <div
              className={`vp-preview${hover ? ' vp-preview-on' : ''}`}
              style={{ left: `${previewPos}px` }}
            >
              <video
                ref={previewRef}
                className="vp-preview-video"
                src={videoSrc ?? undefined}
                muted
                preload="auto"
                playsInline
              />
              {fineLevel > 0 && (
                <div className="vp-preview-badge">{t(`viewer.${FINE_LABEL_KEYS[fineLevel]}`)}</div>
              )}
              <div className="vp-preview-time">{formatClock(hover?.time ?? 0)}</div>
            </div>

            <div className="vp-seek-buffered" style={{ width: `${bufferedPct}%` }} />
            {trimMode && duration > 0 && (
              <div
                className="vp-trim-selection"
                style={{
                  left: `${(trimStart / duration) * 100}%`,
                  width: `${((trimEnd - trimStart) / duration) * 100}%`,
                }}
                onMouseDown={beginTrimDrag('range')}
              >
                <div
                  className="vp-trim-handle vp-trim-handle-start"
                  onMouseDown={beginTrimDrag('start')}
                />
                <div
                  className="vp-trim-handle vp-trim-handle-end"
                  onMouseDown={beginTrimDrag('end')}
                />
                {current >= trimStart && current <= trimEnd && (
                  <div
                    className="vp-trim-playhead"
                    style={{
                      left: `${trimEnd > trimStart ? ((current - trimStart) / (trimEnd - trimStart)) * 100 : 0}%`,
                    }}
                  />
                )}
              </div>
            )}
            {!trimMode && (
              <>
                <div className="vp-seek-fill" style={{ width: `${progress * 100}%` }} />
                <div className="vp-seek-thumb" style={{ left: `${progress * 100}%` }} />
              </>
            )}
          </div>

          <div className="vp-speed">
            <button
              className={`vp-btn vp-speed-btn${speed !== 1 ? ' vp-btn-active' : ''}`}
              onClick={() => {
                setSpeedMenu((v) => !v);
                holdChrome();
              }}
              title={t('viewer.playbackSpeed')}
            >
              {speed === 1 ? '1×' : `${speed}×`}
            </button>
            {speedMenu && (
              <div className="vp-speed-menu">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={`vp-speed-option${s === speed ? ' selected' : ''}`}
                    onClick={() => {
                      setSpeed(s);
                      setSpeedMenu(false);
                      releaseChrome();
                    }}
                  >
                    {s === 1 ? '1×' : `${s}×`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="vp-transform">
            <button
              className={`vp-btn${transformed ? ' vp-btn-active' : ''}`}
              onClick={() => {
                setTransformMenu((v) => !v);
                holdChrome();
              }}
              title={t('viewer.transform')}
            >
              <Settings2 size={16} />
            </button>
            {transformMenu && (
              <div className="vp-transform-menu">
                <button className="vp-transform-option" onClick={handleSaveFrame}>
                  <Camera size={13} />
                  {t('viewer.saveFrame')}
                </button>
                <button className="vp-transform-option" onClick={handleCopyFrame}>
                  <Clipboard size={13} />
                  {t('viewer.copyFrame')}
                </button>
                <button className="vp-transform-option" onClick={openTrim}>
                  <Scissors size={13} />
                  {t('viewer.trimVideo')}
                </button>
                {isLowRes && (
                  <button
                    className={`vp-transform-option${fitToScreen ? ' selected' : ''}`}
                    onClick={() => setFitToScreen((v) => !v)}
                  >
                    <Expand size={13} />
                    {t('viewer.fitToScreen')}
                  </button>
                )}
                <div className="vp-transform-sep" />
                <button
                  className={`vp-transform-option${reverse ? ' selected' : ''}`}
                  onClick={toggleReverse}
                >
                  <Rewind size={13} />
                  {t('viewer.playBackward')}
                </button>
                <div className="vp-transform-sep" />
                <button
                  className={`vp-transform-option${flipH ? ' selected' : ''}`}
                  onClick={() => setFlipH((v) => !v)}
                >
                  <FlipHorizontal size={13} />
                  {t('viewer.mirrorH')}
                </button>
                <button
                  className={`vp-transform-option${flipV ? ' selected' : ''}`}
                  onClick={() => setFlipV((v) => !v)}
                >
                  <FlipVertical size={13} />
                  {t('viewer.mirrorV')}
                </button>
                <div className="vp-transform-sep" />
                <button
                  className="vp-transform-option"
                  onClick={() => changeZoom(zoom + 0.25)}
                  disabled={zoom >= 4}
                >
                  <ZoomIn size={13} />
                  {t('viewer.zoomIn')}
                </button>
                <button
                  className="vp-transform-option"
                  onClick={() => changeZoom(zoom - 0.25)}
                  disabled={zoom <= 1}
                >
                  <ZoomOut size={13} />
                  {t('viewer.zoomOut')}
                  {zoom !== 1 && <span className="vp-zoom-pct">{Math.round(zoom * 100)}%</span>}
                </button>
                <div className="vp-transform-sep" />
                <button className="vp-transform-option" onClick={resetView} disabled={!transformed}>
                  <RotateCcw size={13} />
                  {t('viewer.resetView')}
                </button>
              </div>
            )}
          </div>

          <button
            className={`vp-btn${looped ? ' vp-btn-active' : ''}`}
            onClick={() => setLooped((v) => !v)}
            title={looped ? t('viewer.loopOn') : t('viewer.loopOff')}
          >
            {looped ? <Repeat1 size={16} /> : <Repeat size={16} />}
          </button>

          <button className="vp-btn" onClick={togglePip} title={t('viewer.pictureInPicture')}>
            <PictureInPicture2 size={16} />
          </button>

          <button
            className="vp-btn"
            onClick={toggleFullscreen}
            title={fullscreen ? t('viewer.exitFullScreen') : t('viewer.fullScreen')}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
