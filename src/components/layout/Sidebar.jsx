import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import CollectionAvatar from '../common/CollectionAvatar';
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
} from 'lucide-react';

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
  const pinnedCollections = (() => {
    const pinned = (collections ?? []).filter((g) => g.sidebar_pin);
    if (pinnedOrder.length === 0) return pinned.slice(0, 30);
    const ordered = pinnedOrder.map((id) => pinned.find((g) => g.id === id)).filter(Boolean);
    const rest = pinned.filter((g) => !pinnedOrder.includes(g.id));
    return [...ordered, ...rest].slice(0, 30);
  })();
  // A library filter is only "active" on the plain library view — not when a
  // collection or folder scope is in effect (those highlight their own items).
  const isLibraryActive = (id) =>
    filter === id && !activeCollection && !activeFolder && view === 'library';
  const [pinCtx, setPinCtx] = useState(null); // { id, x, y }

  const isPanelOpen = (id) => secondaryPanel === id;

  // Highlight the collection/folder panel button that owns the active scope,
  // even when its secondary panel is collapsed.
  const activeCollectionKind = collections?.find((g) => g.id === activeCollection)?.kind;
  const isPanelScoped = (id) => {
    if (view !== 'library') return false;
    if (id === 'folders') return !!activeFolder;
    if (id === 'albums') return activeCollectionKind === 'album';
    if (id === 'playlists') return activeCollectionKind === 'playlist';
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

  const SidebarItem = ({ label, icon: Icon, active, panelActive, onClick, count }) => (
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
          />
        ))}
      </nav>

      {/* Pinned collections */}
      {pinnedCollections.length > 0 && (
        <>
          <div className="sidebar-divider" />
          <nav
            className={`sidebar-nav sidebar-pinned-nav ${pinnedCollections.length > 5 ? 'sidebar-pinned-scrollable' : ''}`}
          >
            {pinnedCollections.map((g) => {
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
                  title={collapsed ? g.name : t('panel.unpin')}
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
            })}
          </nav>
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

      <div className="sidebar-divider" />

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
          />
        ))}
      </nav>
    </aside>
  );
}
