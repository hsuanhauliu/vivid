import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { useDisplayableSrc } from '../../hooks/useDisplayableSrc';
import { transformOrigin, panForZoomAtPoint, clampPan } from '../../utils/zoomPan';
import {
  ArrowLeft,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Scaling,
  Undo2,
  Redo2,
  Save,
  CopyPlus,
  ZoomIn,
  ZoomOut,
  Lock,
  LockOpen,
  Crop,
  Check,
} from 'lucide-react';
import SaveCopyModal from '../modals/SaveCopyModal';
import './ImageEditorPage.css';

// ── Pure helpers ──────────────────────────────────────────────────────────────

// Bakes `ops` (rotate/flip/crop/resize) onto a canvas, starting from the
// original decoded image — mirrors exactly what the Rust backend's
// transform_image applies sequentially in src-tauri/src/commands/export.rs,
// so what's shown here is what actually gets saved. Previously rotate/flip
// had a cheap CSS-only preview and crop had none at all (silently ignored),
// so cropping looked like nothing happened; compositing everything through
// one pipeline fixes both and keeps multi-op chains (e.g. rotate then crop)
// visually consistent with the saved result.
function renderOpsToCanvas(sourceImg, ops) {
  let canvas = document.createElement('canvas');
  canvas.width = sourceImg.naturalWidth;
  canvas.height = sourceImg.naturalHeight;
  canvas.getContext('2d').drawImage(sourceImg, 0, 0);

  for (const op of ops) {
    if (op.startsWith('crop:')) {
      const [x, y, w, h] = op.slice(5).split(',').map(Number);
      const next = document.createElement('canvas');
      next.width = Math.max(1, Math.round(w));
      next.height = Math.max(1, Math.round(h));
      next.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, next.width, next.height);
      canvas = next;
    } else if (op.startsWith('resize:')) {
      const [w, h] = op.slice(7).split(',').map(Number);
      const next = document.createElement('canvas');
      next.width = Math.max(1, Math.round(w));
      next.height = Math.max(1, Math.round(h));
      next.getContext('2d').drawImage(canvas, 0, 0, next.width, next.height);
      canvas = next;
    } else if (op === 'rotate90' || op === 'rotate180' || op === 'rotate270') {
      const deg = op === 'rotate90' ? 90 : op === 'rotate180' ? 180 : 270;
      const swap = deg !== 180;
      const next = document.createElement('canvas');
      next.width = swap ? canvas.height : canvas.width;
      next.height = swap ? canvas.width : canvas.height;
      const ctx = next.getContext('2d');
      ctx.translate(next.width / 2, next.height / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      canvas = next;
    } else if (op === 'flip_h' || op === 'flip_v') {
      // Matches the CSS scale(-1,1)/scale(1,-1) semantics these op names had
      // in the old preview — a plain left-right / top-bottom mirror on
      // screen, whatever the Rust side's image-crate calls internally.
      const next = document.createElement('canvas');
      next.width = canvas.width;
      next.height = canvas.height;
      const ctx = next.getContext('2d');
      if (op === 'flip_h') {
        ctx.translate(next.width, 0);
        ctx.scale(-1, 1);
      } else {
        ctx.translate(0, next.height);
        ctx.scale(1, -1);
      }
      ctx.drawImage(canvas, 0, 0);
      canvas = next;
    }
  }
  return canvas;
}

// ── Component ─────────────────────────────────────────────────────────────────

