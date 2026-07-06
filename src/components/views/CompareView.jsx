import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Expand,
  ImagePlus,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Link2,
  Link2Off,
} from 'lucide-react';
import { useDisplayableSrc } from '../../hooks/useDisplayableSrc';
import ImagePickerModal from '../modals/ImagePickerModal';
import './CompareView.css';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const IDENTITY = { scale: 1, pan: { x: 0, y: 0 } };

const clampScale = (s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, +s.toFixed(2)));

/**
 * One side of the comparison. Fully controlled: the parent owns its `transform`
 * ({ scale, pan }) and gets updates through `onChange`, which lets the parent
 * point both panes at the same transform when sync is on. Pan is always clamped
 * to the rendered image bounds so a zoomed image fills the pane — the user can
 * never drag far enough to reveal the background.
 */
function ComparePane({
  item,
  src,
  transform,
  onChange,
  animate,
  onDragStart,
  onDragEnd,
  onPick,
  pickLabel,
  changeLabel,
  t,
}) {
  const paneRef = useRef(null);
  const imgRef = useRef(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 }); // pane size, tracked for resize
  const [panning, setPanning] = useState(false);
  const { scale, pan } = transform;
  const hasItem = !!item;

  // Track the pane's pixel size so the clamp stays correct across window resizes
  // (and so we don't read layout from a ref during render).
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const measure = () => setSize({ w: pane.clientWidth, h: pane.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [hasItem]);

  const clamp = useCallback(
    (x, y, s = scale) => {
      const { w: PW, h: PH } = size;
      if (!PW || !PH || !nat.w || !nat.h) return { x: 0, y: 0 };
      const aspect = nat.w / nat.h;
      let fitW, fitH;
      if (aspect > PW / PH) {
        fitW = PW;
        fitH = PW / aspect;
      } else {
        fitH = PH;
        fitW = PH * aspect;
      }
      const maxX = Math.max(0, (fitW * s - PW) / 2);
      const maxY = Math.max(0, (fitH * s - PH) / 2);
      return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
    },
    [scale, nat, size],
  );

  // The incoming pan is a desired value (it may come from the other pane in sync
  // mode); clamp it to this pane's own bounds for rendering.
  const rendered = clamp(pan.x, pan.y);

  const applyScale = (ns) => {
    const s = clampScale(ns);
    onChange({ scale: s, pan: clamp(pan.x, pan.y, s) });
  };

  function onWheel(e) {
    e.preventDefault();
    applyScale(scale + (e.deltaY > 0 ? -0.2 : 0.2));
  }

  function beginPan(e) {
    if (scale <= 1) return;
    e.preventDefault();
    const start = { sx: e.clientX, sy: e.clientY, px: rendered.x, py: rendered.y };
    setPanning(true);
    onDragStart?.();
    const move = (ev) =>
      onChange({
        scale,
        pan: clamp(start.px + (ev.clientX - start.sx), start.py + (ev.clientY - start.sy)),
      });
    const up = () => {
      setPanning(false);
      onDragEnd?.();
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  }

  if (!item) {
    return (
      <div className="cmp-pane cmp-pane-empty" ref={paneRef}>
        <button className="cmp-pick-btn" onClick={onPick}>
          <ImagePlus size={20} />
          {pickLabel}
        </button>
      </div>
    );
  }

  return (
    <div
      className="cmp-pane"
      ref={paneRef}
      onMouseDown={beginPan}
      onWheel={onWheel}
      style={{ cursor: scale > 1 ? (panning ? 'grabbing' : 'grab') : 'default' }}
    >
      {src ? (
        <img
          ref={imgRef}
          src={src}
          onLoad={() => setNat({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight })}
          draggable={false}
          className="cmp-img"
          alt={item.display_name}
          style={{
            transform: `translate(${rendered.x}px, ${rendered.y}px) scale(${scale})`,
            // No transition while any pan drag is active (either pane, when
            // synced) so the partner image tracks in lockstep instead of easing.
            transition: animate ? 'transform 0.08s ease' : 'none',
          }}
        />
      ) : (
        <div className="cmp-skeleton" />
      )}

      <div className="cmp-pane-tools">
        <div className="cmp-zoom-ctrl">
          <button
            onClick={() => applyScale(scale - 0.25)}
            disabled={scale <= MIN_SCALE}
            title={t('compare.zoomOut')}
          >
            <ZoomOut size={14} />
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            onClick={() => applyScale(scale + 0.25)}
            disabled={scale >= MAX_SCALE}
            title={t('compare.zoomIn')}
          >
            <ZoomIn size={14} />
          </button>
        </div>
        <button className="cmp-change-btn" onClick={onPick} title={changeLabel}>
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="cmp-caption" title={item.display_name}>
        {item.display_name}
      </div>
    </div>
  );
}

/**
 * Full-screen side-by-side image comparison. Opened from the image right-click
 * menu. Each pane zooms/pans independently by default; the Sync toggle locks the
 * right image to the left image's zoom & pan (off by default).
 */
export default function CompareView({ left, right, allItems, onClose }) {
  const { t } = useTranslation();
  const [leftItem, setLeftItem] = useState(left);
  const [rightItem, setRightItem] = useState(right ?? null);
  const [leftT, setLeftT] = useState(IDENTITY);
  const [rightT, setRightT] = useState(IDENTITY);
  const [sync, setSync] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pickerFor, setPickerFor] = useState(null); // 'left' | 'right' | null

  const leftSrc = useDisplayableSrc(leftItem?.file_path);
  const rightSrc = useDisplayableSrc(rightItem?.file_path);

  const reset = useCallback(() => {
    setLeftT(IDENTITY);
    setRightT(IDENTITY);
  }, []);

  // Turning sync off freezes the right image where it currently sits (it was
  // showing the left transform) so it doesn't jump back to its old position.
  function toggleSync() {
    if (sync) setRightT(leftT);
    setSync((v) => !v);
  }

  // Esc closes the picker first, then the whole view.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (pickerFor) setPickerFor(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickerFor, onClose]);

  function handlePick(item) {
    if (pickerFor === 'left') {
      setLeftItem(item);
      setLeftT(IDENTITY);
    } else if (pickerFor === 'right') {
      setRightItem(item);
      setRightT(IDENTITY);
    }
    setPickerFor(null);
  }

  // When synced, the right pane is driven by (and writes back to) the left's
  // transform, so dragging or zooming either side moves both together.
  const rightTransform = sync ? leftT : rightT;
  const rightOnChange = sync ? setLeftT : setRightT;

  return (
    <div className="cmp-page">
      <div className="cmp-topbar" data-tauri-drag-region>
        <button className="cmp-back" onClick={onClose} title={t('compare.close')}>
          <ArrowLeft size={16} />
        </button>
        <span className="cmp-title">{t('compare.title')}</span>
        <div className="cmp-topbar-actions">
          <button
            className={`cmp-sync-btn${sync ? ' active' : ''}`}
            onClick={toggleSync}
            title={t('compare.syncHint')}
          >
            {sync ? <Link2 size={14} /> : <Link2Off size={14} />}
            {t('compare.sync')}
          </button>
          <button className="icon-btn" onClick={reset} title={t('compare.reset')}>
            <Expand size={14} />
          </button>
        </div>
      </div>

      <div className="cmp-panes">
        <ComparePane
          item={leftItem}
          src={leftSrc}
          transform={leftT}
          onChange={setLeftT}
          animate={!dragging}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
          onPick={() => setPickerFor('left')}
          pickLabel={t('compare.choose')}
          changeLabel={t('compare.change')}
          t={t}
        />
        <div className="cmp-divider" />
        <ComparePane
          item={rightItem}
          src={rightSrc}
          transform={rightTransform}
          onChange={rightOnChange}
          animate={!dragging}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
          onPick={() => setPickerFor('right')}
          pickLabel={t('compare.choose')}
          changeLabel={t('compare.change')}
          t={t}
        />
      </div>

      {pickerFor && (
        <ImagePickerModal
          allItems={allItems}
          title={t('compare.pickTitle')}
          currentPath={(pickerFor === 'left' ? leftItem : rightItem)?.file_path}
          onPick={handlePick}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}
