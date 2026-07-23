import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { thumbSrcOf } from '../../utils/path';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
  Music,
  Video,
  Shuffle,
  Repeat,
  Repeat1,
} from 'lucide-react';
import { formatClock as formatTime } from '../../utils/format';
import { buildWaveform, WaveformCanvas } from './Waveform';
import './AudioPlayer.css';

function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function AudioPlayer({
  item,
  playToken = 0,
  queue: rawQueue,
  playlistMode = false,
  playlistName = null,
  onClose,
  onNavigate,
  keyboardDisabled = false,
  loop = 'none',
  onLoopChange,
}) {
  const { t } = useTranslation();
  const audioRef = useRef(null);
  const seekRef = useRef(null);
  const playerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [waveform, setWaveform] = useState(null);
  const [waveformLoading, setWaveformLoading] = useState(false);

  // Playlist controls — only active in playlist mode
  const [autoplay, setAutoplay] = useState(true);
  const [shuffleOn, setShuffleOn] = useState(false);
  // loop is controlled from outside (App.jsx) so banner and player stay in sync
  const cycleLoop = useCallback(() => {
    onLoopChange?.((l) => (l === 'none' ? 'all' : l === 'all' ? 'one' : 'none'));
  }, [onLoopChange]);

  // Build effective queue (apply shuffle)
  const queue = useMemo(() => {
    if (!playlistMode || !shuffleOn) return rawQueue;
    // Keep current item first, shuffle the rest
    const rest = rawQueue.filter((i) => i.id !== item.id);
    return [item, ...shuffleArr(rest)];
  }, [rawQueue, shuffleOn, playlistMode, item?.id]);

  useEffect(() => {
    setWaveform(null);
    if (item.media_type !== 'audio') return;
    setWaveformLoading(true);
    const src = convertFileSrc(item.file_path);
    let cancelled = false;
    buildWaveform(src).then((w) => {
      if (!cancelled) {
        setWaveform(w);
        setWaveformLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.media_type, item.file_path]);

  useEffect(() => {
    const el = playerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setIsNarrow(entry.contentRect.width < 560));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Depends on `playToken`, not just `item?.id` — clicking play on the track
  // that's already loaded doesn't change its id, but should still restart it
  // from the beginning rather than silently doing nothing.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrent(0);
    setDuration(0);
    audio.load();
    audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }, [item?.id, playToken]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const handler = (e) => {
      if (keyboardDisabled) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const audio = audioRef.current;
      if (!audio) return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime - 10);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        audio.currentTime = Math.min(duration, audio.currentTime + 10);
      }
      if (e.key === 'm' || e.key === 'M') setMuted((v) => !v);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [duration, keyboardDisabled]);

  const handleTimeUpdate = useCallback(() => {
    if (!seeking) setCurrent(audioRef.current?.currentTime ?? 0);
  }, [seeking]);

  const handleLoadedMetadata = useCallback(() => {
    setDuration(audioRef.current?.duration ?? 0);
  }, []);

  const handleEnded = useCallback(() => {
    setCurrent(audioRef.current?.duration ?? 0); // fill waveform to end
    setPlaying(false);
    if (!playlistMode || !autoplay) return;
    if (loop === 'one') {
      // Repeat current track
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
  }, [queue, item, onNavigate, playlistMode, autoplay, loop]);

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

  function skipPrev() {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const idx = queue.findIndex((q) => q.id === item.id);
    if (idx > 0) onNavigate(queue[idx - 1]);
  }

  function skipNext() {
    const idx = queue.findIndex((q) => q.id === item.id);
    if (idx !== -1 && idx < queue.length - 1) onNavigate(queue[idx + 1]);
  }

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
  function seekToRatio(ratio) {
    const t = ratio * duration;
    setCurrent(t);
    if (audioRef.current) audioRef.current.currentTime = t;
  }

  const queueIdx = queue.findIndex((q) => q.id === item.id);
  const hasPrev = playlistMode && queueIdx > 0;
  const hasNext = playlistMode && queueIdx !== -1 && queueIdx < queue.length - 1;
  const progress = duration > 0 ? current / duration : 0;
  const TypeIcon = item.media_type === 'video' ? Video : Music;

  return (
    <div ref={playerRef} className={`audio-player${isNarrow ? ' ap-narrow' : ''}`}>
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

      {/* Track info */}
      <div className="ap-track">
        <div className="ap-icon">
          {item.audio_cover || item.thumb_path ? (
            <img
              src={thumbSrcOf(item.audio_cover || item.thumb_path)}
              alt=""
              className="ap-cover-art"
            />
          ) : (
            <TypeIcon size={16} />
          )}
        </div>
        <div className="ap-track-text">
          {playlistMode && playlistName && <span className="ap-playlist-name">{playlistName}</span>}
          <span className="ap-title" title={item.display_name}>
            {item.display_name}
          </span>
          {item.audio_artist && <span className="ap-artist">{item.audio_artist}</span>}
        </div>
      </div>

      {/* Playlist mode shuffle */}
      {playlistMode && (
        <div className="ap-playlist-controls">
          <button
            className={`ap-btn ap-ctrl-sm ${shuffleOn ? 'ap-ctrl-active' : ''}`}
            onClick={() => setShuffleOn((v) => !v)}
            title={shuffleOn ? t('audio.shuffleOn') : t('audio.shuffleOff')}
          >
            <Shuffle size={13} />
          </button>
        </div>
      )}

      {/* Loop — always visible */}
      <button
        className={`ap-btn ap-ctrl-sm ${loop !== 'none' ? 'ap-ctrl-active' : ''}`}
        onClick={cycleLoop}
        title={
          loop === 'none'
            ? t('audio.loopOff')
            : loop === 'all'
              ? t('audio.loopAll')
              : t('audio.loopTrack')
        }
      >
        {loop === 'one' ? <Repeat1 size={13} /> : <Repeat size={13} />}
      </button>

      {/* Auto-play — only in playlist mode, right of loop */}
      {playlistMode && (
        <button
          className={`ap-btn ap-ctrl-sm ${autoplay ? 'ap-ctrl-active' : ''}`}
          onClick={() => setAutoplay((v) => !v)}
          title={autoplay ? 'Auto-play on' : 'Auto-play off'}
        >
          <span className="ap-auto-label">AUTO</span>
        </button>
      )}

      {/* Transport */}
      <div className="ap-controls">
        <button className="ap-btn ap-skip" onClick={skipPrev} disabled={!hasPrev} title="Previous">
          <SkipBack size={15} />
        </button>
        <button
          className="ap-btn ap-play"
          onClick={togglePlay}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button className="ap-btn ap-skip" onClick={skipNext} disabled={!hasNext} title="Next">
          <SkipForward size={15} />
        </button>
      </div>

      {/* Seek / Waveform */}
      <div className="ap-seek-group">
        <span className="ap-time">{formatTime(current)}</span>
        {waveformLoading ? (
          <div className="ap-waveform" />
        ) : waveform ? (
          <WaveformCanvas
            waveform={waveform}
            progress={progress}
            onScrub={seekToRatio}
            onScrubStart={() => {
              if (audioRef.current && !audioRef.current.paused) {
                audioRef.current.pause();
                audioRef.current._scrubWasPlaying = true;
              }
            }}
            onScrubEnd={() => {
              if (audioRef.current?._scrubWasPlaying) {
                audioRef.current._scrubWasPlaying = false;
                audioRef.current.play().catch(() => {});
              }
            }}
          />
        ) : (
          <div
            ref={seekRef}
            className="ap-seek-bar"
            onMouseDown={onSeekStart}
            onMouseMove={onSeekMove}
            onMouseUp={onSeekEnd}
            onMouseLeave={(e) => {
              if (seeking) onSeekEnd(e);
            }}
          >
            <div className="ap-seek-fill" style={{ width: `${progress * 100}%` }} />
            <div className="ap-seek-thumb" style={{ left: `${progress * 100}%` }} />
          </div>
        )}
        <span className="ap-time">{formatTime(duration)}</span>
      </div>

      {/* Volume */}
      <div className="ap-volume-group">
        <button
          className="ap-btn"
          onClick={() => setMuted((m) => !m)}
          title={muted ? 'Unmute (M)' : 'Mute (M)'}
        >
          {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <input
          type="range"
          className="ap-volume-slider"
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

      <button className="ap-btn ap-close" onClick={onClose} title="Close player">
        <X size={15} />
      </button>
    </div>
  );
}
