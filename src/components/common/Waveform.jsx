import { useRef, useEffect } from 'react';

// Shared by AudioPlayer (bottom "now playing" bar) and AudioViewer (FileViewer's
// full-page audio player) so both render an identical scrubbable waveform.

export async function buildWaveform(src, bars = 180) {
  try {
    const res = await fetch(src);
    const buf = await res.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await ctx.decodeAudioData(buf);
    ctx.close();
    const data = decoded.getChannelData(0);
    const block = Math.floor(data.length / bars);
    const waveform = new Float32Array(bars);
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let j = 0; j < block; j++) sum += Math.abs(data[i * block + j]);
      waveform[i] = sum / block;
    }
    const max = Math.max(...waveform, 0.001);
    return Array.from(waveform).map((v) => v / max);
  } catch {
    return null;
  }
}

export function WaveformCanvas({
  waveform,
  progress,
  onScrub,
  onScrubStart,
  onScrubEnd,
  className = 'ap-waveform',
}) {
  const canvasRef = useRef(null);
  const drawRef = useRef(null);

  drawRef.current = function draw() {
    const canvas = canvasRef.current;
    if (!canvas || !waveform) return;
    const W = (canvas.width = canvas.offsetWidth * window.devicePixelRatio);
    const H = (canvas.height = canvas.offsetHeight * window.devicePixelRatio);
    if (W === 0 || H === 0) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const bars = waveform.length;
    const barW = W / bars;
    // Math.ceil so the bar currently playing is always shown as filled.
    // Clamped to [0, bars] so progress=0 yields 0 and progress=1 yields bars.
    const fillIdx = Math.min(bars, Math.ceil(progress * bars));
    const style = getComputedStyle(document.documentElement);
    const accentColor = style.getPropertyValue('--accent').trim() || '#6366f1';
    const unplayedColor =
      style.getPropertyValue('--waveform-unplayed').trim() || 'rgba(128,128,128,0.4)';
    for (let i = 0; i < bars; i++) {
      const h = Math.max(2 * window.devicePixelRatio, waveform[i] * H * 0.85);
      const y = (H - h) / 2;
      ctx.fillStyle = i < fillIdx ? accentColor : unplayedColor;
      ctx.beginPath();
      ctx.roundRect(i * barW + barW * 0.1, y, barW * 0.7, h, 2);
      ctx.fill();
    }
  };

  useEffect(() => {
    drawRef.current?.();
  }, [waveform, progress]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => drawRef.current?.());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  function getRatio(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  function handleMouseDown(e) {
    onScrubStart?.();
    onScrub(getRatio(e));
    const onMove = (ev) => onScrub(getRatio(ev));
    const onUp = (ev) => {
      onScrub(getRatio(ev));
      onScrubEnd?.();
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      onMouseDown={handleMouseDown}
      style={{ cursor: 'pointer' }}
    />
  );
}
