import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import {
  Music,
  Play,
  ChevronDown,
  ChevronRight,
  Clock,
  Plus,
  ListMusic,
  X,
  Shuffle,
  Repeat,
  Repeat1,
  GripVertical,
} from 'lucide-react';
import { formatDuration } from '../../utils/format';
import { coverSrc } from '../../utils/cover';
import './MusicView.css';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function TrackRow({
  track,
  index,
  isPlaying,
  onPlay,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragOver,
}) {
  return (
    <div
      className={`music-track-row ${isPlaying ? 'playing' : ''} ${isDragOver ? 'drag-over' : ''}`}
      onClick={() => onPlay(track)}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {draggable && (
        <span
          className="music-track-drag-handle"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
        >
          <GripVertical size={13} />
        </span>
      )}
      <span className="music-track-num">
        {isPlaying ? (
          <span className="music-playing-bars">
            <span />
            <span />
            <span />
          </span>
        ) : (
          index + 1
        )}
      </span>
      <span className="music-track-name">{track.audio_title || track.display_name}</span>
      <span className="music-track-artist">{track.audio_artist || ''}</span>
      <span className="music-track-dur">{formatDuration(track.audio_duration)}</span>
      <button
        className="music-track-play icon-btn"
        onClick={(e) => {
          e.stopPropagation();
          onPlay(track);
        }}
        title="Play"
      >
        <Play size={12} />
      </button>
    </div>
  );
}

const ALBUM_GRADIENTS = [
  'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)',
  'linear-gradient(135deg, #3b1f5f 0%, #7c3aed 100%)',
  'linear-gradient(135deg, #5f1f3b 0%, #db2777 100%)',
  'linear-gradient(135deg, #5f3a1f 0%, #d97706 100%)',
  'linear-gradient(135deg, #1f5f3b 0%, #059669 100%)',
  'linear-gradient(135deg, #1f4a5f 0%, #0891b2 100%)',
];

function albumGradient(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return ALBUM_GRADIENTS[Math.abs(hash) % ALBUM_GRADIENTS.length];
}

