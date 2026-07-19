import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import CollectionAvatar from '../common/CollectionAvatar';
import ScrollArea from '../common/ScrollArea';
import './Sidebar.css';
import {
  Image,
  Video,
  Music,
  Library,
  Star,
  Trash2,
  Settings,
  FolderOpen,
  BookImage,
  Disc,
  Tags,
  BarChart2,
  Bell,
  Map,
  Play,
  PinOff,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
} from 'lucide-react';

// Default/max pinned-section height — 8 rows, same cap as the old hardcoded
// behavior. User-adjustable (smaller) via the drag handle below the section;
// see `vivid-sidebar-pinned-height` in localStorage. Never allowed to exceed
// the actual pinned-item count's height, so there's no dead space between
// the last row and the divider below it.
const PINNED_ROW_HEIGHT = 31;
const PINNED_DEFAULT_ROWS = 8;
const PINNED_MIN_ROWS = 2;

const LIBRARY_ITEMS = [
  { id: 'all', labelKey: 'sidebar.allMedia', icon: Library },
  { id: 'starred', labelKey: 'sidebar.starred', icon: Star },
  { id: 'image', labelKey: 'sidebar.photos', icon: Image },
  { id: 'video', labelKey: 'sidebar.videos', icon: Video },
  { id: 'audio', labelKey: 'sidebar.audio', icon: Music },
];

const COLLECTION_ITEMS = [
  { id: 'albums', labelKey: 'sidebar.albums', icon: BookImage },
  { id: 'playlists', labelKey: 'sidebar.playlists', icon: Disc },
  { id: 'folders', labelKey: 'sidebar.folders', icon: FolderOpen },
];
const META_ITEMS = [{ id: 'tags', labelKey: 'sidebar.tags', icon: Tags }];

const FOOTER_ITEMS_TOP = [
  { id: 'stats', labelKey: 'sidebar.stats', icon: BarChart2 },
  { id: 'settings', labelKey: 'sidebar.settings', icon: Settings },
];
const FOOTER_ITEMS_BOTTOM = [{ id: 'trash', labelKey: 'sidebar.trash', icon: Trash2 }];

function SidebarItem({
  label,
  icon: Icon,
  active,
  panelActive,
  onClick,
  count,
  collapsed,
  showCounts,
}) {
  return (
    <button
      className={`sidebar-item ${active ? 'active' : panelActive ? 'panel-active' : ''}`}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <Icon size={15} strokeWidth={1.8} />
      {!collapsed && <span className="sidebar-item-label">{label}</span>}
      {!collapsed && showCounts && count != null && count > 0 && (
        <span className="sidebar-count">{count}</span>
      )}
    </button>
  );
}

