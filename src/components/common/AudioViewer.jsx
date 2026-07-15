import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Music,
  Repeat,
  Repeat1,
} from 'lucide-react';
import { formatClock as formatTime } from '../../utils/format';
import './AudioViewer.css';

// Full-page audio player for FileViewer — same feature set as the bottom
// "now playing" AudioPlayer bar (seek, volume, skip prev/next, loop,
// auto-advance) minus shuffle, restyled as a compact single-row control bar
// to match VideoPlayer's on-page look. Unlike the bottom bar, this doesn't
// auto-play — opening a file in the viewer is a "look at this", not a
// "start playback" action. Uses a plain progress bar rather than a rendered
// waveform, which needs neither a fetch+decode nor an AudioContext per item.
export default function AudioViewer({ item, queue = [], onNavigate }) {
  const { t } = useTranslation();
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [loop, setLoop] = useState('none'); // 'none' | 'all' | 'one'
  const seekRef = useRef(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrent(0);
    setDuration(0);
    audio.load();
  }, [item?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
  }, [volume, muted]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  const skipPrev = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const idx = queue.findIndex((q) => q.id === item.id);
    if (idx > 0) onNavigate(queue[idx - 1]);
  }, [queue, item, onNavigate]);

  const skipNext = useCallback(() => {
    const idx = queue.findIndex((q) => q.id === item.id);
    if (idx !== -1 && idx < queue.length - 1) onNavigate(queue[idx + 1]);
  }, [queue, item, onNavigate]);

  const handleTimeUpdate = useCallback(() => {
    if (!seeking) setCurrent(audioRef.current?.currentTime ?? 0);
  }, [seeking]);

  const handleLoadedMetadata = useCallback(() => {
    setDuration(audioRef.current?.duration ?? 0);
  }, []);

  const handleEnded = useCallback(() => {
    setCurrent(audioRef.current?.duration ?? 0);
    setPlaying(false);
    if (loop === 'one') {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().then(() => setPlaying(true));
      }
      return;
    }
    const idx = queue.findIndex((q) => q.id === item.id);
    if (idx !== -1 && idx < queue.length - 1) {
      onNavigate(queue[idx + 1]);
    } else if (loop === 'all' && queue.length > 0) {
      onNavigate(queue[0]);
    }
  }, [queue, item, onNavigate, loop]);

  function onSeekStart(e) {
    setSeeking(true);
    scrub(e);
  }
  function onSeekMove(e) {
    if (!seeking) return;
    scrub(e);
  }
  function onSeekEnd(e) {
    scrub(e);
    setSeeking(false);
    if (audioRef.current) audioRef.current.currentTime = current;
  }
  function scrub(e) {
    const bar = seekRef.current;
    if (!bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setCurrent(ratio * duration);
  }
  const seekBy = useCallback(
    (delta) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + delta));
    },
    [duration],
  );

  // Owns Space/ArrowLeft/ArrowRight/M while an audio item is open — capture
  // phase + stopImmediatePropagation so FileViewer's own (bubble-phase)
  // handler never double-handles the same keypress, mirroring how
  // VideoPlayer.jsx claims these same keys for video.
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          e.stopImmediatePropagation();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          e.stopImmediatePropagation();
          seekBy(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          e.stopImmediatePropagation();
          seekBy(10);
          break;
        case 'm':
        case 'M':
          e.stopImmediatePropagation();
          setMuted((v) => !v);
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [seekBy]);

  const cycleLoop = () => setLoop((l) => (l === 'none' ? 'all' : l === 'all' ? 'one' : 'none'));

  const queueIdx = queue.findIndex((q) => q.id === item.id);
  const hasPrev = queueIdx > 0;
  const hasNext = queueIdx !== -1 && queueIdx < queue.length - 1;
  const progress = duration > 0 ? current / duration : 0;
  const cover = item.audio_cover || item.thumb_path;

  return (
    <div className="audio-viewer">
      <audio
        ref={audioRef}
        src={convertFileSrc(item.file_path)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        preload="auto"
      />

      <div className="av-art">
        {cover ? (
          <img src={convertFileSrc(cover)} alt={item.display_name} className="av-cover" />
        ) : (
          <Music size={56} strokeWidth={1} color="rgba(255,255,255,0.25)" />
        )}
      </div>
      <p className="av-title" title={item.display_name}>
        {item.display_name}
      </p>
      {item.audio_artist && <p className="av-artist">{item.audio_artist}</p>}

      <div className="av-controls">
        <div className="av-bar">
          <button className="av-btn" onClick={skipPrev} disabled={!hasPrev} title="Previous">
            <SkipBack size={15} />
          </button>
          <button
            className="av-btn av-btn-play"
            onClick={togglePlay}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="av-btn" onClick={skipNext} disabled={!hasNext} title="Next">
            <SkipForward size={15} />
          </button>

          <div className="av-volume">
            <button
              className="av-btn"
              onClick={() => setMuted((m) => !m)}
              title={muted ? 'Unmute (M)' : 'Mute (M)'}
            >
              {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input
              type="range"
              className="av-volume-slider"
              min="0"
              max="1"
              step="0.02"
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                setMuted(false);
              }}
              style={{ '--vol-pct': `${(muted ? 0 : volume) * 100}%` }}
            />
          </div>

          <span className="av-time">
            {formatTime(current)} <span className="av-time-sep">/</span> {formatTime(duration)}
          </span>

          <div
            ref={seekRef}
            className="av-seek"
            onMouseDown={onSeekStart}
            onMouseMove={onSeekMove}
            onMouseUp={onSeekEnd}
            onMouseLeave={(e) => {
              if (seeking) onSeekEnd(e);
            }}
          >
            <div className="av-seek-fill" style={{ width: `${progress * 100}%` }} />
            <div className="av-seek-thumb" style={{ left: `${progress * 100}%` }} />
          </div>

          <button
            className={`av-btn ${loop !== 'none' ? 'av-btn-active' : ''}`}
            onClick={cycleLoop}
            title={
              loop === 'none'
                ? t('audio.loopOff')
                : loop === 'all'
                  ? t('audio.loopAll')
                  : t('audio.loopTrack')
            }
          >
            {loop === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}