function AlbumCard({ album, currentTrack, onPlay, onPlayAll }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const coverTrack = album.tracks.find((tr) => tr.audio_cover || tr.thumb_path);

  return (
    <div className={`music-album-card ${expanded ? 'expanded' : ''}`}>
      <div className="music-album-header" onClick={() => setExpanded((e) => !e)}>
        <div className="music-album-art" style={{ background: albumGradient(album.album) }}>
          {coverTrack ? (
            <img
              src={coverSrc(coverTrack)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
            />
          ) : (
            <span style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>
              {album.album.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
        <div className="music-album-info">
          <span className="music-album-title">{album.album}</span>
          {album.artist && <span className="music-album-artist">{album.artist}</span>}
          <span className="music-album-meta">
            {t('music.track', { count: album.track_count })}
            {album.year ? ` · ${album.year}` : ''}
            {album.total_secs ? ` · ${formatDuration(album.total_secs)}` : ''}
          </span>
        </div>
        <button
          className="btn btn-primary music-album-play-btn"
          onClick={(e) => {
            e.stopPropagation();
            onPlayAll(album.tracks, album.album);
          }}
          title={t('music.playAlbum')}
        >
          <Play size={12} /> {t('music.play')}
        </button>
        <span className="music-album-chevron">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </div>

      {expanded && (
        <div className="music-track-list">
          <div className="music-track-list-header">
            <span>#</span>
            <span>Title</span>
            <span>Artist</span>
            <span>
              <Clock size={11} />
            </span>
            <span />
          </div>
          {album.tracks.map((t) => (
            <TrackRow key={t.id} track={t} isPlaying={currentTrack?.id === t.id} onPlay={onPlay} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlaylistCard({ group, allItems, currentTrack, onPlay, onPlayAll, onUpdateItem }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [loop, setLoop] = useState('none');
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [orderedTracks, setOrderedTracks] = useState([]);

  // Videos in a playlist are treated as audio tracks (the player plays their
  // audio), so they count and play alongside audio files.
  const rawTracks = allItems.filter(
    (i) =>
      i.collection_ids?.includes(group.id) &&
      (i.media_type === 'audio' || i.media_type === 'video'),
  );

  // Sync ordered tracks when allItems changes, preserving current drag order
  useEffect(() => {
    setOrderedTracks([...rawTracks].sort((a, b) => a.sort_order - b.sort_order));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems, group.id]);

  const coverTrack = orderedTracks.find((tr) => tr.audio_cover || tr.thumb_path);

  function handlePlay() {
    if (orderedTracks.length === 0) return;
    const queue = shuffleOn ? shuffle(orderedTracks) : orderedTracks;
    onPlayAll(queue, group.name);
  }

  function cycleLoop() {
    setLoop((l) => (l === 'none' ? 'all' : l === 'all' ? 'one' : 'none'));
  }

  // Drag handlers
  function handleDragStart(idx) {
    setDragIdx(idx);
  }

  function handleDragOver(e, idx) {
    e.preventDefault();
    setOverIdx(idx);
  }

  async function handleDrop(e, idx) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }
    const next = [...orderedTracks];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    setOrderedTracks(next);
    setDragIdx(null);
    setOverIdx(null);

    // Persist new sort_order for every item
    await Promise.all(
      next.map((tr, i) =>
        invoke('update_item_order', { id: tr.id, sortOrder: i })
          .then(() => onUpdateItem?.({ ...tr, sort_order: i }))
          .catch(console.error),
      ),
    );
  }

  function handleDragEnd() {
    setDragIdx(null);
    setOverIdx(null);
  }

  const loopTitle = loop === 'none' ? 'Loop off' : loop === 'all' ? 'Loop playlist' : 'Loop track';

  return (
    <div className={`music-album-card ${expanded ? 'expanded' : ''}`}>
      <div className="music-album-header" onClick={() => setExpanded((e) => !e)}>
        <div
          className="music-album-art"
          style={{ background: coverTrack ? 'transparent' : group.color || 'var(--accent)' }}
        >
          {coverTrack ? (
            <img
              src={coverSrc(coverTrack)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
            />
          ) : group.emoji ? (
            <span style={{ fontSize: 22 }}>{group.emoji}</span>
          ) : (
            <ListMusic size={22} color="rgba(255,255,255,0.7)" />
          )}
        </div>
        <div className="music-album-info">
          <span className="music-album-title">{group.name}</span>
          <span className="music-album-meta">
            {t('music.track', { count: orderedTracks.length })}
          </span>
        </div>

        {/* Playback controls row */}
        {orderedTracks.length > 0 && (
          <div className="playlist-controls" onClick={(e) => e.stopPropagation()}>
            <button
              className={`playlist-ctrl-btn ${shuffleOn ? 'active' : ''}`}
              title={shuffleOn ? 'Shuffle on' : 'Shuffle off'}
              onClick={() => setShuffleOn((v) => !v)}
            >
              <Shuffle size={12} />
            </button>
            <button
              className={`playlist-ctrl-btn ${loop !== 'none' ? 'active' : ''}`}
              title={loopTitle}
              onClick={cycleLoop}
            >
              {loop === 'one' ? <Repeat1 size={12} /> : <Repeat size={12} />}
            </button>
            <button
              className={`playlist-ctrl-btn ${autoplay ? 'active' : ''}`}
              title={autoplay ? 'Auto-play on' : 'Auto-play off'}
              onClick={() => setAutoplay((v) => !v)}
            >
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '-0.02em' }}>AUTO</span>
            </button>
            <button
              className="btn btn-primary music-album-play-btn"
              onClick={handlePlay}
              title={t('music.playPlaylist')}
            >
              <Play size={12} /> {t('music.play')}
            </button>
          </div>
        )}

        <span className="music-album-chevron" onClick={() => setExpanded((e) => !e)}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </div>

      {expanded && (
        <div className="music-track-list">
          {orderedTracks.length === 0 ? (
            <p style={{ padding: '12px 16px', color: 'var(--text-dim)', fontSize: 12 }}>
              {t('music.noTracksYet')}
            </p>
          ) : (
            <>
              <div className="music-track-list-header music-track-list-header--reorderable">
                <span />
                <span>#</span>
                <span>Title</span>
                <span>Artist</span>
                <span>
                  <Clock size={11} />
                </span>
                <span />
              </div>
              {orderedTracks.map((tr, i) => (
                <TrackRow
                  key={tr.id}
                  track={tr}
                  index={i}
                  isPlaying={currentTrack?.id === tr.id}
                  onPlay={onPlay}
                  draggable
                  isDragOver={overIdx === i}
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={(e) => handleDrop(e, i)}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const PRESET_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#06b6d4',
];
const QUICK_EMOJIS = ['🎵', '🎶', '🎸', '🎹', '🎺', '🎻', '🥁', '🎷', '🎤', '🎧', '🎼', '🌟'];

export default function MusicView({
  onPlayTrack,
  onPlayAll,
  currentTrack,
  collections,
  allItems,
  onCreateCollection,
  onUpdateItem,
}) {
  const { t } = useTranslation();
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [newEmoji, setNewEmoji] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);

  useEffect(() => {
    invoke('get_music_albums')
      .then(setAlbums)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [allItems]);

  const playlists = (collections ?? []).filter((g) => g.kind === 'playlist');

  const filteredAlbums = search.trim()
    ? albums.filter(
        (a) =>
          a.album.toLowerCase().includes(search.toLowerCase()) ||
          (a.artist || '').toLowerCase().includes(search.toLowerCase()),
      )
    : albums;

  const filteredPlaylists = search.trim()
    ? playlists.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : playlists;

  function handleCreatePlaylist(e) {
    e.preventDefault();
    const n = newName.trim();
    if (!n) return;
    onCreateCollection?.(n, newColor, newEmoji || null, 'playlist');
    setNewName('');
    setNewColor(PRESET_COLORS[0]);
    setNewEmoji('');
    setCreating(false);
  }

  if (loading) {
    return (
      <div className="music-view music-empty">
        <Music size={40} strokeWidth={1} />
        <p>{t('music.loading')}</p>
      </div>
    );
  }

  return (
    <div className="music-view">
      <div className="music-view-header">
        <h2 className="music-view-title">{t('music.title')}</h2>
        <input
          className="input music-search"
          placeholder={t('music.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="btn btn-primary"
          style={{
            fontSize: 12,
            padding: '5px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flexShrink: 0,
          }}
          onClick={() => setCreating((v) => !v)}
          title={t('music.newPlaylist')}
        >
          <Plus size={13} /> {t('music.newPlaylist')}
        </button>
      </div>

      {creating && (
        <form className="music-create-form" onSubmit={handleCreatePlaylist}>
          <input
            className="input"
            placeholder={t('music.playlistName')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <div className="music-form-row">
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Emoji</span>
            <button type="button" className="emoji-trigger" onClick={() => setShowEmoji((v) => !v)}>
              {newEmoji || <span style={{ opacity: 0.35, fontSize: 12 }}>None</span>}
            </button>
            {newEmoji && (
              <button
                type="button"
                onClick={() => setNewEmoji('')}
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-dim)',
                }}
              >
                <X size={11} />
              </button>
            )}
          </div>
          {showEmoji && (
            <div className="emoji-grid" style={{ margin: '0 0 8px' }}>
              {QUICK_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  className={`emoji-cell ${newEmoji === em ? 'selected' : ''}`}
                  onClick={() => {
                    setNewEmoji(em);
                    setShowEmoji(false);
                  }}
                >
                  {em}
                </button>
              ))}
            </div>
          )}
          <div className="music-form-row">
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Color</span>
            <div className="color-palette">
              {PRESET_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`color-dot ${newColor === c ? 'selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setNewColor(c)}
                />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={() => setCreating(false)}
            >
              {t('music.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              {t('music.create')}
            </button>
          </div>
        </form>
      )}

      {filteredPlaylists.length > 0 && (
        <>
          <div className="music-section-label">{t('music.playlists')}</div>
          <div className="music-album-list">
            {filteredPlaylists.map((g) => (
              <PlaylistCard
                key={g.id}
                group={g}
                allItems={allItems ?? []}
                currentTrack={currentTrack}
                onPlay={onPlayTrack}
                onPlayAll={onPlayAll ?? ((tracks) => tracks.length > 0 && onPlayTrack(tracks[0]))}
                onUpdateItem={onUpdateItem}
              />
            ))}
          </div>
        </>
      )}

      {filteredAlbums.length > 0 && (
        <>
          {filteredPlaylists.length > 0 && (
            <div className="music-section-label">{t('music.albums')}</div>
          )}
          <div className="music-album-list">
            {filteredAlbums.map((album) => (
              <AlbumCard
                key={album.album}
                album={album}
                currentTrack={currentTrack}
                onPlay={onPlayTrack}
                onPlayAll={onPlayAll ?? ((tracks) => tracks.length > 0 && onPlayTrack(tracks[0]))}
              />
            ))}
          </div>
        </>
      )}

      {filteredAlbums.length === 0 && filteredPlaylists.length === 0 && (
        <div className="music-empty">
          <Music size={48} strokeWidth={1} color="var(--text-dim)" />
          <p>
            {albums.length === 0 && playlists.length === 0
              ? t('music.noAudio')
              : t('music.noResults')}
          </p>
          {albums.length === 0 && playlists.length === 0 && (
            <p className="music-empty-hint">{t('music.noAudioHint')}</p>
          )}
        </div>
      )}
    </div>
  );
}