const ImageEditorPage = forwardRef(function ImageEditorPage(
  {
    item,
    collections,
    folders,
    allItems,
    onExit,
    onNewItem,
    onSaved,
    onItemUpdated,
    initialSrc = null,
  },
  ref,
) {
  const { t } = useTranslation();
  const [pendingOps, setPendingOps] = useState([]);
  const [undoneOps, setUndoneOps] = useState([]);
  const [transforming, setTransforming] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [freshSrc, setFreshSrc] = useState(initialSrc);
  const freshSrcRef = useRef(initialSrc);

  // Composited preview reflecting all pendingOps baked in (see renderOpsToCanvas);
  // null when there are no pending ops, in which case the raw image is shown as-is.
  const [previewUrl, setPreviewUrl] = useState(null);

  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showSaveCopyModal, setShowSaveCopyModal] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const afterNavRef = useRef(null);

  // Crop
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState(null); // {x,y,w,h} in image coords
  const [mouseImgPos, setMouseImgPos] = useState(null); // {x,y} in image coords

  // Status bar
  const [imgNaturalSize, setImgNaturalSize] = useState(null); // {w, h}

  // Resize modal
  const [showResize, setShowResize] = useState(false);
  const [resizeW, setResizeW] = useState('');
  const [resizeH, setResizeH] = useState('');
  const [ratioLocked, setRatioLocked] = useState(true);
  const naturalRatio = useRef(null);

  const imgRef = useRef(null);
  const canvasRef = useRef(null);

  const displaySrc = useDisplayableSrc(item.file_path);
  const imgSrc = freshSrc || (displaySrc ?? null);

  // Recompute the composited preview whenever the pending op list changes.
  // Always starts fresh from the original image (not the previous preview),
  // so it can never drift from what a real save would produce.
  //
  // `imgSrc` is a Tauri asset-protocol URL (from convertFileSrc), a different
  // origin than the app itself — loading it straight into an <img>/Image and
  // drawing that onto a canvas taints the canvas (confirmed via a real
  // SecurityError from canvas.toDataURL, not assumed), even though *displaying*
  // it directly works fine. Fetching it as a blob first and loading the
  // resulting same-origin blob: URL avoids the taint entirely — the same
  // pattern loadFreshBlob() below already uses successfully elsewhere in this
  // file for the exact same kind of URL.
  useEffect(() => {
    if (!imgSrc || pendingOps.length === 0) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      let blobUrl = null;
      try {
        const res = await fetch(imgSrc, { cache: 'no-store' });
        const blob = await res.blob();
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        const source = new Image();
        source.onload = () => {
          if (!cancelled) {
            try {
              const canvas = renderOpsToCanvas(source, pendingOps);
              setPreviewUrl(canvas.toDataURL('image/png'));
            } catch (e) {
              console.error('Edit preview render failed:', e);
            }
          }
          URL.revokeObjectURL(blobUrl);
        };
        source.onerror = () => {
          if (!cancelled) console.error('Edit preview: failed to load fetched image blob');
          URL.revokeObjectURL(blobUrl);
        };
        source.src = blobUrl;
      } catch (e) {
        if (!cancelled) console.error('Edit preview: fetch failed:', e);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imgSrc, pendingOps]);

  useImperativeHandle(
    ref,
    () => ({
      tryExit(afterExit) {
        if (pendingOps.length === 0) {
          onExit(item);
          afterExit?.();
        } else {
          afterNavRef.current = afterExit ?? null;
          setShowDiscardConfirm(true);
        }
      },
    }),
    [pendingOps, item, onExit],
  );

  // ── Image / blob helpers ────────────────────────────────────────────────────

  async function loadFreshBlob(src) {
    try {
      const res = await fetch(src, { cache: 'no-store' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      freshSrcRef.current = url;
      setFreshSrc(url);
      return url;
    } catch {
      return null;
    }
  }

  async function commitWrite(filePath = item.file_path, itemId = item.id) {
    let dispPath = filePath;
    try {
      dispPath = await invoke('get_displayable_path', { filePath });
    } catch {
      /* keep raw */
    }
    const blobUrl = await loadFreshBlob(convertFileSrc(dispPath));
    invoke('regenerate_single_thumbnail', { id: itemId, filePath }).catch(() => {});
    onSaved?.(blobUrl, itemId);
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const anyModal = showSaveConfirm || showSaveCopyModal || showDiscardConfirm || showResize;
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (cropMode) {
          exitCropMode();
          return;
        }
        if (showSaveConfirm) {
          setShowSaveConfirm(false);
          return;
        }
        if (showSaveCopyModal) {
          setShowSaveCopyModal(false);
          return;
        }
        if (showResize) {
          setShowResize(false);
          return;
        }
        if (showDiscardConfirm) {
          setShowDiscardConfirm(false);
          return;
        }
        handleBack();
        return;
      }
      if (anyModal || cropMode) return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
          return;
        }
        if (e.key === 'z' && e.shiftKey) {
          e.preventDefault();
          handleRedo();
          return;
        }
        if (e.key === 'y') {
          e.preventDefault();
          handleRedo();
          return;
        }
        if (e.key === 's' && pendingOps.length > 0) {
          e.preventDefault();
          setShowSaveConfirm(true);
          return;
        }
      }
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(s + 0.25, 5));
      if (e.key === '-') setScale((s) => Math.max(s - 0.25, 0.25));
      if (e.key === '0') {
        setScale(1);
        setPan({ x: 0, y: 0 });
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showSaveConfirm, showSaveCopyModal, showDiscardConfirm, showResize, pendingOps, cropMode]);

  // Safety net for zoom paths that don't compute pan themselves (keyboard
  // +/-, toolbar buttons): whenever scale changes, pull pan back in bounds
  // for the new scale so the image can never end up panned off-frame.
  useEffect(() => {
    const img = imgRef.current,
      canvas = canvasRef.current;
    if (!img || !canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    setPan((p) =>
      clampPan(p, scale, img.offsetWidth, img.offsetHeight, canvasRect.width, canvasRect.height),
    );
  }, [scale]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  function handleBack() {
    afterNavRef.current = null;
    if (pendingOps.length > 0) setShowDiscardConfirm(true);
    else onExit(item);
  }
  function handleUndo() {
    if (!pendingOps.length) return;
    const op = pendingOps[pendingOps.length - 1];
    setPendingOps((p) => p.slice(0, -1));
    setUndoneOps((p) => [...p, op]);
  }
  function handleRedo() {
    if (!undoneOps.length) return;
    const op = undoneOps[undoneOps.length - 1];
    setUndoneOps((p) => p.slice(0, -1));
    setPendingOps((p) => [...p, op]);
  }
  function queueTransform(op) {
    setPendingOps((p) => [...p, op]);
    setUndoneOps([]);
  }

  // ── Crop ────────────────────────────────────────────────────────────────────

  function exitCropMode() {
    setCropMode(false);
    setCropRect(null);
    setMouseImgPos(null);
  }
  function applyCrop() {
    if (!cropRect || cropRect.w < 1 || cropRect.h < 1) return;
    queueTransform(
      `crop:${Math.round(cropRect.x)},${Math.round(cropRect.y)},${Math.round(cropRect.w)},${Math.round(cropRect.h)}`,
    );
    exitCropMode();
  }

  // Convert client position → image-space coords (clamped to image bounds).
  // Returns null if image isn't ready yet.
  function getImageCoords(clientX, clientY) {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return null;
    const ir = img.getBoundingClientRect();
    if (!ir.width) return null;
    // The displayed image (raw or composited preview) already reflects every
    // pending op, rotation included — its own naturalWidth/Height are the
    // current effective dimensions, no rotation-aware swap needed anymore.
    const effW = img.naturalWidth;
    const effH = img.naturalHeight;
    const ts = ir.width / effW;
    const px = clientX - ir.left;
    const py = clientY - ir.top;
    return {
      x: Math.max(0, Math.min(effW, px / ts)),
      y: Math.max(0, Math.min(effH, py / ts)),
      effW,
      effH,
      ts,
      onImage: px >= 0 && px <= ir.width && py >= 0 && py <= ir.height,
    };
  }

  // Mouse down on the canvas background → start a new crop drag, or (outside
  // crop mode) pan the image around.
  function handleCanvasMouseDown(e) {
    if (e.button !== 0) return;
    if (!cropMode) {
      beginPan(e);
      return;
    }
    e.preventDefault();
    const c = getImageCoords(e.clientX, e.clientY);
    if (!c) return;
    setCropRect({ x: c.x, y: c.y, w: 0, h: 0 });

    const onMove = (ev) => {
      const m = getImageCoords(ev.clientX, ev.clientY);
      if (!m) return;
      setCropRect({
        x: Math.min(c.x, m.x),
        y: Math.min(c.y, m.y),
        w: Math.abs(m.x - c.x),
        h: Math.abs(m.y - c.y),
      });
    };
    const onUp = (ev) => {
      onMove(ev);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Drag-to-pan when not cropping. Mirrors the crop drag's window-level
  // listener pattern so a gesture is never missed while the mouse leaves
  // the canvas bounds.
  function beginPan(e) {
    if (scale <= 1) return; // nothing to pan when the image already fits
    e.preventDefault();
    const startX = e.clientX,
      startY = e.clientY;
    const startPan = pan;

    const onMove = (ev) => {
      const img = imgRef.current,
        canvas = canvasRef.current;
      if (!img || !canvas) return;
      const next = { x: startPan.x + (ev.clientX - startX), y: startPan.y + (ev.clientY - startY) };
      const canvasRect = canvas.getBoundingClientRect();
      setPan(
        clampPan(
          next,
          scale,
          img.offsetWidth,
          img.offsetHeight,
          canvasRect.width,
          canvasRect.height,
        ),
      );
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Mouse down on a resize handle (handle = combination of 'n','s','e','w')
  function handleCropHandleMouseDown(e, handle) {
    e.preventDefault();
    e.stopPropagation();
    const start = getImageCoords(e.clientX, e.clientY);
    if (!start || !cropRect) return;
    const r0 = { ...cropRect };
    const left0 = r0.x,
      top0 = r0.y,
      right0 = r0.x + r0.w,
      bottom0 = r0.y + r0.h;

    const onMove = (ev) => {
      const c = getImageCoords(ev.clientX, ev.clientY);
      if (!c) return;
      const dx = c.x - start.x,
        dy = c.y - start.y;
      let left = left0,
        top = top0,
        right = right0,
        bottom = bottom0;
      if (handle.includes('w')) left = Math.min(right - 1, left0 + dx);
      if (handle.includes('e')) right = Math.max(left + 1, right0 + dx);
      if (handle.includes('n')) top = Math.min(bottom - 1, top0 + dy);
      if (handle.includes('s')) bottom = Math.max(top + 1, bottom0 + dy);
      left = Math.max(0, left);
      top = Math.max(0, top);
      right = Math.min(c.effW, right);
      bottom = Math.min(c.effH, bottom);
      setCropRect({ x: left, y: top, w: right - left, h: bottom - top });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Mouse down on the crop selection interior → move the rect
  function handleCropMoveMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const start = getImageCoords(e.clientX, e.clientY);
    if (!start || !cropRect) return;
    const r0 = { ...cropRect };

    const onMove = (ev) => {
      const c = getImageCoords(ev.clientX, ev.clientY);
      if (!c) return;
      const dx = c.x - start.x,
        dy = c.y - start.y;
      setCropRect({
        ...r0,
        x: Math.max(0, Math.min(c.effW - r0.w, r0.x + dx)),
        y: Math.max(0, Math.min(c.effH - r0.h, r0.y + dy)),
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function handleCanvasMouseMove(e) {
    const c = getImageCoords(e.clientX, e.clientY);
    if (c?.onImage) setMouseImgPos({ x: Math.round(c.x), y: Math.round(c.y) });
    else setMouseImgPos(null);
  }
  function handleCanvasMouseLeave() {
    setMouseImgPos(null);
  }

  // Trackpad/wheel zoom — mirrors the video player's onWheelZoom behavior.
  function handleCanvasWheel(e) {
    if (e.deltaY === 0) return;
    e.preventDefault();
    const img = imgRef.current,
      canvas = canvasRef.current;
    const newScale = Math.max(
      0.25,
      Math.min(5, +(scale + (e.deltaY > 0 ? -0.25 : 0.25)).toFixed(2)),
    );
    if (newScale === scale || !img || !canvas) {
      setScale(newScale);
      return;
    }
    // Zoom around the cursor, not the image center, so the user can zoom
    // into any part of the image rather than always ending up re-centered.
    const rect = img.getBoundingClientRect();
    const origin = transformOrigin(rect, pan);
    const rawPan = panForZoomAtPoint(e.clientX, e.clientY, origin, scale, newScale, pan);
    const canvasRect = canvas.getBoundingClientRect();
    setScale(newScale);
    setPan(
      clampPan(
        rawPan,
        newScale,
        img.offsetWidth,
        img.offsetHeight,
        canvasRect.width,
        canvasRect.height,
      ),
    );
  }

  // ── Resize modal ────────────────────────────────────────────────────────────

  function openResize() {
    const nw = imgRef.current?.naturalWidth ?? 0;
    const nh = imgRef.current?.naturalHeight ?? 0;
    naturalRatio.current = nh > 0 ? nw / nh : null;
    setResizeW(nw ? String(nw) : '');
    setResizeH(nh ? String(nh) : '');
    setRatioLocked(true);
    setShowResize(true);
  }
  function handleResizeW(val) {
    setResizeW(val);
    if (ratioLocked && naturalRatio.current && val) {
      const w = parseInt(val, 10);
      if (w > 0) setResizeH(String(Math.round(w / naturalRatio.current)));
    }
  }
  function handleResizeH(val) {
    setResizeH(val);
    if (ratioLocked && naturalRatio.current && val) {
      const h = parseInt(val, 10);
      if (h > 0) setResizeW(String(Math.round(h * naturalRatio.current)));
    }
  }
  function applyResize() {
    const w = parseInt(resizeW, 10),
      h = parseInt(resizeH, 10);
    if (!w || !h || w < 1 || h < 1) return;
    setShowResize(false);
    queueTransform(`resize:${w},${h}`);
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function applyAllTransforms(saveMode, copyDest = null) {
    setShowSaveConfirm(false);
    setShowSaveCopyModal(false);
    setTransforming(true);
    const ops = [...pendingOps];
    setPendingOps([]);
    setUndoneOps([]);
    try {
      let targetPath = item.file_path,
        targetId = item.id;
      let firstCopy = null,
        overwriteUpdated = null;
      for (let i = 0; i < ops.length; i++) {
        const mode = saveMode === 'copy' && i === 0 ? 'copy' : 'overwrite';
        const result = await invoke('transform_image', {
          filePath: targetPath,
          operation: ops[i],
          saveMode: mode,
          id: targetId,
        });
        if (result) {
          if (mode === 'copy') firstCopy = result;
          else overwriteUpdated = result;
          targetPath = result.file_path;
          targetId = result.id;
        }
      }
      if (saveMode === 'copy' && firstCopy) {
        onNewItem(firstCopy, copyDest);
        onExit(item);
      } else {
        if (overwriteUpdated) onItemUpdated?.(overwriteUpdated);
        await commitWrite(targetPath, targetId);
      }
    } catch (e) {
      console.error('Transform failed:', e);
    } finally {
      setTransforming(false);
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const hasPending = pendingOps.length > 0;
  const imgStyle = (() => {
    const parts = [];
    // Pan (translate) goes outermost so it always moves the image by a fixed
    // number of screen pixels, independent of the image content itself.
    // Rotate/flip/crop are no longer a separate CSS layer — they're baked
    // into `previewUrl` (see renderOpsToCanvas), so only pan/zoom live here.
    if (pan.x !== 0 || pan.y !== 0) parts.push(`translate(${pan.x}px, ${pan.y}px)`);
    if (scale !== 1) parts.push(`scale(${scale})`);
    return parts.length ? { transform: parts.join(' ') } : {};
  })();

  // Crop overlay position in canvas-relative CSS pixels (computed at render time from DOM rects)
  const cropOverlayStyle = (() => {
    if (!cropMode || !cropRect || cropRect.w < 1 || cropRect.h < 1) return null;
    const img = imgRef.current,
      canvas = canvasRef.current;
    if (!img || !canvas) return null;
    const ir = img.getBoundingClientRect(),
      cr = canvas.getBoundingClientRect();
    if (!ir.width) return null;
    const effW = img.naturalWidth;
    const ts = ir.width / effW;
    return {
      left: ir.left - cr.left + cropRect.x * ts,
      top: ir.top - cr.top + cropRect.y * ts,
      width: cropRect.w * ts,
      height: cropRect.h * ts,
    };
  })();

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="image-editor-page">
      {/* ── Header ── */}
      <div className="image-editor-header" data-tauri-drag-region>
        <button className="image-editor-back" onClick={handleBack}>
          <ArrowLeft size={14} />
          <span>{item.display_name}</span>
        </button>
        <div className="image-editor-header-actions">
          {cropMode ? (
            <>
              <button className="btn btn-secondary btn-sm" onClick={exitCropMode}>
                {t('imageEditor.cancel')}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={applyCrop}
                disabled={!cropRect || cropRect.w < 1 || cropRect.h < 1}
              >
                <Check size={13} /> {t('imageEditor.crop')}
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setPendingOps([]);
                  setUndoneOps([]);
                }}
                disabled={!hasPending || transforming}
                title={t('imageEditor.discardTooltip')}
              >
                {t('imageEditor.discard')}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowSaveCopyModal(true)}
                disabled={!hasPending || transforming}
              >
                <CopyPlus size={13} /> {t('imageEditor.saveCopy')}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowSaveConfirm(true)}
                disabled={!hasPending || transforming}
              >
                <Save size={13} /> {transforming ? t('imageEditor.saving') : t('imageEditor.save')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="image-editor-body">
        <aside className="image-editor-tools">
          <div className="image-editor-tool-group">
            <button
              className="image-editor-tool-btn"
              onClick={handleUndo}
              disabled={!pendingOps.length || transforming}
              title={t('imageEditor.undo')}
            >
              <Undo2 size={18} />
            </button>
            <button
              className="image-editor-tool-btn"
              onClick={handleRedo}
              disabled={!undoneOps.length || transforming}
              title={t('imageEditor.redo')}
            >
              <Redo2 size={18} />
            </button>
          </div>
          <div className="image-editor-tool-sep" />
          <div className="image-editor-tool-group">
            <button
              className="image-editor-tool-btn"
              onClick={() => queueTransform('rotate270')}
              disabled={transforming || cropMode}
              title={t('imageEditor.rotateLeft')}
            >
              <RotateCcw size={18} />
            </button>
            <button
              className="image-editor-tool-btn"
              onClick={() => queueTransform('rotate90')}
              disabled={transforming || cropMode}
              title={t('imageEditor.rotateRight')}
            >
              <RotateCw size={18} />
            </button>
            <button
              className="image-editor-tool-btn"
              onClick={() => queueTransform('flip_h')}
              disabled={transforming || cropMode}
              title={t('imageEditor.flipHorizontal')}
            >
              <FlipHorizontal size={18} />
            </button>
            <button
              className="image-editor-tool-btn"
              onClick={() => queueTransform('flip_v')}
              disabled={transforming || cropMode}
              title={t('imageEditor.flipVertical')}
            >
              <FlipVertical size={18} />
            </button>
          </div>
          <div className="image-editor-tool-sep" />
          <div className="image-editor-tool-group">
            <button
              className="image-editor-tool-btn"
              onClick={openResize}
              disabled={transforming || cropMode}
              title={t('imageEditor.resize')}
            >
              <Scaling size={18} />
            </button>
            <button
              className={`image-editor-tool-btn${cropMode ? ' ie-tool-active' : ''}`}
              onClick={() => (cropMode ? exitCropMode() : setCropMode(true))}
              disabled={transforming}
              title={t('imageEditor.crop')}
            >
              <Crop size={18} />
            </button>
          </div>
          <div className="image-editor-tool-spacer" />
          <div className="image-editor-tool-group image-editor-zoom-group">
            <button
              className="image-editor-tool-btn"
              onClick={() => setScale((s) => Math.min(s + 0.25, 5))}
              title={t('imageEditor.zoomIn')}
            >
              <ZoomIn size={16} />
            </button>
            <span
              className="image-editor-zoom-label"
              onClick={() => {
                setScale(1);
                setPan({ x: 0, y: 0 });
              }}
              title={t('imageEditor.resetZoom')}
            >
              {Math.round(scale * 100)}%
            </span>
            <button
              className="image-editor-tool-btn"
              onClick={() => setScale((s) => Math.max(s - 0.25, 0.25))}
              title={t('imageEditor.zoomOut')}
            >
              <ZoomOut size={16} />
            </button>
          </div>
        </aside>

        {/* Canvas + rulers */}
        <div
          ref={canvasRef}
          className={`image-editor-canvas${cropMode ? ' ie-crop-mode' : ''}${!cropMode && scale > 1 ? ' ie-pannable' : ''}`}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={handleCanvasMouseLeave}
          onWheel={handleCanvasWheel}
        >
          {imgSrc && (
            <img
              ref={imgRef}
              src={previewUrl || imgSrc}
              alt={item.display_name}
              className="image-editor-img"
              style={imgStyle}
              draggable={false}
              onLoad={(e) =>
                setImgNaturalSize({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
            />
          )}

          {/* Crop selection + handles */}
          {cropOverlayStyle && (
            <div
              className="ie-crop-selection"
              style={cropOverlayStyle}
              onMouseDown={handleCropMoveMouseDown}
            >
              {/* Corner handles */}
              <div
                className="ie-crop-handle ie-crop-nw"
                onMouseDown={(e) => handleCropHandleMouseDown(e, 'nw')}
              />
              <div
                className="ie-crop-handle ie-crop-ne"
                onMouseDown={(e) => handleCropHandleMouseDown(e, 'ne')}
              />
              <div
                className="ie-crop-handle ie-crop-sw"
                onMouseDown={(e) => handleCropHandleMouseDown(e, 'sw')}
              />
              <div
                className="ie-crop-handle ie-crop-se"
                onMouseDown={(e) => handleCropHandleMouseDown(e, 'se')}
              />
              {/* Edge handles */}
              <div
                className="ie-crop-handle ie-crop-n"
                onMouseDown={(e) => handleCropHandleMouseDown(e, 'n')}
              />
              <div
                className="ie-crop-handle ie-crop-s"
                onMouseDown={(e) => handleCropHandleMouseDown(e, 's')}
              />
              <div
                className="ie-crop-handle ie-crop-w"
                onMouseDown={(e) => handleCropHandleMouseDown(e, 'w')}
              />
              <div
                className="ie-crop-handle ie-crop-e"
                onMouseDown={(e) => handleCropHandleMouseDown(e, 'e')}
              />
            </div>
          )}
        </div>
      </div>

      {/* Status bar — anchored bottom-left, pushed up by audio player */}
      <div className="ie-statusbar">
        <span className="ie-coord">{mouseImgPos ? `${mouseImgPos.x}, ${mouseImgPos.y}` : ''}</span>
        <span className="ie-statusbar-spacer" />
        {cropMode && cropRect && cropRect.w >= 1 && cropRect.h >= 1 && (
          <span className="ie-statusbar-item">
            {Math.round(cropRect.w)} × {Math.round(cropRect.h)} px
          </span>
        )}
        {imgNaturalSize && (
          <span className="ie-statusbar-item">
            {imgNaturalSize.w} × {imgNaturalSize.h}
          </span>
        )}
      </div>

      {/* ── Modals ── */}
      {showSaveConfirm && (
        <div className="modal-backdrop" onClick={() => setShowSaveConfirm(false)}>
          <div className="modal" style={{ maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('imageEditor.saveChangesTitle')}</span>
            </div>
            <div className="modal-body" style={{ padding: '14px 20px' }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                {t('imageEditor.saveChangesMsg')}
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowSaveConfirm(false)}>
                {t('imageEditor.cancel')}
              </button>
              <button className="btn btn-primary" onClick={() => applyAllTransforms('overwrite')}>
                {t('imageEditor.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDiscardConfirm && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowDiscardConfirm(false);
            afterNavRef.current = null;
          }}
        >
          <div className="modal" style={{ maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('imageEditor.unsavedChangesTitle')}</span>
            </div>
            <div className="modal-body" style={{ padding: '14px 20px' }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                {t('imageEditor.unsavedChangesMsg')}
              </p>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  afterNavRef.current = null;
                }}
              >
                {t('imageEditor.stay')}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  const cb = afterNavRef.current;
                  afterNavRef.current = null;
                  onExit(item);
                  cb?.();
                }}
              >
                {t('imageEditor.discard')}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  const cb = afterNavRef.current;
                  afterNavRef.current = null;
                  applyAllTransforms('overwrite').then(() => cb?.());
                }}
              >
                {t('imageEditor.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSaveCopyModal && (
        <SaveCopyModal
          collections={collections}
          folders={folders}
          allItems={allItems}
          onConfirm={(dest) => applyAllTransforms('copy', dest)}
          onClose={() => setShowSaveCopyModal(false)}
        />
      )}

      {showResize && (
        <div className="modal-backdrop" onClick={() => setShowResize(false)}>
          <div className="modal" style={{ maxWidth: 300 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('imageEditor.resizeImageTitle')}</span>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px' }}>
              <div className="resize-fields">
                <div className="field" style={{ margin: 0 }}>
                  <label>{t('imageEditor.width')}</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={resizeW}
                    onChange={(e) => handleResizeW(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyResize();
                      if (e.key === 'Escape') setShowResize(false);
                    }}
                  />
                </div>
                <button
                  className={`resize-lock-btn${ratioLocked ? ' locked' : ''}`}
                  onClick={() => setRatioLocked((v) => !v)}
                  title={ratioLocked ? t('imageEditor.unlockRatio') : t('imageEditor.lockRatio')}
                  type="button"
                >
                  {ratioLocked ? <Lock size={14} /> : <LockOpen size={14} />}
                </button>
                <div className="field" style={{ margin: 0 }}>
                  <label>{t('imageEditor.height')}</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={resizeH}
                    onChange={(e) => handleResizeH(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyResize();
                      if (e.key === 'Escape') setShowResize(false);
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowResize(false)}>
                {t('imageEditor.cancel')}
              </button>
              <button
                className="btn btn-primary"
                onClick={applyResize}
                disabled={!resizeW || !resizeH}
              >
                {t('imageEditor.apply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default ImageEditorPage;
