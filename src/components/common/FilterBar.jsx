import { useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Calendar,
  Tag,
  Image,
  Video,
  Music,
  Star,
  MapPin,
  ChevronDown,
  Filter,
  Sparkles,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  HardDrive,
  ScanText,
  Layers,
  Camera,
  ChevronsRight,
  Maximize2,
} from 'lucide-react';
import { translateTag } from '../../utils/translateTag';
import { captureDate } from '../../utils/sort';
import useDismiss from '../../hooks/useDismiss';
import ScrollArea from './ScrollArea';
import './FilterBar.css';

function formatExactDay(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export const COLOR_LABELS = [
  { value: 'red', hex: '#ef4444', labelKey: 'filterBar.color.red' },
  { value: 'orange', hex: '#f97316', labelKey: 'filterBar.color.orange' },
  { value: 'yellow', hex: '#eab308', labelKey: 'filterBar.color.yellow' },
  { value: 'green', hex: '#22c55e', labelKey: 'filterBar.color.green' },
  { value: 'blue', hex: '#3b82f6', labelKey: 'filterBar.color.blue' },
  { value: 'purple', hex: '#a855f7', labelKey: 'filterBar.color.purple' },
];

export const DATE_RANGES = [
  { value: 'today', labelKey: 'filterBar.dateRange.today' },
  { value: 'week', labelKey: 'filterBar.dateRange.week' },
  { value: 'month', labelKey: 'filterBar.dateRange.month' },
  { value: 'year', labelKey: 'filterBar.dateRange.year' },
];

const MEDIA_TYPES = [
  { value: 'image', labelKey: 'filterBar.mediaType.image', icon: Image },
  { value: 'video', labelKey: 'filterBar.mediaType.video', icon: Video },
  { value: 'audio', labelKey: 'filterBar.mediaType.audio', icon: Music },
];

const ORIENTATIONS = [
  { value: 'landscape', labelKey: 'filterBar.orient.landscape', icon: RectangleHorizontal },
  { value: 'portrait', labelKey: 'filterBar.orient.portrait', icon: RectangleVertical },
  { value: 'square', labelKey: 'filterBar.orient.square', icon: Square },
];

const FILE_SIZES = [
  { value: 'small', labelKey: 'filterBar.fileSize.small' },
  { value: 'medium', labelKey: 'filterBar.fileSize.medium' },
  { value: 'large', labelKey: 'filterBar.fileSize.large' },
];

// Classified by long edge (max of width/height) rather than orientation-
// specific width or height, so a portrait 1080×1920 photo/video and a
// landscape 1920×1080 one both land in the same "Full HD" bucket — matches
// how these terms are used colloquially, independent of orientation.
const RESOLUTIONS = [
  { value: 'sd', labelKey: 'filterBar.resolution.sd' }, // < 1280px long edge
  { value: 'hd', labelKey: 'filterBar.resolution.hd' }, // 1280–1919 (720p)
  { value: 'fhd', labelKey: 'filterBar.resolution.fhd' }, // 1920–3839 (1080p)
  { value: 'uhd', labelKey: 'filterBar.resolution.uhd' }, // 3840+ (4K and up)
];

// ── Dropdown helper ───────────────────────────────────────────────────────────
function Dropdown({ label, active, onClear, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useDismiss(ref, () => setOpen(false), { enabled: open, escape: false });

  return (
    <div className={`fb-dropdown-wrap ${active ? 'has-value' : ''}`} ref={ref}>
      <button className="fb-dropdown-btn" onClick={() => setOpen((v) => !v)}>
        <span className="fb-dropdown-label">{label}</span>
        {active && (
          <button
            className="fb-clear-x"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            <X size={10} />
          </button>
        )}
        <ChevronDown size={11} className={`fb-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="fb-dropdown-menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

// Scrollable, padded body for a dropdown's option list — gives every simple
// single/multi-select menu the same top/bottom breathing room and the same
// height cap, whether it has 3 items or 30. Menus with their own bespoke
// layout (Date's custom range, Tag's search box) render outside this.
function MenuList({ children }) {
  return (
    <ScrollArea className="fb-menu-scroll" innerClassName="fb-menu-scroll-inner">
      {children}
    </ScrollArea>
  );
}

// A single option row. `multi` stops the click from bubbling to the dropdown's
// own onClick (which closes it on select) so multi-select menus stay open
// across picks, and shows a remove "x" once active; single-select menus close
// on pick instead, matching a native <select>.
function MenuItem({
  active,
  onClick,
  icon: Icon,
  iconSize = 12,
  iconOpacity = 0.7,
  multi,
  children,
}) {
  return (
    <button
      className={`fb-menu-item ${active ? 'active' : ''}`}
      onClick={(e) => {
        if (multi) e.stopPropagation();
        onClick();
      }}
    >
      {Icon && <Icon size={iconSize} style={{ opacity: iconOpacity }} />} {children}
      {multi && active && <X size={9} style={{ marginLeft: 'auto' }} />}
    </button>
  );
}

// Quick filters cycle through three states instead of just on/off: unset →
// include (must match) → exclude (must NOT match) → back to unset. `true` is
// accepted alongside 'include' so filter objects saved before this existed
// (plain booleans) still cycle and match sensibly.
function cycleTri(value) {
  if (value === 'include' || value === true) return 'exclude';
  if (value === 'exclude') return null;
  return 'include';
}

function matchesTri(value, isTrue) {
  if (value === 'include' || value === true) return isTrue;
  if (value === 'exclude') return !isTrue;
  return true;
}

// A quick-filter toggle button reflecting cycleTri's three states — plain
// `active` styling for "include", a distinct "exclude" styling (dimmed +
// strikethrough) so the two are never confused at a glance.
function TriToggle({ value, onClick, icon: Icon, children }) {
  const state =
    value === 'exclude' ? 'exclude' : value === 'include' || value === true ? 'include' : 'off';
  return (
    <button className={`fb-toggle fb-toggle-${state}`} onClick={onClick}>
      {Icon && <Icon size={12} />} {children}
    </button>
  );
}

// Collapsed popover holding the tri-state quick filters — starred,
// in-collection, has-GPS, has-text — so they don't take up permanent space
// in the controls row. Unlike `Dropdown`'s menu, clicking a toggle inside
// doesn't close the popover, so several can be flipped in one visit.
function TogglesMenu({ active, title, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useDismiss(ref, () => setOpen(false), { enabled: open, escape: false });

  return (
    <div className={`fb-toggles-wrap ${active ? 'has-value' : ''}`} ref={ref}>
      <button
        className={`fb-toggles-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={title}
      >
        <ChevronsRight size={13} />
      </button>
      {open && <div className="fb-toggles-menu">{children}</div>}
    </div>
  );
}

export default function FilterBar({
  filters,
  onChange,
  allItems = [],
  moods = [],
  moodFilter = null,
  onMoodFilter = null,
}) {
  const { t } = useTranslation();
  const {
    colorLabel,
    dateRange,
    exactDay,
    dateFrom,
    dateTo,
    tags = [],
    mediaType = [],
    extension = [],
    starred,
    hasGps,
    hasText,
    orientation,
    fileSize,
    resolution,
    collection,
    cameras = [],
  } = filters;
  const activeResolutions = Array.isArray(resolution) ? resolution : resolution ? [resolution] : [];
  const [tagSearch, setTagSearch] = useState('');

  const allTags = useMemo(() => {
    const set = new Set();
    allItems.forEach((i) => {
      (i.tags || []).forEach((tg) => set.add(tg));
      (i.auto_tags || []).forEach((tg) => set.add(tg));
    });
    return Array.from(set).sort();
  }, [allItems]);

  const allExtensions = useMemo(() => {
    const set = new Set();
    allItems.forEach((i) => {
      const ext = i.file_name.split('.').pop()?.toLowerCase();
      if (ext) set.add(ext);
    });
    return Array.from(set).sort();
  }, [allItems]);

  // Camera "device" = make + model, keyed so two items from the same camera
  // group together even if only one of the two fields is present.
  const allCameras = useMemo(() => {
    const map = new Map();
    allItems.forEach((i) => {
      if (!i.camera_make && !i.camera_model) return;
      const key = `${i.camera_make || ''}|${i.camera_model || ''}`;
      if (!map.has(key)) {
        map.set(key, [i.camera_make, i.camera_model].filter(Boolean).join(' '));
      }
    });
    return Array.from(map, ([key, label]) => ({ key, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [allItems]);

  const filteredTags = tagSearch
    ? allTags.filter((tg) => tg.includes(tagSearch.toLowerCase()))
    : allTags;

  const activeTags = Array.isArray(tags) ? tags : tags ? [tags] : [];
  const activeMediaTypes = Array.isArray(mediaType) ? mediaType : mediaType ? [mediaType] : [];
  const activeExtensions = Array.isArray(extension) ? extension : extension ? [extension] : [];
  const activeCameras = Array.isArray(cameras) ? cameras : cameras ? [cameras] : [];
  const activeColors = Array.isArray(colorLabel) ? colorLabel : colorLabel ? [colorLabel] : [];

  const hasAny =
    activeColors.length > 0 ||
    dateRange ||
    exactDay ||
    dateFrom ||
    dateTo ||
    activeTags.length > 0 ||
    activeMediaTypes.length > 0 ||
    activeExtensions.length > 0 ||
    starred ||
    hasGps ||
    hasText ||
    orientation ||
    fileSize ||
    activeResolutions.length > 0 ||
    collection ||
    activeCameras.length > 0 ||
    !!moodFilter;

  function set(patch) {
    onChange({ ...filters, ...patch });
  }

  function toggleTag(tg) {
    const next = activeTags.includes(tg) ? activeTags.filter((x) => x !== tg) : [...activeTags, tg];
    set({ tags: next });
  }

  function toggleMediaType(value) {
    const next = activeMediaTypes.includes(value)
      ? activeMediaTypes.filter((x) => x !== value)
      : [...activeMediaTypes, value];
    set({ mediaType: next });
  }

  function toggleExtension(ext) {
    const next = activeExtensions.includes(ext)
      ? activeExtensions.filter((x) => x !== ext)
      : [...activeExtensions, ext];
    set({ extension: next });
  }

  function toggleCamera(key) {
    const next = activeCameras.includes(key)
      ? activeCameras.filter((x) => x !== key)
      : [...activeCameras, key];
    set({ cameras: next });
  }

  function toggleColor(value) {
    const next = activeColors.includes(value)
      ? activeColors.filter((x) => x !== value)
      : [...activeColors, value];
    set({ colorLabel: next });
  }

  function toggleResolution(value) {
    const next = activeResolutions.includes(value)
      ? activeResolutions.filter((x) => x !== value)
      : [...activeResolutions, value];
    set({ resolution: next });
  }

  function clearAll() {
    onChange({
      colorLabel: [],
      dateRange: null,
      exactDay: null,
      dateFrom: null,
      dateTo: null,
      tags: [],
      mediaType: [],
      extension: [],
      starred: null,
      hasGps: null,
      hasText: null,
      orientation: null,
      fileSize: null,
      resolution: [],
      collection: null,
      cameras: [],
    });
    onMoodFilter?.(null);
  }

  const tagLabel =
    activeTags.length === 0
      ? t('filterBar.tag')
      : activeTags.length === 1
        ? `# ${translateTag(activeTags[0], t)}`
        : t('filterBar.tagsCount', { count: activeTags.length });

  const mediaTypeLabel =
    activeMediaTypes.length === 0
      ? t('filterBar.type')
      : activeMediaTypes.length === 1
        ? t(MEDIA_TYPES.find((m) => m.value === activeMediaTypes[0])?.labelKey ?? '')
        : t('filterBar.typesCount', { count: activeMediaTypes.length });

  const extLabel =
    activeExtensions.length === 0
      ? t('filterBar.format')
      : activeExtensions.length === 1
        ? `.${activeExtensions[0]}`
        : t('filterBar.formatsCount', { count: activeExtensions.length });

  const cameraLabel =
    activeCameras.length === 0
      ? t('filterBar.camera')
      : activeCameras.length === 1
        ? (allCameras.find((c) => c.key === activeCameras[0])?.label ?? t('filterBar.camera'))
        : t('filterBar.camerasCount', { count: activeCameras.length });

  const resolutionLabel =
    activeResolutions.length === 0
      ? t('filterBar.resolution.label')
      : activeResolutions.length === 1
        ? t(RESOLUTIONS.find((r) => r.value === activeResolutions[0])?.labelKey ?? '')
        : t('filterBar.resolutionsCount', { count: activeResolutions.length });

  const activeDateRange = DATE_RANGES.find((d) => d.value === dateRange);
  const customRangeLabel =
    dateFrom || dateTo
      ? `${dateFrom ? formatExactDay(dateFrom) : '…'} – ${dateTo ? formatExactDay(dateTo) : '…'}`
      : null;
  const dateLabel = exactDay
    ? formatExactDay(exactDay)
    : customRangeLabel
      ? customRangeLabel
      : activeDateRange
        ? t(activeDateRange.labelKey)
        : t('filterBar.date');

  const colorLabelText =
    activeColors.length === 0
      ? t('filterBar.colorLabel')
      : activeColors.length === 1
        ? t(COLOR_LABELS.find((c) => c.value === activeColors[0])?.labelKey ?? '')
        : t('filterBar.colorsCount', { count: activeColors.length });

  return (
    <div className="filter-bar fb-v3">
      <div className="fb-controls-row">
        {/* ── Left group: content filters ── */}
        <div className="fb-group">
          <span className="fb-group-label">
            <Filter size={11} /> {t('filterBar.filters')}
          </span>

          {/* Date */}
          <Dropdown
            label={dateLabel}
            active={!!(dateRange || exactDay || dateFrom || dateTo)}
            onClear={() => set({ dateRange: null, exactDay: null, dateFrom: null, dateTo: null })}
          >
            <MenuList>
              {DATE_RANGES.map(({ value, labelKey }) => (
                <MenuItem
                  key={value}
                  active={dateRange === value}
                  onClick={() =>
                    set({
                      dateRange: dateRange === value ? null : value,
                      exactDay: null,
                      dateFrom: null,
                      dateTo: null,
                    })
                  }
                >
                  {t(labelKey)}
                </MenuItem>
              ))}
            </MenuList>
            {/* Custom range — stop propagation so picking dates doesn't close the menu */}
            <div className="fb-menu-section fb-date-custom" onClick={(e) => e.stopPropagation()}>
              <span className="fb-menu-label">{t('filterBar.customRange')}</span>
              <div className="fb-date-inputs">
                <input
                  type="date"
                  className="fb-date-input"
                  aria-label={t('filterBar.from')}
                  value={dateFrom || ''}
                  max={dateTo || undefined}
                  onChange={(e) =>
                    set({ dateFrom: e.target.value || null, dateRange: null, exactDay: null })
                  }
                />
                <span className="fb-date-sep">–</span>
                <input
                  type="date"
                  className="fb-date-input"
                  aria-label={t('filterBar.to')}
                  value={dateTo || ''}
                  min={dateFrom || undefined}
                  onChange={(e) =>
                    set({ dateTo: e.target.value || null, dateRange: null, exactDay: null })
                  }
                />
              </div>
            </div>
          </Dropdown>

          {/* Media type — multi-select */}
          <Dropdown
            label={mediaTypeLabel}
            active={activeMediaTypes.length > 0}
            onClear={() => set({ mediaType: [] })}
          >
            <MenuList>
              {MEDIA_TYPES.map(({ value, labelKey, icon }) => (
                <MenuItem
                  key={value}
                  active={activeMediaTypes.includes(value)}
                  icon={icon}
                  multi
                  onClick={() => toggleMediaType(value)}
                >
                  {t(labelKey)}
                </MenuItem>
              ))}
            </MenuList>
          </Dropdown>

          {/* Tag — multi-select */}
          <Dropdown
            label={tagLabel}
            active={activeTags.length > 0}
            onClear={() => set({ tags: [] })}
          >
            <div className="fb-menu-search-wrap">
              <input
                className="fb-menu-search"
                placeholder={t('filterBar.searchTags')}
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>
            <MenuList>
              {filteredTags.length === 0 ? (
                <div className="fb-menu-empty">{t('filterBar.noTags')}</div>
              ) : (
                filteredTags.map((tg) => (
                  <MenuItem
                    key={tg}
                    active={activeTags.includes(tg)}
                    icon={Tag}
                    iconSize={11}
                    iconOpacity={0.6}
                    multi
                    onClick={() => toggleTag(tg)}
                  >
                    {translateTag(tg, t)}
                  </MenuItem>
                ))
              )}
            </MenuList>
          </Dropdown>

          {/* Extension — multi-select */}
          <Dropdown
            label={extLabel}
            active={activeExtensions.length > 0}
            onClear={() => set({ extension: [] })}
          >
            <MenuList>
              {allExtensions.map((ext) => (
                <MenuItem
                  key={ext}
                  active={activeExtensions.includes(ext)}
                  multi
                  onClick={() => toggleExtension(ext)}
                >
                  .{ext}
                </MenuItem>
              ))}
            </MenuList>
          </Dropdown>

          {/* Orientation */}
          <Dropdown
            label={
              orientation
                ? t(ORIENTATIONS.find((o) => o.value === orientation)?.labelKey ?? '')
                : t('filterBar.orientation')
            }
            active={!!orientation}
            onClear={() => set({ orientation: null })}
          >
            <MenuList>
              {ORIENTATIONS.map(({ value, labelKey, icon }) => (
                <MenuItem
                  key={value}
                  active={orientation === value}
                  icon={icon}
                  onClick={() => set({ orientation: orientation === value ? null : value })}
                >
                  {t(labelKey)}
                </MenuItem>
              ))}
            </MenuList>
          </Dropdown>

          {/* File size */}
          <Dropdown
            label={
              fileSize
                ? t(FILE_SIZES.find((s) => s.value === fileSize)?.labelKey ?? '')
                : t('filterBar.size')
            }
            active={!!fileSize}
            onClear={() => set({ fileSize: null })}
          >
            <MenuList>
              {FILE_SIZES.map(({ value, labelKey }) => (
                <MenuItem
                  key={value}
                  active={fileSize === value}
                  icon={HardDrive}
                  onClick={() => set({ fileSize: fileSize === value ? null : value })}
                >
                  {t(labelKey)}
                </MenuItem>
              ))}
            </MenuList>
          </Dropdown>

          {/* Resolution (long edge) — multi-select */}
          <Dropdown
            label={resolutionLabel}
            active={activeResolutions.length > 0}
            onClear={() => set({ resolution: [] })}
          >
            <MenuList>
              {RESOLUTIONS.map(({ value, labelKey }) => (
                <MenuItem
                  key={value}
                  active={activeResolutions.includes(value)}
                  icon={Maximize2}
                  multi
                  onClick={() => toggleResolution(value)}
                >
                  {t(labelKey)}
                </MenuItem>
              ))}
            </MenuList>
          </Dropdown>

          {/* Camera device — multi-select */}
          <Dropdown
            label={cameraLabel}
            active={activeCameras.length > 0}
            onClear={() => set({ cameras: [] })}
          >
            <MenuList>
              {allCameras.map(({ key, label }) => (
                <MenuItem
                  key={key}
                  active={activeCameras.includes(key)}
                  icon={Camera}
                  multi
                  onClick={() => toggleCamera(key)}
                >
                  {label}
                </MenuItem>
              ))}
            </MenuList>
          </Dropdown>

          {/* Color label — multi-select */}
          <Dropdown
            label={colorLabelText}
            active={activeColors.length > 0}
            onClear={() => set({ colorLabel: [] })}
          >
            <div className="fb-menu-colors">
              {COLOR_LABELS.map(({ value, hex, labelKey }) => (
                <button
                  key={value}
                  className={`fb-color-dot ${activeColors.includes(value) ? 'active' : ''}`}
                  style={{ '--dot': hex }}
                  title={t(labelKey)}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleColor(value);
                  }}
                />
              ))}
            </div>
          </Dropdown>

          {/* Vibes — only when CLIP moods are available */}
          {moods.length > 0 && onMoodFilter && (
            <Dropdown
              label={moodFilter ? moodFilter : t('filterBar.vibe')}
              active={!!moodFilter}
              onClear={() => onMoodFilter(null)}
            >
              <MenuList>
                {moods.map((mood) => (
                  <MenuItem
                    key={mood}
                    active={moodFilter === mood}
                    icon={Sparkles}
                    iconSize={11}
                    iconOpacity={0.6}
                    onClick={() => onMoodFilter(moodFilter === mood ? null : mood)}
                  >
                    {mood}
                  </MenuItem>
                ))}
              </MenuList>
            </Dropdown>
          )}
        </div>

        {/* ── Right: clear-all + collapsed quick (tri-state) filters, kept
            together so Clear never needs a row of its own ── */}
        <div className="fb-controls-right">
          {hasAny && (
            <button className="fb-clear-all" onClick={clearAll} title={t('filterBar.clear')}>
              <X size={11} /> {t('filterBar.clear')}
            </button>
          )}
          <TogglesMenu
            active={!!(starred || collection || hasGps || hasText)}
            title={t('filterBar.quickFilters')}
          >
            <TriToggle
              value={starred}
              onClick={() => set({ starred: cycleTri(starred) })}
              icon={Star}
            >
              {t('filterBar.starred')}
            </TriToggle>
            <TriToggle
              value={collection}
              onClick={() => set({ collection: cycleTri(collection) })}
              icon={Layers}
            >
              {t('filterBar.inCollection')}
            </TriToggle>
            <TriToggle
              value={hasGps}
              onClick={() => set({ hasGps: cycleTri(hasGps) })}
              icon={MapPin}
            >
              {t('filterBar.hasGps')}
            </TriToggle>
            <TriToggle
              value={hasText}
              onClick={() => set({ hasText: cycleTri(hasText) })}
              icon={ScanText}
            >
              {t('filterBar.hasText')}
            </TriToggle>
          </TogglesMenu>
        </div>
      </div>
      {/* end fb-controls-row */}

      {/* ── Active tag/exact-day pills — only rendered when there's an actual
          pill to show, so it never appears as an empty row on its own ── */}
      {(activeTags.length > 0 || exactDay) && (
        <div className="fb-pills-row">
          {activeTags.map((tg) => (
            <span key={tg} className="fb-tag-pill">
              # {translateTag(tg, t)}
              <button onClick={() => toggleTag(tg)}>
                <X size={9} />
              </button>
            </span>
          ))}
          {exactDay && (
            <button className="fb-tag-pill fb-exactday" onClick={() => set({ exactDay: null })}>
              <Calendar size={10} /> {formatExactDay(exactDay)} <X size={9} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Apply filter object to an array of MediaItem */
export function applyFilters(items, filters) {
  let out = items;
  const colors = Array.isArray(filters.colorLabel)
    ? filters.colorLabel
    : filters.colorLabel
      ? [filters.colorLabel]
      : [];
  if (colors.length > 0) {
    out = out.filter((i) => colors.includes(i.color_label));
  }
  if (filters.dateRange) {
    const now = new Date();
    const start = new Date();
    if (filters.dateRange === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (filters.dateRange === 'week') {
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
    } else if (filters.dateRange === 'month') {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    } else if (filters.dateRange === 'year') {
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
    }
    out = out.filter((i) => new Date(captureDate(i)) >= start);
  }
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`) : null;
    const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`) : null;
    out = out.filter((i) => {
      const d = new Date(captureDate(i));
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }
  if (filters.orientation) {
    out = out.filter((i) => {
      const w = i.width,
        h = i.height;
      if (!w || !h) return false;
      const ratio = w / h;
      if (filters.orientation === 'landscape') return ratio > 1.05;
      if (filters.orientation === 'portrait') return ratio < 0.95;
      if (filters.orientation === 'square') return ratio >= 0.95 && ratio <= 1.05;
      return true;
    });
  }
  if (filters.fileSize) {
    out = out.filter((i) => {
      const b = i.file_size ?? 0;
      if (filters.fileSize === 'small') return b < 1_000_000;
      if (filters.fileSize === 'medium') return b >= 1_000_000 && b <= 10_000_000;
      if (filters.fileSize === 'large') return b > 10_000_000;
      return true;
    });
  }
  const resolutions = Array.isArray(filters.resolution)
    ? filters.resolution
    : filters.resolution
      ? [filters.resolution]
      : [];
  if (resolutions.length > 0) {
    out = out.filter((i) => resolutions.includes(resolutionBucket(i.width, i.height)));
  }
  return out;
}

/**
 * Classify a media item's resolution by its long edge (max of width/height),
 * independent of orientation — a portrait 1080×1920 and a landscape
 * 1920×1080 both land in "fhd". Returns `null` for missing/invalid
 * dimensions (audio, or an image/video whose size was never recorded),
 * which the filter then excludes rather than guessing.
 */
export function resolutionBucket(width, height) {
  if (!width || !height) return null;
  const longEdge = Math.max(width, height);
  if (longEdge < 1280) return 'sd';
  if (longEdge < 1920) return 'hd';
  if (longEdge < 3840) return 'fhd';
  return 'uhd';
}

/**
 * Apply every FilterBar predicate to an array of MediaItem — the
 * exactDay/tags/mediaType/extension/starred/hasGps/hasText/collection/cameras
 * checks that live outside `applyFilters` (they're plain equality/membership
 * checks with no shared setup, unlike color/date/orientation/size), plus
 * `applyFilters` itself. One entry point so callers (the library view, the
 * world map view) don't each re-implement the same predicate list.
 */
export function applyAllFilters(items, filters) {
  const exts = (filters.extension || []).map((e) => '.' + e.toLowerCase());
  let out = items.filter((i) => {
    if (filters.exactDay && (i.date_taken || i.created_at)?.slice(0, 10) !== filters.exactDay)
      return false;
    if (
      filters.tags?.length &&
      !filters.tags.every((t) => i.tags?.includes(t) || i.auto_tags?.includes(t))
    )
      return false;
    if (filters.mediaType?.length && !filters.mediaType.includes(i.media_type)) return false;
    if (exts.length && !exts.some((e) => i.file_name.toLowerCase().endsWith(e))) return false;
    if (!matchesTri(filters.starred, !!i.starred)) return false;
    if (!matchesTri(filters.hasGps, i.gps_lat != null && i.gps_lng != null)) return false;
    if (!matchesTri(filters.hasText, !!(i.ocr_text && i.ocr_text.trim()))) return false;
    if (!matchesTri(filters.collection, i.collection_ids?.length > 0)) return false;
    if (
      filters.cameras?.length &&
      !filters.cameras.includes(`${i.camera_make || ''}|${i.camera_model || ''}`)
    )
      return false;
    return true;
  });
  return applyFilters(out, filters);
}

/**
 * Whether any filter field (or the mood filter, which lives outside the
 * `filters` object) is currently set — the same field list `applyAllFilters`
 * checks, kept as one function so the "is anything active" question is
 * answered in exactly one place rather than three call sites in App.jsx that
 * previously had to be kept in sync by hand whenever a field was added.
 */
export function hasActiveFilterFields(filters, moodFilter) {
  return !!(
    filters.colorLabel?.length > 0 ||
    filters.dateRange ||
    filters.exactDay ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.tags?.length > 0 ||
    filters.mediaType?.length > 0 ||
    filters.extension?.length > 0 ||
    filters.starred ||
    filters.hasGps ||
    filters.hasText ||
    filters.orientation ||
    filters.fileSize ||
    filters.resolution?.length > 0 ||
    filters.collection ||
    filters.cameras?.length > 0 ||
    moodFilter
  );
}