export default function Sidebar({
  filter,
  onFilterChange,
  counts,
  showCounts = true,
  view,
  onViewChange,
  secondaryPanel,
  onSecondaryPanel,
  collapsed,
  onToggleCollapse,
  activeCollection,
  activeFolder,
  collections,
  allItems = [],
  unreadNotifications = 0,
  onSidebarPin,
  pinnedOrder = [],
  onCollectionClick,
  onPlayPlaylist,
  dragOverId,
}) {
  const { t } = useTranslation();
  const [pinnedSectionOpen, setPinnedSectionOpen] = useState(
    () => localStorage.getItem('vivid-sidebar-pinned-collapsed') !== 'true',
  );
  const togglePinnedSection = () => {
    setPinnedSectionOpen((prev) => {
      const next = !prev;
      localStorage.setItem('vivid-sidebar-pinned-collapsed', String(!next));
      return next;
    });
  };

  const pinnedCollections = (() => {
    const pinned = (collections ?? []).filter((g) => g.sidebar_pin);
    if (pinnedOrder.length === 0) return pinned.slice(0, 30);
    const ordered = pinnedOrder.map((id) => pinned.find((g) => g.id === id)).filter(Boolean);
    const rest = pinned.filter((g) => !pinnedOrder.includes(g.id));
    return [...ordered, ...rest].slice(0, 30);
  })();

  const [pinnedHeight, setPinnedHeight] = useState(() => {
    const n = Number(localStorage.getItem('vivid-sidebar-pinned-height'));
    return Number.isFinite(n) && n > 0 ? n : PINNED_DEFAULT_ROWS * PINNED_ROW_HEIGHT;
  });

  // Rendered as `max-height`, not `height`, below — a cap, not a forced
  // size. That's what makes a short pinned list shrink-wrap to its content
  // with zero gap before the divider, regardless of whether
  // PINNED_ROW_HEIGHT exactly matches the real (font-rendering-dependent)
  // row height: max-height only ever clips content that's *taller* than
  // it, it never pads content that's shorter.
  const pinnedMaxHeight = PINNED_DEFAULT_ROWS * PINNED_ROW_HEIGHT;
  const pinnedMinHeight = PINNED_MIN_ROWS * PINNED_ROW_HEIGHT;
  const effectivePinnedHeight = Math.min(Math.max(pinnedHeight, pinnedMinHeight), pinnedMaxHeight);

  // Drag the divider below the pinned section to resize it — tracked on
  // `document` (not the handle itself) so the drag keeps following the mouse
  // even once the cursor leaves the thin handle strip.
  const handlePinnedResizeStart = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = effectivePinnedHeight;
    const onMove = (ev) => {
      const next = Math.min(
        pinnedMaxHeight,
        Math.max(pinnedMinHeight, startHeight + (ev.clientY - startY)),
      );
      setPinnedHeight(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setPinnedHeight((h) => {
        localStorage.setItem('vivid-sidebar-pinned-height', String(h));
        return h;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  // A library filter is only "active" on the plain library view — not when a
  // collection or folder scope is in effect (those highlight their own items).
  const isLibraryActive = (id) =>
    filter === id && !activeCollection && !activeFolder && view === 'library';
  const [pinCtx, setPinCtx] = useState(null); // { id, x, y }

  const isPanelOpen = (id) => secondaryPanel === id;

  // Highlight the collection/folder panel button that owns the active scope,
  // even when its secondary panel is collapsed. Suppressed for
  // albums/playlists when the active collection is itself a pinned sidebar
  // shortcut — that row already carries its own highlight, and double-
  // highlighting both it and the primary Albums/Playlists nav item for one
  // selection reads as two different things being active at once.
  const activeCollectionKind = collections?.find((g) => g.id === activeCollection)?.kind;
  const isActiveCollectionPinned = pinnedCollections.some((g) => g.id === activeCollection);
  const isPanelScoped = (id) => {
    if (view !== 'library') return false;
    if (id === 'folders') return !!activeFolder;
    if (id === 'albums') return activeCollectionKind === 'album' && !isActiveCollectionPinned;
    if (id === 'playlists') return activeCollectionKind === 'playlist' && !isActiveCollectionPinned;
    return false;
  };

  function handlePanelItem(id) {
    // Toggle secondary panel, keep view as library (content shown in secondary)
    onSecondaryPanel(secondaryPanel === id ? null : id);
  }

  function handleLibraryItem(id) {
    onSecondaryPanel(null);
    onViewChange('library');
    onFilterChange(id);
  }

  function handleFooterItem(id) {
    if (id === 'stats') {
      onSecondaryPanel(secondaryPanel === 'stats' ? null : 'stats');
      return;
    }
    if (view === id) return;
    onSecondaryPanel(null);
    onViewChange(id);
  }

  const isFooterActive = (id) => (id === 'stats' ? secondaryPanel === 'stats' : view === id);

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Logo + collapse toggle */}
      <div className="sidebar-logo-row" data-tauri-drag-region>
        <div className="traffic-lights">
          <button className="tl-btn tl-close" onClick={() => getCurrentWindow().close()} />
          <button className="tl-btn tl-minimize" onClick={() => getCurrentWindow().minimize()} />
          <button className="tl-btn tl-zoom" onClick={() => getCurrentWindow().toggleMaximize()} />
        </div>
        {!collapsed && <span className="app-logo">Vivid</span>}
        <button
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
      </div>

      {/* Library filters */}
      <nav className="sidebar-nav">
        {LIBRARY_ITEMS.map(({ id, labelKey, icon }) => (
          <SidebarItem
            key={id}
            id={id}
            label={t(labelKey)}
            icon={icon}
            active={isLibraryActive(id)}
            count={counts[id]}
            onClick={() => handleLibraryItem(id)}
            collapsed={collapsed}
            showCounts={showCounts}
          />
        ))}
      </nav>

      <div className="sidebar-divider" />

      {/* Collection panels */}
      <nav className="sidebar-nav">
        {COLLECTION_ITEMS.map(({ id, labelKey, icon }) => (
          <SidebarItem
            key={id}
            id={id}
            label={t(labelKey)}
            icon={icon}
            active={isPanelScoped(id)}
            panelActive={!isPanelScoped(id) && isPanelOpen(id)}
            count={counts[id]}
            onClick={() => handlePanelItem(id)}
            collapsed={collapsed}
            showCounts={showCounts}
          />
        ))}
      </nav>

      {/* Pinned collections */}
      {pinnedCollections.length > 0 && (
        <>
          <div className="sidebar-divider" />
          {!collapsed && (
            <button
              type="button"
              className="sidebar-pinned-header"
              onClick={togglePinnedSection}
              aria-expanded={pinnedSectionOpen}
            >
              <span className="sidebar-section-label sidebar-pinned-header-label">
                {t('panel.pinned', 'Pinned')}
              </span>
              <ChevronDown
                size={12}
                className={`sidebar-pinned-chevron ${pinnedSectionOpen ? 'open' : ''}`}
              />
            </button>
          )}
          {(collapsed || pinnedSectionOpen) &&
            (() => {
              const pinnedRows = pinnedCollections.map((g) => {
                const isActive = view === 'library' && activeCollection === g.id;
                // Playlists get a hover play-button overlay on their cover that
                // queues every track in the collection — mirrors the secondary
                // panel's "play all", but inline on the sidebar pin.
                const canPlay = g.kind === 'playlist' && !!onPlayPlaylist;
                return (
                  <button
                    key={g.id}
                    data-collection-id={g.id}
                    className={`sidebar-item sidebar-pinned-item ${isActive ? 'active' : ''} ${g.id === dragOverId ? 'sidebar-drag-over' : ''}`}
                    onClick={() => {
                      if (isActive) return;
                      onCollectionClick?.(g.id);
                      onSecondaryPanel(null);
                      onViewChange('library');
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setPinCtx({ id: g.id, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <span className={`sidebar-pin-cover${canPlay ? ' sidebar-pin-playable' : ''}`}>
                      <CollectionAvatar
                        group={g}
                        allItems={allItems}
                        size={15}
                        radius={4}
                        draggable={false}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onDragStart={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      />
                      {canPlay && (
                        <span
                          className="sidebar-pin-play"
                          role="button"
                          tabIndex={-1}
                          title={t('panel.playAll')}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlayPlaylist(
                              allItems.filter((i) => i.collection_id === g.id),
                              g.name,
                            );
                          }}
                        >
                          <Play size={11} fill="currentColor" />
                        </span>
                      )}
                    </span>
                    {!collapsed && <span className="sidebar-item-label">{g.name}</span>}
                  </button>
                );
              });

              return !collapsed ? (
                <div
                  className="sidebar-pinned-resizable"
                  style={{ maxHeight: effectivePinnedHeight }}
                >
                  <ScrollArea
                    className="sidebar-pinned-scroll"
                    innerClassName="sidebar-nav sidebar-pinned-nav"
                  >
                    {pinnedRows}
                  </ScrollArea>
                </div>
              ) : (
                <nav className="sidebar-nav sidebar-pinned-nav">{pinnedRows}</nav>
              );
            })()}
        </>
      )}

      {/* Pinned item context menu */}
      {pinCtx && (
        <>
          <div className="pin-ctx-backdrop" onClick={() => setPinCtx(null)} />
          <div
            className="sp-ctx-menu"
            style={{ position: 'fixed', left: pinCtx.x, top: pinCtx.y, zIndex: 2000 }}
          >
            <button
              className="sp-ctx-item"
              onClick={() => {
                onSidebarPin(pinCtx.id, false);
                setPinCtx(null);
              }}
            >
              <PinOff size={12} />
              <span>{t('panel.unpin')}</span>
            </button>
          </div>
        </>
      )}

      {pinnedCollections.length > 0 && !collapsed && pinnedSectionOpen ? (
        <div
          className="sidebar-pinned-resize-handle"
          onMouseDown={handlePinnedResizeStart}
          title={t('sidebar.resizePinned')}
        />
      ) : (
        <div className="sidebar-divider" />
      )}

      {/* Meta panels */}
      <nav className="sidebar-nav">
        <SidebarItem
          label={t('sidebar.worldMap')}
          icon={Map}
          active={view === 'worldmap'}
          onClick={() => {
            onSecondaryPanel(null);
            if (view !== 'worldmap') onViewChange('worldmap');
          }}
          collapsed={collapsed}
          showCounts={showCounts}
        />
        {META_ITEMS.map(({ id, labelKey, icon }) => (
          <SidebarItem
            key={id}
            id={id}
            label={t(labelKey)}
            icon={icon}
            panelActive={isPanelOpen(id)}
            count={counts[id]}
            onClick={() => handlePanelItem(id)}
            collapsed={collapsed}
            showCounts={showCounts}
          />
        ))}
      </nav>

      {/* Spacer */}
      <div className="sidebar-spacer" />

      <div className="sidebar-divider" />

      {/* Footer */}
      <nav className="sidebar-nav sidebar-footer-nav">
        {FOOTER_ITEMS_TOP.map(({ id, labelKey, icon }) => (
          <SidebarItem
            key={id}
            id={id}
            label={t(labelKey)}
            icon={icon}
            active={id !== 'stats' && isFooterActive(id)}
            panelActive={id === 'stats' && secondaryPanel === 'stats'}
            onClick={() => handleFooterItem(id)}
            collapsed={collapsed}
            showCounts={showCounts}
          />
        ))}
        {/* Messages — between Settings and Trash */}
        <button
          className={`sidebar-item ${view === 'system-messages' ? 'active' : ''}`}
          onClick={() => {
            if (view === 'system-messages') return;
            onSecondaryPanel(null);
            onViewChange('system-messages');
          }}
          title={collapsed ? t('sidebar.messages') : undefined}
        >
          <span className="sidebar-bell-wrap">
            <Bell size={15} strokeWidth={1.8} />
            {unreadNotifications > 0 && (
              <span className="sidebar-bell-badge">{unreadNotifications}</span>
            )}
          </span>
          {!collapsed && <span className="sidebar-item-label">{t('sidebar.messages')}</span>}
        </button>
        {FOOTER_ITEMS_BOTTOM.map(({ id, labelKey, icon }) => (
          <SidebarItem
            key={id}
            id={id}
            label={t(labelKey)}
            icon={icon}
            active={isFooterActive(id)}
            onClick={() => handleFooterItem(id)}
            collapsed={collapsed}
            showCounts={showCounts}
          />
        ))}
      </nav>
    </aside>
  );
}
