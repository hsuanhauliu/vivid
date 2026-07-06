import { useState, useEffect, useRef, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { X, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import './ScreensaverOverlay.css';

const INTERVAL_DEFAULT = 5; // seconds

export default function ScreensaverOverlay({ items, onClose }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showUi, setShowUi] = useState(true);
  const [fadingIn, setFadingIn] = useState(true);
  const timerRef = useRef(null);
  const uiTimer = useRef(null);
  const interval = INTERVAL_DEFAULT;

  const go = useCallback((next) => {
    setFadingIn(false);
    setTimeout(() => {
      setIdx(next);
      setFadingIn(true);
    }, 400);
  }, []);

  // Auto-advance
  useEffect(() => {
    if (paused) {
      clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setIdx((i) => {
        const next = (i + 1) % items.length;
        setFadingIn(false);
        setTimeout(() => {
          setIdx(next);
          setFadingIn(true);
        }, 400);
        return i; // keeps current until timeout
      });
    }, interval * 1000);
    return () => clearInterval(timerRef.current);
  }, [paused, items.length, interval]);

  // Show UI briefly on interaction
  const revealUi = useCallback(() => {
    setShowUi(true);
    clearTimeout(uiTimer.current);
    uiTimer.current = setTimeout(() => setShowUi(false), 3000);
  }, []);

  useEffect(() => {
    revealUi();
    const handler = (e) => {
      revealUi();
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go((idx + 1) % items.length);
      if (e.key === 'ArrowLeft') go((idx - 1 + items.length) % items.length);
      if (e.key === ' ') setPaused((v) => !v);
    };
    document.addEventListener('keydown', handler);
    document.addEventListener('mousemove', revealUi);
    return () => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('mousemove', revealUi);
      clearTimeout(uiTimer.current);
    };
  }, [idx, items.length, onClose, go, revealUi]);

  const item = items[idx];
  const src = item ? convertFileSrc(item.file_path) : null;

  return (
    <div className="screensaver-root" onClick={revealUi}>
      {/* Image */}
      <img
        key={item?.id}
        src={src}
        alt={item?.display_name}
        className={`screensaver-img ${fadingIn ? 'ss-fade-in' : 'ss-fade-out'}`}
        draggable={false}
      />

      {/* Caption */}
      <div className={`screensaver-caption ${showUi ? 'visible' : ''}`}>
        {item?.display_name || item?.file_name}
      </div>

      {/* Controls */}
      <div className={`screensaver-controls ${showUi ? 'visible' : ''}`}>
        <button
          className="ss-btn"
          onClick={(e) => {
            e.stopPropagation();
            go((idx - 1 + items.length) % items.length);
          }}
          title="Previous"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          className="ss-btn"
          onClick={(e) => {
            e.stopPropagation();
            setPaused((v) => !v);
          }}
          title={paused ? 'Resume' : 'Pause'}
        >
          {paused ? <Play size={20} /> : <Pause size={20} />}
        </button>
        <button
          className="ss-btn"
          onClick={(e) => {
            e.stopPropagation();
            go((idx + 1) % items.length);
          }}
          title="Next"
        >
          <ChevronRight size={20} />
        </button>
        <span className="ss-counter">
          {idx + 1} / {items.length}
        </span>
        <button className="ss-btn ss-close-btn" onClick={onClose} title="Exit screensaver (Esc)">
          <X size={20} />
        </button>
      </div>

      {/* Progress bar */}
      {!paused && (
        <div className="ss-progress-wrap">
          <div
            className="ss-progress-bar"
            key={`${idx}-${paused}`}
            style={{ animationDuration: `${interval}s` }}
          />
        </div>
      )}
    </div>
  );
}
