import { useMemo, useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { translateTag } from '../../utils/translateTag';
import { COLLECTION_NAME_MAX_LEN } from '../../utils/limits';
import FolderTree from '../common/FolderTree';
import CollectionAvatar from '../common/CollectionAvatar';
import CollectionContextMenu from '../common/CollectionContextMenu';
import ScrollArea from '../common/ScrollArea';
import {
  FolderOpen,
  BookImage,
  Disc,
  Tags,
  BarChart2,
  Tag,
  X,
  Plus,
  ChevronsLeft,
  HardDrive,
  Image,
  Video,
  Music,
  Star,
  Layers,
  Sparkles,
  ArrowDownAZ,
  ArrowUpAZ,
  GripVertical,
  ListOrdered,
  Play,
  Search,
  ScanText,
  ChevronDown,
} from 'lucide-react';
import { formatBytes } from '../../utils/format';
import './SecondaryPanel.css';

// ── Reusable group list ───────────────────────────────────────────────────────

function RenameInline({ name, onConfirm, onCancel }) {
  const [val, setVal] = useState(name);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <form
      className="sp-rename-form"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(val);
      }}
    >
      <input
        ref={inputRef}
        className="sp-rename-input"
        value={val}
        maxLength={COLLECTION_NAME_MAX_LEN}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => onConfirm(val)}
      />
    </form>
  );
}

