import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HardDrive,
  Image,
  Video,
  Music,
  Star,
  Tag,
  Layers,
  Calendar,
  TrendingUp,
  Clock,
  FileText,
  FolderOpen,
  Activity,
  Database,
  BookImage,
  ListMusic,
  Folder,
  Globe,
  Smile,
  ScanText,
  FileSearch,
} from 'lucide-react';
import { formatBytes, formatDate, formatDateShort } from '../../utils/format';
import './StatsPage.css';

// Humanized "1h 30m" duration — distinct from the clock-style format in
// utils/format (used for media playback times), so it stays local.
function formatDuration(totalSeconds) {
  const sec = Math.round(totalSeconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Hero metric card ──────────────────────────────────────────────────────────

function HeroCard({ icon: Icon, iconColor, iconBg, value, label, sub }) {
  return (
    <div className="stats-hero-card">
      <div className="stats-hero-icon" style={{ background: iconBg, color: iconColor }}>
        <Icon size={20} strokeWidth={1.8} />
      </div>
      <div className="stats-hero-body">
        <div className="stats-hero-value">{value}</div>
        <div className="stats-hero-label">{label}</div>
        {sub && <div className="stats-hero-sub">{sub}</div>}
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }) {
  return (
    <div className="stats-section-card">
      <div className="stats-section-header">
        {Icon && <Icon size={14} className="stats-section-header-icon" />}
        <h3 className="stats-section-header-title">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ── Type breakdown with horizontal bars ──────────────────────────────────────

function TypeBreakdown({ images, videos, audios, total }) {
  const { t } = useTranslation();
  const rows = [
    {
      labelKey: 'stats.photos',
      count: images,
      icon: Image,
      color: '#1d7af0',
      bg: 'rgba(29,122,240,0.12)',
    },
    {
      labelKey: 'stats.videos',
      count: videos,
      icon: Video,
      color: '#14b8a6',
      bg: 'rgba(20,184,166,0.12)',
    },
    {
      labelKey: 'stats.audio',
      count: audios,
      icon: Music,
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.12)',
    },
  ];
  return (
    <div className="stats-type-tiles">
      {rows.map(({ labelKey, count, icon: Icon, color, bg }) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={labelKey} className="stats-type-tile">
            <div className="stats-type-tile-icon" style={{ background: bg, color }}>
              <Icon size={20} strokeWidth={1.6} />
            </div>
            <div className="stats-type-tile-num" style={{ color }}>
              {count.toLocaleString()}
            </div>
            <div className="stats-type-tile-label">{t(labelKey)}</div>
            <div className="stats-type-tile-pct">
              {pct}
              {t('stats.pctOfLibrary')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Activity mini chart ───────────────────────────────────────────────────────

function ActivityChart({ items }) {
  const weeks = useMemo(() => {
    // Build last 12 weeks of daily counts
    const now = new Date();
    const dayMap = {};
    items.forEach((i) => {
      const d = i.created_at?.slice(0, 10);
      if (d) dayMap[d] = (dayMap[d] || 0) + 1;
    });
    const result = [];
    for (let w = 11; w >= 0; w--) {
      const weekData = [];
      for (let d = 6; d >= 0; d--) {
        const date = new Date(now);
        date.setDate(date.getDate() - w * 7 - d);
        const key = date.toISOString().slice(0, 10);
        weekData.push({ key, count: dayMap[key] || 0 });
      }
      result.push(weekData);
    }
    return result;
  }, [items]);

  const maxCount = Math.max(...weeks.flat().map((d) => d.count), 1);

  const cellColor = (count) => {
    if (count === 0) return 'var(--surface-active)';
    const intensity = Math.min(count / maxCount, 1);
    return `rgba(29, 122, 240, ${0.2 + intensity * 0.8})`;
  };

  return (
    <div className="stats-activity-chart">
      <div className="stats-activity-label-row">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <span key={d} className="stats-activity-day-label">
            {d.slice(0, 1)}
          </span>
        ))}
      </div>
      <div className="stats-activity-grid">
        {weeks.map((week, wi) => (
          <div key={wi} className="stats-activity-col">
            {week.map(({ key, count }) => (
              <div
                key={key}
                className="stats-activity-cell"
                style={{ background: cellColor(count) }}
                title={`${key}: ${count} item${count !== 1 ? 's' : ''}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="stats-activity-legend">
        <span>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
          <div
            key={i}
            className="stats-activity-cell"
            style={{
              background: v === 0 ? 'var(--surface-active)' : `rgba(29,122,240,${0.2 + v * 0.8})`,
            }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

// ── Top tags list ─────────────────────────────────────────────────────────────

function TopTagsList({ tags, total }) {
  return (
    <div className="stats-top-tags-list">
      {tags.map(([tag, count], i) => {
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <div key={tag} className="stats-top-tag-row">
            <span className="stats-top-tag-rank">#{i + 1}</span>
            <span className="stats-top-tag-name">{tag}</span>
            <div className="stats-top-tag-bar-wrap">
              <div className="stats-top-tag-bar" style={{ width: `${pct}%` }} />
            </div>
            <span className="stats-top-tag-count">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StatsPage({ items, collections, folders = [] }) {
  const { t } = useTranslation();
  const s = useMemo(() => {
    if (!items.length) return null;
    const total = items.length;
    const images = items.filter((i) => i.media_type === 'image');
    const videos = items.filter((i) => i.media_type === 'video');
    const audios = items.filter((i) => i.media_type === 'audio');

    const totalBytes = items.reduce((a, i) => a + (i.file_size || 0), 0);
    const avgBytes = totalBytes / total;
    const largest = [...items].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];

    const starred = items.filter((i) => i.starred).length;
    const tagged = items.filter((i) => i.tags?.length > 0).length;
    const inCollection = items.filter((i) => i.collection_id).length;

    const tagFreq = {};
    items.forEach((i) =>
      (i.tags || []).forEach((t) => {
        tagFreq[t] = (tagFreq[t] || 0) + 1;
      }),
    );
    const topTags = Object.entries(tagFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const oldest = sorted[0];
    const newest = sorted[sorted.length - 1];

    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    const monthAgo = new Date(now);
    monthAgo.setMonth(now.getMonth() - 1);
    const thisWeek = items.filter((i) => new Date(i.created_at) >= weekAgo).length;
    const thisMonth = items.filter((i) => new Date(i.created_at) >= monthAgo).length;

    const daysSince = oldest
      ? Math.max(1, Math.round((now - new Date(oldest.created_at)) / 86400000))
      : 1;
    const avgPerDay = (total / daysSince).toFixed(1);

    const extFreq = {};
    items.forEach((i) => {
      const e = i.file_name?.split('.').pop()?.toLowerCase();
      if (e) extFreq[e] = (extFreq[e] || 0) + 1;
    });
    const topExts = Object.entries(extFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const collectionCounts = collections.map((g) => ({
      ...g,
      count: items.filter((i) => i.collection_id === g.id).length,
    }));
    const largestCollection = [...collectionCounts].sort((a, b) => b.count - a.count)[0];

    const albums = collections.filter((g) => g.kind === 'album');
    const playlists = collections.filter((g) => g.kind === 'playlist');

    const withGps = items.filter((i) => i.gps_lat != null && i.gps_lng != null).length;
    const withFaces = items.filter((i) => i.auto_tags?.some((t) => t.startsWith('face:'))).length;

    // OCR: ocr_text is null until scanned, "" when scanned with no text found.
    const ocrScanned = images.filter((i) => i.ocr_text != null).length;
    const withText = images.filter((i) => i.ocr_text && i.ocr_text.trim()).length;
    const ocrCoverage = images.length ? Math.round((ocrScanned / images.length) * 100) : 0;
    const ocrWords = images.reduce(
      (a, i) => a + (i.ocr_text ? i.ocr_text.trim().split(/\s+/).filter(Boolean).length : 0),
      0,
    );

    // Resolution: summed megapixels across photos that have stored dimensions.
    const megapixels = images.reduce(
      (a, i) => a + (i.width && i.height ? (i.width * i.height) / 1e6 : 0),
      0,
    );

    // Audio: total listening time and unique artists.
    const audioSeconds = audios.reduce((a, i) => a + (i.audio_duration || 0), 0);
    const artists = new Set(audios.map((i) => i.audio_artist).filter(Boolean)).size;

    const dayMap = {};
    items.forEach((i) => {
      const d = i.created_at?.slice(0, 10);
      if (d) dayMap[d] = (dayMap[d] || 0) + 1;
    });
    const busiestDay = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0];

    return {
      total,
      images,
      videos,
      audios,
      totalBytes,
      avgBytes,
      largest,
      starred,
      tagged,
      inCollection,
      topTags,
      tagFreq,
      oldest,
      newest,
      thisWeek,
      thisMonth,
      avgPerDay,
      topExts,
      collectionCounts,
      largestCollection,
      busiestDay,
      daysSince,
      albums,
      playlists,
      withGps,
      withFaces,
      ocrScanned,
      withText,
      ocrCoverage,
      ocrWords,
      megapixels,
      audioSeconds,
      artists,
    };
  }, [items, collections]);

  if (!items.length) {
    return (
      <div className="stats-page stats-empty">
        <FileText size={48} strokeWidth={1} color="var(--text-dim)" />
        <p>{t('stats.empty')}</p>
      </div>
    );
  }

  return (
    <div className="stats-page">
      <div className="stats-page-inner">
        {/* ── Header ── */}
        <div className="stats-page-header">
          <div>
            <h1 className="stats-page-title">{t('stats.libraryOverview')}</h1>
            <p className="stats-page-subtitle">
              {t('stats.subtitle', {
                count: s.total.toLocaleString(),
                size: formatBytes(s.totalBytes),
                collections: collections.length,
              })}
            </p>
          </div>
          {s.thisWeek > 0 && (
            <div className="stats-page-badge">
              <TrendingUp size={13} />
              <span>{t('stats.thisWeekBadge', { count: s.thisWeek })}</span>
            </div>
          )}
        </div>

        {/* ── Hero cards ── */}
        <div className="stats-hero-grid">
          <HeroCard
            icon={Database}
            iconColor="#1d7af0"
            iconBg="rgba(29,122,240,0.12)"
            value={s.total.toLocaleString()}
            label={t('stats.totalItems')}
            sub={t('stats.avgPerFile', { size: formatBytes(s.avgBytes) })}
          />
          <HeroCard
            icon={HardDrive}
            iconColor="#14b8a6"
            iconBg="rgba(20,184,166,0.12)"
            value={formatBytes(s.totalBytes)}
            label={t('stats.totalStorage')}
            sub={s.largest ? t('stats.largest', { name: s.largest.display_name }) : undefined}
          />
          <HeroCard
            icon={Star}
            iconColor="#f59e0b"
            iconBg="rgba(245,158,11,0.12)"
            value={s.starred}
            label={t('stats.starred')}
          />
          <HeroCard
            icon={FolderOpen}
            iconColor="#8b5cf6"
            iconBg="rgba(139,92,246,0.12)"
            value={collections.length}
            label={t('stats.collections')}
            sub={
              s.largestCollection
                ? `"${s.largestCollection.name}" • ${s.largestCollection.count} items`
                : t('stats.noCollections')
            }
          />
        </div>

        {/* ── Type breakdown + Activity chart (2-col) ── */}
        <div className="stats-two-col">
          <Section title={t('stats.mediaTypes')} icon={Layers}>
            <TypeBreakdown
              images={s.images.length}
              videos={s.videos.length}
              audios={s.audios.length}
              total={s.total}
            />
            {/* Formats */}
            <div className="stats-formats">
              {s.topExts.map(([ext, count]) => (
                <span key={ext} className="stats-format-chip">
                  <span className="stats-format-ext">.{ext}</span>
                  <span className="stats-format-count">{count}</span>
                </span>
              ))}
            </div>
          </Section>

          <Section title={t('stats.importActivity')} icon={Activity}>
            <div className="stats-activity-summary">
              <div className="stats-act-stat">
                <span className="stats-act-value">{s.thisMonth}</span>
                <span className="stats-act-label">{t('stats.thisMonth')}</span>
              </div>
              <div className="stats-act-divider" />
              <div className="stats-act-stat">
                <span className="stats-act-value">{s.avgPerDay}</span>
                <span className="stats-act-label">{t('stats.avgPerDay')}</span>
              </div>
              <div className="stats-act-divider" />
              <div className="stats-act-stat">
                <span className="stats-act-value">{s.daysSince}</span>
                <span className="stats-act-label">{t('stats.daysActive')}</span>
              </div>
            </div>
            <ActivityChart items={items} />
            {s.busiestDay && (
              <p className="stats-busiest-day">
                {t('stats.busiestDay')} <strong>{formatDateShort(s.busiestDay[0])}</strong> ·{' '}
                {s.busiestDay[1]} items
              </p>
            )}
          </Section>
        </div>

        {/* ── Timeline + Tags (2-col) ── */}
        <div className="stats-two-col">
          <Section title={t('stats.timeline')} icon={Calendar}>
            <div className="stats-timeline">
              <div className="stats-timeline-item">
                <div className="stats-timeline-dot stats-timeline-dot-start" />
                <div className="stats-timeline-content">
                  <div className="stats-timeline-date">{formatDate(s.oldest?.created_at)}</div>
                  <div className="stats-timeline-name">{s.oldest?.display_name}</div>
                  <div className="stats-timeline-badge">{t('stats.firstImport')}</div>
                </div>
              </div>
              <div className="stats-timeline-line" />
              <div className="stats-timeline-item">
                <div className="stats-timeline-dot stats-timeline-dot-end" />
                <div className="stats-timeline-content">
                  <div className="stats-timeline-date">{formatDate(s.newest?.created_at)}</div>
                  <div className="stats-timeline-name">{s.newest?.display_name}</div>
                  <div className="stats-timeline-badge stats-timeline-badge-recent">
                    {t('stats.latest')}
                  </div>
                </div>
              </div>
            </div>
            <div className="stats-org-row">
              <div className="stats-org-item">
                <Tag size={13} color="var(--accent)" />
                <span className="stats-org-val">{s.tagged}</span>
                <span className="stats-org-lbl">{t('stats.tagged')}</span>
              </div>
              <div className="stats-org-item">
                <Layers size={13} color="#10b981" />
                <span className="stats-org-val">{s.inCollection}</span>
                <span className="stats-org-lbl">{t('stats.inCollections')}</span>
              </div>
            </div>
          </Section>

          {s.topTags.length > 0 ? (
            <Section title={t('stats.topTags')} icon={Tag}>
              <TopTagsList tags={s.topTags} total={s.total} />
            </Section>
          ) : (
            <Section title={t('stats.organisation')} icon={Tag}>
              <div className="stats-no-tags">
                <Tag size={32} strokeWidth={1} color="var(--text-dim)" />
                <p>{t('stats.noTagsYet')}</p>
              </div>
            </Section>
          )}
        </div>

        {/* ── Collections breakdown ── */}
        <Section title={t('stats.collectionsSection')} icon={FolderOpen}>
          <div className="stats-collections-grid">
            <div className="stats-col-tile">
              <div
                className="stats-col-tile-icon"
                style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}
              >
                <BookImage size={16} />
              </div>
              <div className="stats-col-tile-num">{s.albums.length}</div>
              <div className="stats-col-tile-label">{t('stats.photoAlbums')}</div>
            </div>
            <div className="stats-col-tile">
              <div
                className="stats-col-tile-icon"
                style={{ background: 'rgba(20,184,166,0.12)', color: '#14b8a6' }}
              >
                <ListMusic size={16} />
              </div>
              <div className="stats-col-tile-num">{s.playlists.length}</div>
              <div className="stats-col-tile-label">{t('stats.playlists')}</div>
            </div>
            <div className="stats-col-tile">
              <div
                className="stats-col-tile-icon"
                style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
              >
                <Folder size={16} />
              </div>
              <div className="stats-col-tile-num">{folders.length}</div>
              <div className="stats-col-tile-label">{t('stats.folders')}</div>
            </div>
            <div className="stats-col-tile">
              <div
                className="stats-col-tile-icon"
                style={{ background: 'rgba(29,122,240,0.12)', color: '#1d7af0' }}
              >
                <Globe size={16} />
              </div>
              <div className="stats-col-tile-num">{s.withGps.toLocaleString()}</div>
              <div className="stats-col-tile-label">{t('stats.withLocation')}</div>
            </div>
            {s.withFaces > 0 && (
              <div className="stats-col-tile">
                <div
                  className="stats-col-tile-icon"
                  style={{ background: 'rgba(244,63,94,0.12)', color: '#f43f5e' }}
                >
                  <Smile size={16} />
                </div>
                <div className="stats-col-tile-num">{s.withFaces.toLocaleString()}</div>
                <div className="stats-col-tile-label">{t('stats.withFaces')}</div>
              </div>
            )}
            <div className="stats-col-tile">
              <div
                className="stats-col-tile-icon"
                style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}
              >
                <ScanText size={16} />
              </div>
              <div className="stats-col-tile-num">{s.withText.toLocaleString()}</div>
              <div className="stats-col-tile-label">{t('stats.withText')}</div>
            </div>
            <div className="stats-col-tile">
              <div
                className="stats-col-tile-icon"
                style={{ background: 'rgba(6,182,212,0.12)', color: '#06b6d4' }}
              >
                <FileSearch size={16} />
              </div>
              <div className="stats-col-tile-num">{s.ocrCoverage}%</div>
              <div className="stats-col-tile-label">{t('stats.textScanned')}</div>
            </div>
            {s.ocrWords > 0 && (
              <div className="stats-col-tile">
                <div
                  className="stats-col-tile-icon"
                  style={{ background: 'rgba(168,85,247,0.12)', color: '#a855f7' }}
                >
                  <FileText size={16} />
                </div>
                <div className="stats-col-tile-num">{s.ocrWords.toLocaleString()}</div>
                <div className="stats-col-tile-label">{t('stats.wordsFound')}</div>
              </div>
            )}
            {s.megapixels > 0 && (
              <div className="stats-col-tile">
                <div
                  className="stats-col-tile-icon"
                  style={{ background: 'rgba(236,72,153,0.12)', color: '#ec4899' }}
                >
                  <Image size={16} />
                </div>
                <div className="stats-col-tile-num">
                  {Math.round(s.megapixels).toLocaleString()}
                </div>
                <div className="stats-col-tile-label">{t('stats.megapixels')}</div>
              </div>
            )}
            {s.audios.length > 0 && (
              <div className="stats-col-tile">
                <div
                  className="stats-col-tile-icon"
                  style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
                >
                  <Clock size={16} />
                </div>
                <div className="stats-col-tile-num">{formatDuration(s.audioSeconds)}</div>
                <div className="stats-col-tile-label">{t('stats.listeningTime')}</div>
              </div>
            )}
            {s.artists > 0 && (
              <div className="stats-col-tile">
                <div
                  className="stats-col-tile-icon"
                  style={{ background: 'rgba(20,184,166,0.12)', color: '#14b8a6' }}
                >
                  <Music size={16} />
                </div>
                <div className="stats-col-tile-num">{s.artists.toLocaleString()}</div>
                <div className="stats-col-tile-label">{t('stats.artists')}</div>
              </div>
            )}
            <div className="stats-col-tile">
              <div
                className="stats-col-tile-icon"
                style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}
              >
                <Layers size={16} />
              </div>
              <div className="stats-col-tile-num">{s.inCollection.toLocaleString()}</div>
              <div className="stats-col-tile-label">{t('stats.organised')}</div>
            </div>
          </div>
          {s.collectionCounts.length > 0 && (
            <div className="stats-top-collections">
              <div className="stats-top-coll-header">{t('stats.largestCollections')}</div>
              {[...s.collectionCounts]
                .sort((a, b) => b.count - a.count)
                .slice(0, 5)
                .map((g) => (
                  <div key={g.id} className="stats-top-coll-row">
                    <span className="stats-top-coll-emoji">
                      {g.emoji || g.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="stats-top-coll-name">{g.name}</span>
                    <span className="stats-top-coll-kind">
                      {t(`common.${g.kind ?? 'album'}`, { defaultValue: g.kind ?? 'album' })}
                    </span>
                    <div className="stats-top-coll-bar-wrap">
                      <div
                        className="stats-top-coll-bar"
                        style={{
                          width: `${s.collectionCounts[0]?.count ? (g.count / s.collectionCounts[0].count) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="stats-top-coll-count">{g.count}</span>
                  </div>
                ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