// sort mode: 'az' | 'za' | 'custom'
function CollectionList({
  collections,
  items,
  allItems,
  onCollectionClick,
  onRename,
  onPlayAll,
  onCreateCollection,
  emptyTextKey,
  sortKey,
  createTooltipKey,
  createPlaceholderKey,
  searchPlaceholderKey,
  activeCollectionId,
  onSidebarPin,
  onDelete,
  onSetCover,
  dragOverId,
  // Album-only: album_group rows nest their child albums, collapsible like
  // the Folders panel. `onSetParent(albumId, groupId|null)` moves an album
  // into/out of a group.
  groupable = false,
  onSetParent,
}) {
  const { t } = useTranslation();
  const storageKey = `vivid-sp-sort-${sortKey}`;
  const orderKey = `vivid-sp-order-${sortKey}`;

  const [sortMode, setSortMode] = useState(() => localStorage.getItem(storageKey) || 'az');
  const [customOrder, setCustomOrder] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(orderKey) || 'null');
    } catch {
      return null;
    }
  });
  const editMode = sortMode === 'custom';
  const dragHandleKey = `vivid-sp-drag-${sortKey}`;
  const [dragHandleEnabled, setDragHandleEnabled] = useState(
    () => localStorage.getItem(dragHandleKey) === 'true',
  );
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuTimer = useRef(null);
  const sortBtnRef = useRef(null);

  const [search, setSearch] = useState('');
  const [ctxMenu, setCtxMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState('album');
  const newInputRef = useRef(null);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const toggleGroupCollapsed = (id) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Pointer-based drag state
  const [dragId, setDragId] = useState(null); // id being dragged
  const [insertIdx, setInsertIdx] = useState(null); // drop line position in sorted array
  const dragState = useRef(null); // { id, startY, currentY }
  const listRef = useRef(null);

  // Persist sort mode and drag-handle toggle
  useEffect(() => {
    localStorage.setItem(storageKey, sortMode);
  }, [sortMode, storageKey]);
  useEffect(() => {
    if (customOrder) localStorage.setItem(orderKey, JSON.stringify(customOrder));
  }, [customOrder, orderKey]);
  useEffect(() => {
    localStorage.setItem(dragHandleKey, String(dragHandleEnabled));
  }, [dragHandleEnabled, dragHandleKey]);

  function openSortMenu() {
    clearTimeout(sortMenuTimer.current);
    setSortMenuOpen(true);
  }
  function scheduleSortMenuClose() {
    sortMenuTimer.current = setTimeout(() => setSortMenuOpen(false), 120);
  }

  const counts = useMemo(() => {
    const m = {};
    items.forEach((i) => {
      (i.collection_ids ?? []).forEach((cid) => {
        m[cid] = (m[cid] || 0) + 1;
      });
    });
    return m;
  }, [items]);

  const sorted = useMemo(() => {
    // Searching flattens the hierarchy (matches at any level, top-level or
    // nested in a group) rather than trying to keep the tree shape — a
    // search result you have to expand a group to see isn't really "found".
    const base = groupable && !search ? collections.filter((g) => !g.parent_id) : collections;
    let list = [...base].filter(
      (g) => !search || g.name.toLowerCase().includes(search.toLowerCase()),
    );
    if (sortMode === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortMode === 'za') list.sort((a, b) => b.name.localeCompare(a.name));
    else if (sortMode === 'custom' && customOrder) {
      const idx = new Map(customOrder.map((id, i) => [id, i]));
      list.sort((a, b) => (idx.get(a.id) ?? 9999) - (idx.get(b.id) ?? 9999));
    }
    return list;
  }, [collections, search, sortMode, customOrder, groupable]);

  // ── Pointer-based drag reorder ────────────────────────────────────────────────

  function getInsertIndex(clientY) {
    if (!listRef.current) return null;
    const rows = listRef.current.querySelectorAll('.sp-group-row');
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return rows.length;
  }

  function handleDragHandleDown(e, id) {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    dragState.current = { id };
    setDragId(id);
    setInsertIdx(null);

    function onMove(ev) {
      const idx = getInsertIndex(ev.clientY);
      setInsertIdx(idx);
    }
    function onUp(ev) {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      const active = dragState.current?.id;
      dragState.current = null;
      setDragId(null);

      const dropIdx = getInsertIndex(ev.clientY);
      setInsertIdx(null);

      if (active == null || dropIdx == null) return;

      // Build ordered array from all collections
      const allIds = collections.map((g) => g.id);
      let order = customOrder ? customOrder.filter((id) => allIds.includes(id)) : [...allIds];
      allIds.forEach((id) => {
        if (!order.includes(id)) order.push(id);
      });

      // Work in sorted-view order for the reorder
      const sortedIds = sorted.map((g) => g.id);
      const fromIdx = sortedIds.indexOf(active);
      if (fromIdx < 0) return;

      // Remove from position, insert at drop
      const next = [...sortedIds];
      next.splice(fromIdx, 1);
      const insertAt = dropIdx > fromIdx ? dropIdx - 1 : dropIdx;
      next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, active);

      // Merge back: unsearched collections keep relative order at end
      const newOrder = [...next];
      allIds.forEach((id) => {
        if (!newOrder.includes(id)) newOrder.push(id);
      });
      setCustomOrder(newOrder);
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  return (
    <div className="sp-group-list" ref={listRef}>
      {/* Toolbar: search + sort + drag + new */}
      <div className="sp-sort-bar">
        <div className="ft-search">
          <Search size={11} className="ft-search-icon" />
          <input
            className="ft-search-input"
            placeholder={searchPlaceholderKey ? t(searchPlaceholderKey) : t('panel.filter')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="ft-search-clear" onClick={() => setSearch('')}>
              <X size={10} />
            </button>
          )}
        </div>
        {/* Sort button: cycles az→za on click; in custom mode opens a hover dropdown */}
        <div
          className="sp-sort-btn-wrap"
          onMouseEnter={editMode ? openSortMenu : undefined}
          onMouseLeave={editMode ? scheduleSortMenuClose : undefined}
        >
          <button
            ref={sortBtnRef}
            className={`sp-sort-btn ${sortMode === 'custom' ? 'sp-sort-custom' : ''}`}
            onClick={() => {
              if (sortMode === 'az') setSortMode('za');
              else if (sortMode === 'za') {
                if (!customOrder) setCustomOrder(collections.map((g) => g.id));
                setSortMode('custom');
              } else setSortMode('az');
            }}
            title={
              sortMode === 'az'
                ? t('panel.sortAZ')
                : sortMode === 'za'
                  ? t('panel.sortZA')
                  : t('panel.sortCustom')
            }
          >
            {sortMode === 'az' && <ArrowDownAZ size={13} />}
            {sortMode === 'za' && <ArrowUpAZ size={13} />}
            {sortMode === 'custom' && <ListOrdered size={13} />}
          </button>

          {editMode && sortMenuOpen && (
            <div
              className="sp-sort-menu"
              onMouseEnter={openSortMenu}
              onMouseLeave={scheduleSortMenuClose}
            >
              {[
                { mode: 'az', icon: <ArrowDownAZ size={12} />, label: 'A → Z' },
                { mode: 'za', icon: <ArrowUpAZ size={12} />, label: 'Z → A' },
                {
                  mode: 'custom',
                  icon: <ListOrdered size={12} />,
                  label: t('panel.sortCustomLabel'),
                },
              ].map(({ mode, icon, label }) => (
                <button
                  key={mode}
                  className={`sp-sort-menu-item ${sortMode === mode ? 'active' : ''}`}
                  onClick={() => {
                    if (mode === 'az' || mode === 'za') setSortMode(mode);
                    setSortMenuOpen(false);
                  }}
                >
                  {icon}
                  <span>{label}</span>
                  {sortMode === mode && <span className="sp-sort-menu-check">✓</span>}
                </button>
              ))}
              <div className="sp-sort-menu-sep" />
              <button
                className={`sp-sort-menu-item ${dragHandleEnabled ? 'active' : ''}`}
                onClick={() => {
                  setDragHandleEnabled((v) => !v);
                  setSortMenuOpen(false);
                }}
              >
                <GripVertical size={12} />
                <span>{t('panel.dragToReorder')}</span>
                {dragHandleEnabled && <span className="sp-sort-menu-check">✓</span>}
              </button>
            </div>
          )}
        </div>
        {onCreateCollection && (
          <button
            className={`sp-sort-btn ${creating ? 'sp-sort-custom' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              if (creating) {
                setCreating(false);
                setNewName('');
              } else {
                setCreating(true);
                setNewName('');
                setTimeout(() => newInputRef.current?.focus(), 30);
              }
            }}
            title={
              creating ? t('panel.cancelCreate') : t(createTooltipKey ?? 'panel.newCollection')
            }
          >
            <Plus size={13} />
          </button>
        )}
      </div>

      {creating && (
        <form
          className="sp-create-form"
          onSubmit={(e) => {
            e.preventDefault();
            const n = newName.trim();
            if (n) onCreateCollection(n, groupable ? newKind : undefined);
            setCreating(false);
            setNewName('');
            setNewKind('album');
          }}
        >
          {groupable && (
            <div className="sp-create-type-toggle">
              <button
                type="button"
                className={newKind === 'album' ? 'active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setNewKind('album')}
              >
                {t('common.album')}
              </button>
              <button
                type="button"
                className={newKind === 'album_group' ? 'active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setNewKind('album_group')}
              >
                {t('collection.albumGroup')}
              </button>
            </div>
          )}
          <input
            ref={newInputRef}
            className="sp-rename-input"
            placeholder={
              groupable && newKind === 'album_group'
                ? t('collection.newGroupPlaceholder')
                : createPlaceholderKey
                  ? t(createPlaceholderKey)
                  : t('panel.collectionName')
            }
            value={newName}
            maxLength={COLLECTION_NAME_MAX_LEN}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setCreating(false);
                setNewName('');
                setNewKind('album');
              }
            }}
            onBlur={() => {
              setCreating(false);
              setNewName('');
              setNewKind('album');
            }}
          />
        </form>
      )}

      {sorted.length === 0 && (
        <div className="sp-empty">{search ? t('panel.noMatches') : t(emptyTextKey)}</div>
      )}

      {sorted.map((g, idx) => {
        const isDragging = g.id === dragId;
        const showLineBefore = editMode && insertIdx === idx && dragId && !isDragging;
        const showLineAfter =
          editMode && insertIdx === sorted.length && idx === sorted.length - 1 && dragId;
        const isGroupKind = g.kind === 'album_group';
        const children =
          groupable && isGroupKind && !search
            ? collections
                .filter((c) => c.parent_id === g.id)
                .sort((a, b) => a.name.localeCompare(b.name))
            : [];
        const collapsed = collapsedGroups.has(g.id);
        const count = isGroupKind ? children.length : counts[g.id] || 0;
        return (
          <div key={g.id}>
            {showLineBefore && <div className="sp-drop-line" />}
            <div
              role="button"
              tabIndex={0}
              data-collection-id={g.id}
              className={`sp-group-row ${isDragging ? 'sp-dragging' : ''} ${g.id === activeCollectionId ? 'sp-group-active' : ''} ${g.id === dragOverId ? 'sp-drag-over' : ''}`}
              onClick={() => !editMode && renamingId !== g.id && onCollectionClick(g.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !editMode && renamingId !== g.id) onCollectionClick(g.id);
              }}
              onContextMenu={(e) => {
                if (!editMode) {
                  e.preventDefault();
                  e.stopPropagation();
                  setCtxMenu({ x: e.clientX, y: e.clientY, group: g });
                }
              }}
            >
              {editMode && dragHandleEnabled && (
                <GripVertical
                  size={13}
                  className="sp-drag-handle"
                  onPointerDown={(e) => handleDragHandleDown(e, g.id)}
                />
              )}
              <div className="sp-avatar-wrap">
                <CollectionAvatar
                  group={g}
                  allItems={allItems ?? items}
                  size={32}
                  radius={7}
                  style={{ isolation: 'isolate' }}
                  draggable={false}
                  onDragStart={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                />
                {groupable && isGroupKind && (
                  // A subtle "this is a group" badge by default; hovering the
                  // row swaps it for the collapse/expand chevron, so nothing
                  // is reserved in the row's normal flow (every row — album
                  // or group — starts flush left, no extra padding) and the
                  // toggle only appears when it's actually actionable.
                  <span
                    role="button"
                    tabIndex={-1}
                    className={`sp-group-toggle ${collapsed ? 'collapsed' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleGroupCollapsed(g.id);
                    }}
                    title={collapsed ? t('panel.expandGroup') : t('panel.collapseGroup')}
                  >
                    <Layers size={8} className="sp-group-badge-icon" />
                    <ChevronDown size={11} className="sp-group-chevron-icon" />
                  </span>
                )}
              </div>
              <div className="sp-group-info">
                {renamingId === g.id ? (
                  <RenameInline
                    name={g.name}
                    onConfirm={(val) => {
                      setRenamingId(null);
                      onRename?.(g.id, val);
                    }}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <>
                    <span className="sp-group-name">{g.name}</span>
                    <span className="sp-group-count">
                      {isGroupKind
                        ? t('collection.albumCount', { count })
                        : t('panel.item', { count })}
                    </span>
                  </>
                )}
              </div>
              {onPlayAll && !isGroupKind && count > 0 && !editMode && (
                <button
                  className="sp-play-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayAll(
                      items.filter((i) => i.collection_ids?.includes(g.id)),
                      g.name,
                    );
                  }}
                  title={t('panel.playAll')}
                >
                  <Play size={11} />
                </button>
              )}
            </div>
            {showLineAfter && <div className="sp-drop-line" />}

            {isGroupKind && !collapsed && children.length > 0 && (
              <div className="sp-group-children">
                {children.map((child) => {
                  const childCount = counts[child.id] || 0;
                  return (
                    <div
                      key={child.id}
                      role="button"
                      tabIndex={0}
                      data-collection-id={child.id}
                      className={`sp-group-row sp-group-row-child ${child.id === activeCollectionId ? 'sp-group-active' : ''} ${child.id === dragOverId ? 'sp-drag-over' : ''}`}
                      onClick={() => renamingId !== child.id && onCollectionClick(child.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && renamingId !== child.id)
                          onCollectionClick(child.id);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setCtxMenu({ x: e.clientX, y: e.clientY, group: child });
                      }}
                    >
                      <CollectionAvatar
                        group={child}
                        allItems={allItems ?? items}
                        size={28}
                        radius={6}
                        style={{ isolation: 'isolate' }}
                        draggable={false}
                        onDragStart={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      />
                      <div className="sp-group-info">
                        {renamingId === child.id ? (
                          <RenameInline
                            name={child.name}
                            onConfirm={(val) => {
                              setRenamingId(null);
                              onRename?.(child.id, val);
                            }}
                            onCancel={() => setRenamingId(null)}
                          />
                        ) : (
                          <>
                            <span className="sp-group-name">{child.name}</span>
                            <span className="sp-group-count">
                              {t('panel.item', { count: childCount })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {ctxMenu && (
        <CollectionContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          target={ctxMenu.group}
          collections={collections}
          onRename={() => setRenamingId(ctxMenu.group.id)}
          onSetCover={onSetCover}
          onSidebarPin={onSidebarPin}
          onSetParent={groupable ? onSetParent : undefined}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

// ── Tags panel ────────────────────────────────────────────────────────────────

// sort mode: 'count' (default) | 'az' | 'za'
function TagsPanel({ items, onTagClick }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState(
    () => localStorage.getItem('vivid-sp-sort-tags') || 'count',
  );

  useEffect(() => {
    localStorage.setItem('vivid-sp-sort-tags', sortMode);
  }, [sortMode]);

  const allTags = useMemo(() => {
    const freq = {};
    items.forEach((i) => {
      [...(i.tags || []), ...(i.auto_tags || [])].forEach((t) => {
        freq[t] = (freq[t] || 0) + 1;
      });
    });
    return Object.entries(freq);
  }, [items]);

  const tags = useMemo(() => {
    let list = search
      ? allTags.filter(([t]) => t.toLowerCase().includes(search.toLowerCase()))
      : [...allTags];
    if (sortMode === 'az') list.sort((a, b) => a[0].localeCompare(b[0]));
    else if (sortMode === 'za') list.sort((a, b) => b[0].localeCompare(a[0]));
    else list.sort((a, b) => b[1] - a[1]);
    return list;
  }, [allTags, search, sortMode]);

  return (
    <div className="sp-group-list">
      <div className="sp-sort-bar">
        <div className="ft-search">
          <Search size={11} className="ft-search-icon" />
          <input
            className="ft-search-input"
            placeholder={t('panel.filterTags')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="ft-search-clear" onClick={() => setSearch('')}>
              <X size={10} />
            </button>
          )}
        </div>
        <button
          className="sp-sort-btn"
          onClick={() => {
            if (sortMode === 'count') setSortMode('az');
            else if (sortMode === 'az') setSortMode('za');
            else setSortMode('count');
          }}
          title={
            sortMode === 'count'
              ? t('panel.sortCount')
              : sortMode === 'az'
                ? t('panel.sortAZTag')
                : t('panel.sortZATag')
          }
        >
          {sortMode === 'count' && <ListOrdered size={13} />}
          {sortMode === 'az' && <ArrowDownAZ size={13} />}
          {sortMode === 'za' && <ArrowUpAZ size={13} />}
        </button>
      </div>
      {tags.length === 0 && <div className="sp-empty">{t('panel.noTagsYet')}</div>}
      {tags.map(([tag, count]) => (
        <button key={tag} className="sp-tag-row" onClick={() => onTagClick(tag)}>
          <Tag size={12} className="sp-tag-icon" />
          <span className="sp-tag-name">{translateTag(tag, t)}</span>
          <span className="sp-tag-count">{count}</span>
        </button>
      ))}
    </div>
  );
}

// ── Stats panel ───────────────────────────────────────────────────────────────

function StatsPanel({ items, collections }) {
  const { t } = useTranslation();
  const [dbStats, setDbStats] = useState(null);
  const [ocrStats, setOcrStats] = useState(null);

  useEffect(() => {
    invoke('get_library_stats')
      .then(setDbStats)
      .catch(() => {});
    invoke('get_ocr_status')
      .then(setOcrStats)
      .catch(() => {});
  }, [items.length]); // refresh when library size changes

  const local = useMemo(() => {
    const total = items.length;
    const images = items.filter((i) => i.media_type === 'image').length;
    const videos = items.filter((i) => i.media_type === 'video').length;
    const audios = items.filter((i) => i.media_type === 'audio').length;
    const totalBytes = items.reduce((s, i) => s + (i.file_size || 0), 0);
    const starred = items.filter((i) => i.starred).length;
    return { total, images, videos, audios, totalBytes, starred };
  }, [items]);

  const typeRows = [
    { labelKey: 'panel.stats.photos', count: local.images, icon: Image, color: '#1d7af0' },
    { labelKey: 'panel.stats.videos', count: local.videos, icon: Video, color: '#14b8a6' },
    { labelKey: 'panel.stats.audio', count: local.audios, icon: Music, color: '#f59e0b' },
  ];

  const indexed = dbStats?.total_indexed ?? 0;
  const unindexed = dbStats?.total_unindexed ?? 0;
  const indexable = indexed + unindexed;
  const indexPct = indexable > 0 ? Math.round((indexed / indexable) * 100) : 0;

  const ocrScanned = ocrStats?.scanned ?? 0;
  const ocrTotal = ocrStats?.total ?? 0;
  const ocrPct = ocrTotal > 0 ? Math.round((ocrScanned / ocrTotal) * 100) : 0;

  return (
    <div className="sp-info-panel">
      <div className="sp-info-hero">
        <div className="sp-info-total">{local.total.toLocaleString()}</div>
        <div className="sp-info-total-label">{t('panel.stats.totalItems')}</div>
        <div className="sp-info-storage">{formatBytes(local.totalBytes)}</div>
      </div>

      <div className="sp-info-types">
        {typeRows.map(({ labelKey, count, icon: Icon, color }) => (
          <div key={labelKey} className="sp-info-type-tile">
            <div className="sp-info-type-icon" style={{ color, background: `${color}1a` }}>
              <Icon size={14} />
            </div>
            <div className="sp-info-type-body">
              <span className="sp-info-type-count">{count.toLocaleString()}</span>
              <span className="sp-info-type-label">{t(labelKey)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="sp-info-quick">
        <div className="sp-info-quick-row">
          <Star size={13} color="#f59e0b" />
          <span>
            {local.starred} {t('panel.stats.starred')}
          </span>
        </div>
        <div className="sp-info-quick-row">
          <Layers size={13} color="#10b981" />
          <span>
            {collections.length} {t('panel.stats.collections')}
          </span>
        </div>
        {dbStats && (
          <div className="sp-info-quick-row">
            <Tag size={13} color="#a78bfa" />
            <span>
              {dbStats.total_tags.toLocaleString()} {t('panel.stats.tagsAssigned')}
            </span>
          </div>
        )}
        <div className="sp-info-quick-row">
          <HardDrive size={13} color="#6366f1" />
          <span>{formatBytes(local.totalBytes)}</span>
        </div>
      </div>

      {indexable > 0 && (
        <div className="sp-info-index">
          <div className="sp-info-index-header">
            <Sparkles size={12} color="var(--accent)" />
            <span className="sp-info-index-label">{t('panel.stats.aiCoverage')}</span>
            <span className="sp-info-index-pct">{indexPct}%</span>
          </div>
          <div className="sp-info-index-bar">
            <div className="sp-info-index-fill" style={{ width: `${indexPct}%` }} />
          </div>
          <div className="sp-info-index-sub">
            <span>
              {indexed.toLocaleString()} {t('panel.stats.indexed')}
            </span>
            <span>
              {unindexed.toLocaleString()} {t('panel.stats.notYet')}
            </span>
          </div>
        </div>
      )}

      {ocrTotal > 0 && (
        <div className="sp-info-index">
          <div className="sp-info-index-header">
            <ScanText size={12} color="var(--accent)" />
            <span className="sp-info-index-label">{t('panel.stats.ocrCoverage')}</span>
            <span className="sp-info-index-pct">{ocrPct}%</span>
          </div>
          <div className="sp-info-index-bar">
            <div className="sp-info-index-fill" style={{ width: `${ocrPct}%` }} />
          </div>
          <div className="sp-info-index-sub">
            <span>
              {ocrScanned.toLocaleString()} {t('panel.stats.indexed')}
            </span>
            <span>
              {(ocrTotal - ocrScanned).toLocaleString()} {t('panel.stats.notYet')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const PANEL_ICONS = {
  folders: FolderOpen,
  albums: BookImage,
  playlists: Disc,
  tags: Tags,
  stats: BarChart2,
};

const PANEL_TITLE_KEYS = {
  folders: 'sidebar.folders',
  albums: 'sidebar.albums',
  playlists: 'sidebar.playlists',
  tags: 'sidebar.tags',
  stats: 'sidebar.stats',
};

export default function SecondaryPanel({
  type,
  collections,
  items,
  onCollectionClick,
  onTagClick,
  onClose,
  onRenameCollection,
  onPlayPlaylist,
  onCreateCollection,
  activeCollectionId,
  onSidebarPin,
  onDeleteCollection,
  onSetCollectionCover,
  dragOverId,
  folders,
  folderCounts,
  activeFolderId,
  dragOverFolderId,
  onFolderClick,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  onSetCollectionParent,
}) {
  const { t } = useTranslation();
  const Icon = PANEL_ICONS[type] || BarChart2;

  // Only the Stats panel's header shows this — fetched here (not inside
  // StatsPanel) since the header itself lives in this component.
  const [workspace, setWorkspace] = useState(null);
  useEffect(() => {
    if (type !== 'stats') return;
    invoke('get_active_workspace')
      .then(setWorkspace)
      .catch(() => {});
  }, [type]);

  const albumCollections = useMemo(
    () => collections.filter((g) => g.kind === 'album' || g.kind === 'album_group'),
    [collections],
  );
  const playlistCollections = useMemo(
    () => collections.filter((g) => g.kind === 'playlist'),
    [collections],
  );

  return (
    <div className="secondary-panel">
      <div className="sp-header">
        <Icon size={14} className="sp-header-icon" />
        <span className="sp-header-title">{t(PANEL_TITLE_KEYS[type] ?? 'sidebar.folders')}</span>
        {type === 'stats' && workspace && (
          <span
            className="sp-header-workspace"
            title={workspace.kind === 'default' ? undefined : workspace.path}
          >
            {workspace.kind === 'default' ? <HardDrive size={11} /> : <FolderOpen size={11} />}
            <span>{workspace.name}</span>
          </span>
        )}
        <button className="sp-collapse-btn" onClick={onClose} title={t('panel.collapsePanel')}>
          <ChevronsLeft size={13} />
        </button>
      </div>

      <ScrollArea className="sp-body" innerClassName="sp-body-inner">
        {type === 'folders' && (
          <FolderTree
            folders={folders || []}
            counts={folderCounts || {}}
            activeFolderId={activeFolderId}
            dragOverFolderId={dragOverFolderId}
            onFolderClick={onFolderClick}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            onMoveFolder={onMoveFolder}
          />
        )}
        {type === 'albums' && (
          <CollectionList
            collections={albumCollections}
            items={items.filter((i) => i.media_type === 'image' || i.media_type === 'video')}
            allItems={items}
            onCollectionClick={onCollectionClick}
            onRename={onRenameCollection}
            onCreateCollection={
              onCreateCollection
                ? (name, kind) => onCreateCollection(name, '', null, kind || 'album')
                : undefined
            }
            emptyTextKey="panel.noAlbums"
            sortKey="albums"
            createTooltipKey="panel.newAlbum"
            createPlaceholderKey="panel.albumName"
            searchPlaceholderKey="panel.searchAlbums"
            activeCollectionId={activeCollectionId}
            onSidebarPin={onSidebarPin}
            onDelete={onDeleteCollection}
            onSetCover={onSetCollectionCover}
            dragOverId={dragOverId}
            groupable
            onSetParent={onSetCollectionParent}
          />
        )}
        {type === 'playlists' && (
          <CollectionList
            collections={playlistCollections}
            items={items.filter((i) => i.media_type === 'audio' || i.media_type === 'video')}
            allItems={items}
            onCollectionClick={onCollectionClick}
            onRename={onRenameCollection}
            onPlayAll={onPlayPlaylist}
            onCreateCollection={
              onCreateCollection
                ? (name) => onCreateCollection(name, '', null, 'playlist')
                : undefined
            }
            emptyTextKey="panel.noPlaylists"
            sortKey="playlists"
            createTooltipKey="panel.newPlaylist"
            createPlaceholderKey="panel.playlistName"
            searchPlaceholderKey="panel.searchPlaylists"
            activeCollectionId={activeCollectionId}
            onSidebarPin={onSidebarPin}
            onDelete={onDeleteCollection}
            onSetCover={onSetCollectionCover}
            dragOverId={dragOverId}
          />
        )}
        {type === 'tags' && <TagsPanel items={items} onTagClick={onTagClick} />}
        {type === 'stats' && <StatsPanel items={items} collections={collections} />}
      </ScrollArea>
    </div>
  );
}
