import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import {
  Search,
  X,
  LayoutGrid,
  List,
  Filter,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  CornerDownLeft,
  Minus,
  Plus,
  Camera,
  Grid2x2,
  Bell,
  ScanSearch,
  Keyboard,
  CalendarDays,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import Sidebar from './components/layout/Sidebar';
import SecondaryPanel from './components/layout/SecondaryPanel';
import MediaGrid from './components/views/MediaGrid';
import DetailPanel from './components/layout/DetailPanel';
import CollectionBanner from './components/layout/CollectionBanner';
import AlbumGroupView from './components/views/AlbumGroupView';
import FileViewer from './components/views/FileViewer';
import ContextMenu from './components/common/ContextMenu';
import SelectionBar from './components/common/SelectionBar';
import MassTagModal from './components/modals/MassTagModal';
import BatchRenameModal from './components/modals/BatchRenameModal';
import RenameFileModal from './components/modals/RenameFileModal';
import ConfirmModal from './components/modals/ConfirmModal';
import DownloadModal from './components/modals/DownloadModal';
import UploadServerModal from './components/modals/UploadServerModal';
import ImportMenu from './components/common/ImportMenu';
import SettingsPage from './components/pages/SettingsPage';
import AudioPlayer from './components/common/AudioPlayer';
import KeyboardHelpModal from './components/modals/KeyboardHelpModal';
import ExportModal from './components/modals/ExportModal';
import FilterBar, { applyAllFilters, hasActiveFilterFields } from './components/common/FilterBar';
import SearchScopeMenu, { DEFAULT_SEARCH_SCOPE } from './components/common/SearchScopeMenu';
import SavedSearchesMenu from './components/common/SavedSearchesMenu';
import WorldMapView from './components/views/WorldMapView';
import MusicView from './components/views/MusicView';
import CommandPalette from './components/common/CommandPalette';
import DuplicatesModal from './components/modals/DuplicatesModal';
import TrashView from './components/views/TrashView';
import AiIndexProgress from './components/common/AiIndexProgress';
import DownloadProgress from './components/common/DownloadProgress';
import GoogleTakeoutModal from './components/modals/GoogleTakeoutModal';
import ICloudImportModal from './components/modals/ICloudImportModal';
import TagsView from './components/pages/TagsView';
import CompareView from './components/views/CompareView';
import ImportCollectionModal from './components/modals/ImportCollectionModal';
import ImportConfirmModal from './components/modals/ImportConfirmModal';
import ScreensaverOverlay from './components/common/ScreensaverOverlay';
import NotificationsPanel from './components/common/NotificationsPanel';
import WelcomeFlow from './components/pages/WelcomeFlow';
import ImageEditorPage from './components/pages/ImageEditorPage';
import ImagePickerModal from './components/modals/ImagePickerModal';
import useNotifications from './hooks/useNotifications';
import useNavHistory from './hooks/useNavHistory';
import useSync from './hooks/useSync';
import useMediaLibrary from './hooks/useMediaLibrary';
import useMultiSelect from './hooks/useMultiSelect';
import useFolders from './hooks/useFolders';
import useImport from './hooks/useImport';
import useCollectionDrag from './hooks/useCollectionDrag';
import CollectionDragGhost from './components/common/CollectionDragGhost';
import ToastStack from './components/common/ToastStack';
import useMultilingual from './hooks/useMultilingual';
import useTheme from './hooks/useTheme';
import { useTabCompletion } from './hooks/useTabCompletion';
import useToasts from './hooks/useToasts';
import usePersistentState, {
  boolDefaultTrue,
  boolDefaultFalse,
  jsonParse,
} from './hooks/usePersistentState';
import { sortItems } from './utils/sort';
import { switchWorkspaceAndApply } from './utils/workspace';
import { folderIdOf } from './utils/folders';
import SortDropdown from './components/common/SortDropdown';
import ResultsBar from './components/common/ResultsBar';
import SystemMessagesPage from './components/pages/SystemMessagesPage';
import SystemLogPage from './components/pages/SystemLogPage';
import './App.css';

// The "no filters applied" shape — shared by the initial state, the clear
// action, and navigation resets so the filter icon never lingers highlighted.
const EMPTY_FILTERS = {
  colorLabel: [],
  dateRange: null,
  exactDay: null,
  dateFrom: null,
  dateTo: null,
  tags: [],
  mediaType: [],
  extension: [],
  starred: false,
  hasGps: false,
  hasText: false,
  orientation: null,
  fileSize: null,
  resolution: [],
  collection: false,
  cameras: [],
};

export default function App() {
  const { t } = useTranslation();
  const { allItems, setAllItems, selected, setSelected, reload: reloadMedia } = useMediaLibrary();
  const [collections, setCollections] = useState([]);
  const [filter, setFilter] = useState(() => {
    const home = localStorage.getItem('vivid-home-page') || 'all';
    if (['all', 'starred', 'image', 'video', 'audio'].includes(home)) return home;
    return 'all';
  });
  const [activeTag, setActiveTag] = useState(null);
  const [activeCollection, setActiveCollection] = useState(null);
  const [search, setSearch] = useState('');
  // Which fields keyword search checks (name/tags/description/OCR) — all on
  // by default, narrowed via the toggle menu next to the search bar.
  const [searchScope, setSearchScope] = usePersistentState(
    'vivid-search-scope',
    DEFAULT_SEARCH_SCOPE,
    jsonParse(DEFAULT_SEARCH_SCOPE),
    JSON.stringify,
  );
  // Named search text + search-scope + filter-bar snapshots the user can
  // re-apply later — distinct from searchHistory below, which auto-records
  // recent plain-text queries rather than a deliberately named bookmark.
  const [savedSearches, setSavedSearches] = usePersistentState(
    'vivid-saved-searches',
    [],
    jsonParse([]),
    JSON.stringify,
  );
  const [sortBy, setSortBy] = useState('date-desc');
  // Manual sort + drag-reorder is only offered on playlist pages.
  const activeCollectionObj = collections.find((g) => g.id === activeCollection);
  const isPlaylistView = activeCollectionObj?.kind === 'playlist';
  // Album groups hold other albums, not media items — their page shows a
  // grid of child albums instead of the normal media grid/toolbar.
  const isAlbumGroupView = activeCollectionObj?.kind === 'album_group';
  useEffect(() => {
    if (!isPlaylistView && sortBy === 'manual') setSortBy('date-desc');
  }, [isPlaylistView, sortBy]);
  const [viewerItem, setViewerItem] = useState(null); // file viewer page
  // Survives MediaGrid unmount/remount (e.g. opening/closing the file viewer)
  // so the library grid comes back scrolled to where the user left it.
  const libraryScrollState = useRef(null);
  const handleLibraryScrollStateChange = useCallback((s) => {
    libraryScrollState.current = s;
  }, []);
  const [viewerDetails, setViewerDetails] = useState(false); // side-by-side detail panel in the viewer
  const [editorItem, setEditorItem] = useState(null); // image editor page
  const editorRef = useRef(null); // imperative handle to prompt on nav-away
  const [viewerCacheKey, setViewerCacheKey] = useState(0);
  // Map of item.id -> fresh full-resolution blob URL after an in-place edit.
  // One blob per item is reused across the grid, detail panel, and viewer so
  // every surface shows the identical image (bypasses the WKWebView asset
  // cache, which ignores ?v= query params for the asset:// protocol).
  const [freshUrls, setFreshUrls] = useState({});
  const [screensaverItems, setScreensaverItems] = useState(null); // screensaver mode items
  const [playerItem, setPlayerItem] = useState(null); // bottom audio player
  // Bumped on every explicit "play" action (card click, play-all, shuffle)
  // so AudioPlayer restarts from the beginning even when it's asked to play
  // the track that's already loaded — item identity alone doesn't change in
  // that case, so this is what actually signals "start over".
  const [playToken, setPlayToken] = useState(0);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, item }
  const [mapFocusId, setMapFocusId] = useState(null); // item to center the World Map on
  // Scopes FileViewer's nav (prev/next + filmstrip) to a map pin/cluster
  // instead of the full library — set by handleCardOpen, cleared by passing
  // navItems=null (the default for every other caller).
  const [mapViewerItems, setMapViewerItems] = useState(null);
  // World Map's pan/zoom and selected pin, lifted up here because
  // WorldMapView unmounts while FileViewer is open (it's one branch of the
  // same view-switch ternary), so its own internal state can't survive a
  // round trip through the viewer.
  const [mapViewState, setMapViewState] = useState(null);
  const [mapSelectedId, setMapSelectedId] = useState(null);
  // Restricts the World Map to a specific set of items (e.g. "View on Map"
  // from an album) instead of the whole library — null means no restriction.
  // Reset to null by default on every handleViewChange call, so navigating
  // to the map any other way (sidebar, etc.) always goes back to the full
  // library.
  const [mapScopeItems, setMapScopeItems] = useState(null);
  const [view, setView] = useState(() => {
    const home = localStorage.getItem('vivid-home-page') || 'all';
    // Folders is a panel (file tree) rather than a page — open it via
    // secondaryPanel below and keep the main view on the library.
    if (home === 'albums') return 'albums';
    if (home === 'music') return 'music';
    return 'library';
  });
  const [confirm, setConfirm] = useState(null);
  const [showDownload, setShowDownload] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showCloudSync, setShowCloudSync] = useState(false);
  const [showICloud, setShowICloud] = useState(false);
  const [showMassTag, setShowMassTag] = useState(false);
  const [showBatchRename, setShowBatchRename] = useState(false);
  const [renameFileTargets, setRenameFileTargets] = useState(null); // items whose on-disk filename is being renamed
  const [showHelp, setShowHelp] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showCmdPalette, setShowCmdPalette] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [scanningDupes, setScanningDupes] = useState(false);
  const [duplicateCollections, setDuplicateCollections] = useState([]);
  const [audioCoverTarget, setAudioCoverTarget] = useState(null); // audio item whose cover is being chosen
  const [collectionCoverTarget, setCollectionCoverTarget] = useState(null); // collection whose cover is being chosen
  const [trashRetentionDays, setTrashRetentionDays] = usePersistentState(
    'vivid-trash-retention',
    30,
    Number,
  );
  const [watchedFolders, setWatchedFolders] = usePersistentState(
    'vivid-watched-folders',
    [],
    jsonParse([]),
    JSON.stringify,
  );

  // Transient top toasts (import results, duplicate-name errors, …); see
  // hooks/useToasts. Distinct from the determinate progress bars (ongoing work)
  // and the bell/messages page (persistent background failures).
  const { toasts, showToast, dismissToast } = useToasts();

  // On-disk folder tree domain (state + CRUD); see hooks/useFolders.
  const {
    folders,
    setFolders,
    activeFolder,
    setActiveFolder,
    folderCounts,
    folderScope,
    createFolder: handleCreateFolder,
    renameFolder: handleRenameFolder,
    deleteFolder: handleDeleteFolder,
    moveFolder: handleMoveFolder,
  } = useFolders({ allItems, reloadMedia, showToast, setConfirm, t });

  // Media acquisition domain (pick/download/screenshot/drag-drop); see hooks/useImport.
  const {
    pendingImportPaths,
    setPendingImportPaths,
    importProgress,
    loading,
    isDragging,
    handleImport,
    handleImportFolder,
    handleImportPaths,
    doImport,
    handleScreenshot,
  } = useImport({ setAllItems, setConfirm, t, showToast });
  // Pending import awaiting final confirmation: { params, preview }. Set when the
  // dry-run preview turns up something noteworthy (skips or new folders).
  const [importConfirm, setImportConfirm] = useState(null);

  // Create the chosen new top-level folder (if any), then start the import.
  const proceedImport = useCallback(
    async ({ paths, collectionId, folderId, newFolderName, filename }) => {
      let destFolder = folderId;
      if (newFolderName) {
        try {
          const f = await invoke('create_folder', { name: newFolderName, parentId: null });
          setFolders((prev) => [...prev, f]);
          destFolder = f.id;
        } catch (e) {
          if (String(e).includes('DUPLICATE_NAME'))
            showToast('error', t('notif.duplicateFolder', { name: newFolderName }));
        }
      }
      await doImport(paths, collectionId ?? null, destFolder ?? null, filename ?? null);
    },
    [doImport, setFolders, showToast, t],
  );

  // After the destination is chosen, dry-run the import. Only interrupt with a
  // confirmation when something will be skipped or new folders created;
  // otherwise import straight away.
  const requestImport = useCallback(
    async (params) => {
      try {
        const preview = await invoke('preview_import', {
          paths: params.paths,
          folderId: params.folderId ?? null,
        });
        const noteworthy =
          preview.skipped_type > 0 || preview.skipped_dupe > 0 || preview.new_folders.length > 0;
        if (noteworthy) {
          setImportConfirm({ params, preview });
          return;
        }
      } catch (e) {
        console.error('Import preview failed:', e); // non-fatal — fall through to import
      }
      proceedImport(params);
    },
    [proceedImport],
  );
  const [viewModeMap, setViewModeMap] = useState({
    all: 'masonry',
    starred: 'masonry',
    image: 'masonry',
    video: 'grid',
    audio: 'grid',
    playlist: 'list',
  });
  // Playlists get their own view-mode slot ('playlist') so the choice doesn't
  // bleed into the shared 'all' library page (a playlist sets filter='all').
  const viewKey = isPlaylistView ? 'playlist' : filter;
  const rawViewMode = viewModeMap[viewKey] ?? 'masonry';
  // Map old 'timeline' value to 'grid' — timeline is now a separate toggle.
  const viewMode = rawViewMode === 'timeline' ? 'grid' : rawViewMode;
  const setViewMode = (mode) => setViewModeMap((m) => ({ ...m, [viewKey]: mode }));
  // false | 'desc' (newest first) | 'asc' (oldest first)
  const [timelineGrouping, setTimelineGrouping] = usePersistentState(
    'vivid-timeline-grouping',
    false,
    (v) => {
      const s = JSON.parse(v);
      return s === 'desc' || s === 'asc' ? s : false;
    },
    JSON.stringify,
  );
  const cycleTimeline = () =>
    setTimelineGrouping((v) => (v === false ? 'desc' : v === 'desc' ? 'asc' : false));
  const [gridZoom, setGridZoom] = usePersistentState('vivid-grid-zoom', 160, Number);
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const {
    notifications,
    unreadCount,
    showNotifications,
    setShowNotifications,
    push: pushNotification,
    markRead: markNotificationsRead,
    removeOne: removeOneNotification,
    clear: clearNotifications,
  } = useNotifications();
  const {
    config: syncConfig,
    status: syncStatus,
    save: saveSyncConfig,
    remirror: remirrorSync,
  } = useSync(pushNotification);
  const {
    installed: multilingualInstalled,
    loaded: multilingualLoaded,
    loading: multilingualLoading,
    toggle: toggleMultilingual,
    download: downloadMultilingual,
  } = useMultilingual();
  const [semanticMode, setSemanticMode] = useState(false);
  const [semanticResults, setSemanticResults] = useState(null);
  const [semanticSearching, setSemanticSearching] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [moodFilter, setMoodFilter] = useState(null);
  const [similarTo, setSimilarTo] = useState(null);
  const [moods, setMoods] = useState([]);
  // General settings
  const [homePage, setHomePage] = usePersistentState('vivid-home-page', 'all');
  const [showMoodBar, setShowMoodBar] = usePersistentState(
    'vivid-show-mood-bar',
    true,
    boolDefaultTrue,
  );
  usePersistentState('vivid-mood-bar-collapsed', false, boolDefaultFalse);
  const [showSidebarCounts, setShowSidebarCounts] = usePersistentState(
    'vivid-sidebar-counts',
    true,
    boolDefaultTrue,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentState(
    'vivid-sidebar-collapsed',
    true,
    boolDefaultTrue,
  );
  const [secondaryPanel, setSecondaryPanel] = useState(() =>
    localStorage.getItem('vivid-home-page') === 'folders' ? 'folders' : null,
  ); // null | 'folders' | 'albums' | 'playlists' | 'tags' | 'stats'

  const searchInputRef = useRef(null);
  useTabCompletion(searchInputRef);

  // Search history
  const [searchHistoryEnabled, setSearchHistoryEnabled] = usePersistentState(
    'vivid-search-history-enabled',
    true,
    boolDefaultFalse,
  );
  const [searchHistory, setSearchHistory] = usePersistentState(
    'vivid-search-history',
    [],
    (raw) => {
      try {
        return JSON.parse(raw).slice(0, 5);
      } catch {
        return [];
      }
    },
    JSON.stringify,
  );
  const [searchFocused, setSearchFocused] = useState(false);

  // Multi-select
  const { checkedIds, setCheckedIds, isSelecting, toggleCheck, checkRange, clearChecked } =
    useMultiSelect();

  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();

  // First-run onboarding: shown until the user finishes or skips it once.
  const [showWelcome, setShowWelcome] = useState(
    () => localStorage.getItem('vivid-onboarded') !== 'true',
  );
  const finishWelcome = useCallback(() => {
    localStorage.setItem('vivid-onboarded', 'true');
    setShowWelcome(false);
  }, []);
  // Manual trigger for testing / re-running the tour: window.__vividShowWelcome()
  useEffect(() => {
    window.__vividShowWelcome = () => setShowWelcome(true);
    return () => {
      delete window.__vividShowWelcome;
    };
  }, []);

  // Workspace picker while already running (e.g. from the macOS menu's
  // "Switch Workspace…") — see the `menu-switch-workspace` listener below,
  // which populates this. The *startup* check (shown before anything is
  // loaded at all) now happens earlier, in `WorkspaceGate` — by the time
  // `App` mounts, some workspace is always already loaded.
  // Which Settings tab to land on next time it opens — used by the
  // "Switch Workspace…" menu item to jump straight to the workspace list
  // when there's nothing to pick between yet (see the effect below).
  const [settingsInitialTab, setSettingsInitialTab] = useState(null);

  // Intercept all external link clicks — open in system browser, not in-app
  useEffect(() => {
    const handler = (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        e.preventDefault();
        invoke('open_in_browser', { url: href }).catch(console.error);
      }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  useEffect(() => {
    invoke('get_all_media')
      .then((items) => {
        setAllItems(items);
        // After the initial load, re-scan GPS for any image items missing coordinates.
        invoke('rescan_gps')
          .then((updated) => {
            if (updated.length > 0) {
              setAllItems((prev) => {
                const map = new Map(updated.map((i) => [i.id, i]));
                return prev.map((i) => map.get(i.id) ?? i);
              });
            }
          })
          .catch(console.error);
      })
      .catch(console.error);
    invoke('get_collections').then(setCollections).catch(console.error);

    // Scan watched folders for new files. Imported items arrive via the
    // `import-batch` event (handled in useImport), so this is fire-and-forget.
    const watched = JSON.parse(localStorage.getItem('vivid-watched-folders') ?? '[]');
    if (watched.length > 0) {
      invoke('import_paths', { paths: watched, silent: true }).catch(console.error);
    }

    // Auto-purge old trash on startup
    const retentionDays = Number(localStorage.getItem('vivid-trash-retention') ?? '30');
    if (retentionDays > 0) {
      invoke('purge_old_trash', { days: retentionDays }).catch(console.error);
    }

    // Backfill missing grid thumbnails in the background (one-time per library).
    invoke('generate_thumbnails_all').catch(console.error);

    // Same backfill for OCR text-scan coverage — otherwise images imported
    // via bulk import (drag-drop, watched folders) never get scanned unless
    // the user manually clicks "Scan for text" in Settings.
    invoke('run_ocr_all').catch(console.error);
  }, []);

  // mood names are static — load them immediately, no model needed
  useEffect(() => {
    invoke('get_mood_names')
      .then(setMoods)
      .catch(() => {});
  }, []);

  // ── Window focus state → CSS class on body ─────────────────────────────────
  useEffect(() => {
    let unlisten;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        document.body.classList.toggle('window-unfocused', !focused);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  // ── Single-item mutations ─────────────────────────────────────────────────

  const handleSave = useCallback(
    async ({
      id,
      display_name,
      description,
      tags,
      audio_artist,
      audio_album,
      audio_title,
      audio_year,
      audio_track,
    }) => {
      const updated = await invoke('update_media', {
        id,
        displayName: display_name,
        description,
        tags,
      });
      if (audio_artist !== undefined) {
        const audioUpdated = await invoke('update_audio_meta', {
          id,
          artist: audio_artist ?? null,
          album: audio_album ?? null,
          title: audio_title ?? null,
          year: audio_year ?? null,
          track: audio_track ?? null,
        });
        setAllItems((prev) => prev.map((it) => (it.id === id ? audioUpdated : it)));
        setSelected(audioUpdated);
      } else {
        setAllItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
        setSelected(updated);
      }
    },
    [],
  );

  // Open the in-app image picker for this audio item (Vivid manages photos, so
  // pick a cover from the library rather than the system file dialog).
  const handleSetAudioCover = useCallback((item) => setAudioCoverTarget(item), []);

  const handleRemoveAudioCover = useCallback(async (item) => {
    try {
      const updated = await invoke('set_audio_cover', { id: item.id, coverPath: null });
      setAllItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)));
      setSelected((prev) => (prev?.id === item.id ? updated : prev));
    } catch (e) {
      console.error('Remove cover failed:', e);
    }
  }, []);

  // Apply a chosen cover path to the pending audio item, then close the picker.
  const applyAudioCover = useCallback(
    async (coverPath) => {
      const target = audioCoverTarget;
      setAudioCoverTarget(null);
      if (!target || !coverPath) return;
      try {
        const updated = await invoke('set_audio_cover', { id: target.id, coverPath });
        setAllItems((prev) => prev.map((it) => (it.id === target.id ? updated : it)));
        setSelected((prev) => (prev?.id === target.id ? updated : prev));
      } catch (e) {
        console.error('Set cover failed:', e);
      }
    },
    [audioCoverTarget],
  );

  // Fallback: pick an image file from outside the library via the system dialog.
  const browseAudioCoverFile = useCallback(async () => {
    const picked = await open({
      title: 'Select Cover Image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
      multiple: false,
    });
    if (picked) await applyAudioCover(typeof picked === 'string' ? picked : picked[0]);
  }, [applyAudioCover]);

  const editorFromViewer = useRef(false);

  const handleEditImage = useCallback(
    (item) => {
      editorFromViewer.current = !!viewerItem;
      setViewerItem(null);
      setEditorItem(item);
    },
    [viewerItem],
  );

  const handleExitEditor = useCallback((item) => {
    setEditorItem(null);
    if (editorFromViewer.current) setViewerItem(item);
    editorFromViewer.current = false;
  }, []);

  // If the editor is open and has unsaved changes, ask before navigating away.
  // `action` is the navigation to perform after Save or Discard.
  // Also closes the file viewer on any navigation.
  const guardedNav = useCallback((action) => {
    const nav = () => {
      setViewerItem(null);
      setViewerDetails(false);
      action();
    };
    if (editorRef.current) {
      editorRef.current.tryExit(nav);
    } else {
      nav();
    }
  }, []);

  const handleItemSaved = useCallback((blobUrl, itemId) => {
    setViewerCacheKey(Date.now());
    if (itemId && blobUrl) {
      setFreshUrls((prev) => {
        // Revoke the previous blob for this item (e.g. re-edit) to avoid leaks.
        if (prev[itemId]) URL.revokeObjectURL(prev[itemId]);
        return { ...prev, [itemId]: blobUrl };
      });
    }
  }, []);

  // An in-place edit repointed the file (HEIC re-encoded to JPEG): the id is
  // unchanged but file_path/display_name moved. Update every surface holding
  // the item so they follow it to the new path.
  const handleItemUpdated = useCallback((updated) => {
    setAllItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    setEditorItem((prev) => (prev?.id === updated.id ? updated : prev));
    setViewerItem((prev) => (prev?.id === updated.id ? updated : prev));
    setSelected((prev) => (prev?.id === updated.id ? updated : prev));
  }, []);

  const handleStarToggle = useCallback(async (id) => {
    const updated = await invoke('toggle_star', { id });
    setAllItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
    setSelected((prev) => (prev?.id === id ? updated : prev));
    setViewerItem((prev) => (prev?.id === id ? updated : prev));
  }, []);

  const handleRemoveAutoTag = useCallback(async (id, tag) => {
    const updated = await invoke('remove_auto_tag', { id, tag });
    setAllItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
    setSelected((prev) => (prev?.id === id ? updated : prev));
    setViewerItem((prev) => (prev?.id === id ? updated : prev));
  }, []);

  const handleRetagImage = useCallback(async (id) => {
    const updated = await invoke('embed_and_tag_image', { id });
    setAllItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
    setSelected((prev) => (prev?.id === id ? updated : prev));
    setViewerItem((prev) => (prev?.id === id ? updated : prev));
    return updated;
  }, []);

  // Toggles a single collection's membership for one item — `isMember` tells
  // it which way to flip. An item can belong to any number of collections at
  // once, so this only ever touches the one collection being clicked.
  const handleSetCollection = useCallback(async (id, collectionId, isMember) => {
    const updated = await invoke(isMember ? 'remove_from_collection' : 'add_to_collection', {
      id,
      collectionId,
    });
    setAllItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
    setSelected((prev) => (prev?.id === id ? updated : prev));
    setViewerItem((prev) => (prev?.id === id ? updated : prev));
  }, []);

  const handleRemove = useCallback(
    (id) => {
      setContextMenu(null);
      setConfirm({
        title: t('trash.moveTitle'),
        message: t('trash.moveMsg'),
        confirmLabel: t('trash.moveConfirmBtn'),
        onConfirm: async () => {
          await invoke('trash_media', { id });
          setAllItems((prev) => prev.filter((it) => it.id !== id));
          setSelected((prev) => (prev?.id === id ? null : prev));
          setViewerItem((prev) => (prev?.id === id ? null : prev));
          setCheckedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          setConfirm(null);
        },
      });
    },
    [t],
  );

  // ── Multi-select mutations ────────────────────────────────────────────────

  const handleMassDelete = useCallback(() => {
    const ids = [...checkedIds];
    setConfirm({
      title: t('trash.moveManyTitle', { count: ids.length }),
      message: t('trash.moveManyMsg', { count: ids.length }),
      confirmLabel: t('trash.moveConfirmBtn'),
      onConfirm: async () => {
        await Promise.all(ids.map((id) => invoke('trash_media', { id })));
        setAllItems((prev) => prev.filter((it) => !checkedIds.has(it.id)));
        clearChecked();
        setConfirm(null);
      },
    });
  }, [checkedIds, clearChecked, t]);

  const handleMassTag = useCallback(
    async (tagsToAdd) => {
      const ids = [...checkedIds];
      const updated = await Promise.all(
        ids.map(async (id) => {
          const item = allItems.find((it) => it.id === id);
          if (!item) return null;
          const merged = [...new Set([...(item.tags || []), ...tagsToAdd])];
          return invoke('update_media', {
            id,
            displayName: item.display_name,
            description: item.description,
            tags: merged,
          });
        }),
      );
      setAllItems((prev) => {
        const map = Object.fromEntries(updated.filter(Boolean).map((it) => [it.id, it]));
        return prev.map((it) => map[it.id] ?? it);
      });
    },
    [checkedIds, allItems],
  );

  // Adds every checked item to a collection — additive, doesn't disturb
  // membership in any collection they're already in.
  const handleMassCollection = useCallback(
    async (collectionId) => {
      const ids = [...checkedIds];
      // allSettled (not all): one incompatible item must not abort the whole
      // batch mid-flight or skip applying the state update for the others
      // that already succeeded in the DB.
      const results = await Promise.allSettled(
        ids.map((id) => invoke('add_to_collection', { id, collectionId })),
      );
      const updated = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      const failed = results.filter((r) => r.status === 'rejected');
      if (updated.length > 0) {
        setAllItems((prev) => {
          const map = Object.fromEntries(updated.map((it) => [it.id, it]));
          return prev.map((it) => map[it.id] ?? it);
        });
      }
      if (failed.length > 0) {
        showToast('error', t('notif.moveToCollectionFailed', { count: failed.length }));
      }
    },
    [checkedIds, showToast, t],
  );

  const handleMassMoveFolder = useCallback(
    async (folderId) => {
      const ids = [...checkedIds];
      const moved = await invoke('move_to_folder', { itemIds: ids, folderId });
      setAllItems((prev) => {
        const map = Object.fromEntries(moved.map((it) => [it.id, it]));
        return prev.map((it) => map[it.id] ?? it);
      });
    },
    [checkedIds],
  );

  const handleMoveToFolder = useCallback(async (itemId, folderId) => {
    const moved = await invoke('move_to_folder', { itemIds: [itemId], folderId });
    setAllItems((prev) => {
      const map = Object.fromEntries(moved.map((it) => [it.id, it]));
      return prev.map((it) => map[it.id] ?? it);
    });
  }, []);

  const handleAddResultsToCollection = useCallback(async (collectionId, items) => {
    const updated = await Promise.all(
      items.map((i) => invoke('add_to_collection', { id: i.id, collectionId })),
    );
    setAllItems((prev) => {
      const map = Object.fromEntries(updated.map((it) => [it.id, it]));
      return prev.map((it) => map[it.id] ?? it);
    });
  }, []);

  // ── Drag files onto a collection or folder ────────────────────────────────
  const handleCollectionDrop = useCallback(
    async (items, { collectionId, folderId }) => {
      const ids = items.map((i) => i.id);
      // Folder drop wins when both are hit: moving files on disk is the stronger
      // intent than adding to a metadata collection.
      if (folderId) {
        const moved = await invoke('move_to_folder', { itemIds: ids, folderId });
        setAllItems((prev) => {
          const map = Object.fromEntries(moved.map((it) => [it.id, it]));
          return prev.map((it) => map[it.id] ?? it);
        });
        return;
      }
      // Album groups only organize other albums — dropping media files onto
      // one isn't a valid target, unlike a regular album/playlist row.
      if (collectionId && collections.find((g) => g.id === collectionId)?.kind !== 'album_group') {
        const updated = await Promise.all(
          ids.map((id) => invoke('add_to_collection', { id, collectionId })),
        );
        setAllItems((prev) => {
          const map = Object.fromEntries(updated.map((it) => [it.id, it]));
          return prev.map((it) => map[it.id] ?? it);
        });
      }
      // No notification: the items visibly move. The messages page is for
      // warnings/errors only, not routine success confirmations.
    },
    [setAllItems, collections],
  );

  const { drag: collectionDrag, beginCollectionDrag } = useCollectionDrag(handleCollectionDrop);

  // A drag of a selected item carries the whole selection; otherwise just itself.
  const handleCardDragStart = useCallback(
    (e, item) => {
      const ids = checkedIds.has(item.id) && checkedIds.size > 0 ? [...checkedIds] : [item.id];
      const dragItems = ids.map((id) => allItems.find((i) => i.id === id)).filter(Boolean);
      beginCollectionDrag(e, dragItems);
    },
    [checkedIds, allItems, beginCollectionDrag],
  );

  // ── Groups ────────────────────────────────────────────────────────────────

  const handleCreateCollection = useCallback(
    async (name, color, emoji, kind) => {
      try {
        const group = await invoke('create_collection', {
          name,
          color,
          emoji: emoji ?? null,
          kind: kind ?? 'album',
        });
        setCollections((prev) => [...prev, group]);
        return group;
      } catch (e) {
        if (String(e).includes('DUPLICATE_NAME')) {
          showToast('error', t('notif.duplicateCollection', { name }));
          return null;
        }
        throw e;
      }
    },
    [t, showToast],
  );

  const handleSetCollectionCover = useCallback(async (collectionId, coverItemId) => {
    const updated = await invoke('set_collection_cover', { collectionId, coverItemId });
    setCollections((prev) => prev.map((g) => (g.id === collectionId ? updated : g)));
  }, []);

  // Moves an album into an album_group (or, passing null, back out to
  // top-level) — used by the secondary panel's "Move to Group…"/"Remove from
  // Group" context menu actions.
  const handleSetCollectionParent = useCallback(
    async (id, parentId) => {
      try {
        const updated = await invoke('set_collection_parent', { id, parentId: parentId ?? null });
        setCollections((prev) => prev.map((g) => (g.id === id ? updated : g)));
        return updated;
      } catch (e) {
        showToast('error', String(e));
        return null;
      }
    },
    [showToast],
  );

  const handleSetCollectionDescription = useCallback(async (id, description) => {
    const updated = await invoke('set_collection_description', { id, description });
    setCollections((prev) => prev.map((g) => (g.id === id ? updated : g)));
  }, []);

  const handleBatchRename = useCallback(
    async (renames) => {
      const updated = await Promise.all(
        renames.map(({ id, display_name }) => {
          const item = allItems.find((i) => i.id === id);
          if (!item) return null;
          return invoke('update_media', {
            id,
            displayName: display_name,
            description: item.description,
            tags: item.tags,
          });
        }),
      );
      setAllItems((prev) => {
        const map = Object.fromEntries(updated.filter(Boolean).map((it) => [it.id, it]));
        return prev.map((it) => map[it.id] ?? it);
      });
    },
    [allItems],
  );

  // Renames the actual on-disk filename — distinct from handleBatchRename
  // above, which only touches display_name/library metadata. RenameFileModal
  // already validated the batch against conflicts before calling this, but
  // the backend re-checks per file (a race, or a file outside the DB), so
  // partial failure is a real possibility here — allSettled + toast for
  // whichever ones didn't make it, same pattern as handleMassCollection.
  const handleRenameFiles = useCallback(
    async (renames) => {
      const results = await Promise.allSettled(
        renames.map(({ id, newStem }) => invoke('rename_file', { id, newStem })),
      );
      const updated = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      const failed = results.filter((r) => r.status === 'rejected');
      if (updated.length > 0) {
        setAllItems((prev) => {
          const map = Object.fromEntries(updated.map((it) => [it.id, it]));
          return prev.map((it) => map[it.id] ?? it);
        });
      }
      if (failed.length > 0) {
        showToast(
          'error',
          failed.length === 1
            ? failed[0].reason?.toString()
            : t('notif.renameFilesFailed', { count: failed.length }),
        );
      }
    },
    [showToast, t],
  );

  const handleColorLabel = useCallback(async (id, label) => {
    const updated = await invoke('set_color_label', { id, label: label ?? null });
    setAllItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
    setSelected((prev) => (prev?.id === id ? updated : prev));
    setContextMenu(null);
  }, []);

  // ── Navigation history (back / forward like a browser) ─────────────────────
  const applyNavSnapshot = useCallback(
    (snap) => {
      setFilter(snap.filter);
      setActiveTag(snap.activeTag);
      setActiveCollection(snap.activeCollection);
      setActiveFolder(snap.activeFolder ?? null);
      setSearch(snap.search);
      setView(snap.view);
      // Snapshots don't carry advanced filters or transient overlays; clear them
      // so the filter icon and the duplicates result don't linger after back/forward.
      setFilters(EMPTY_FILTERS);
      setMoodFilter(null);
      setSemanticMode(false);
      setSemanticResults(null);
      setSimilarTo(null);
      setShowDuplicates(false);
    },
    [setActiveFolder],
  );
  const {
    canBack: navCanBack,
    canForward: navCanForward,
    push: pushNav,
    goBack,
    goForward,
  } = useNavHistory(applyNavSnapshot);

  const addToSearchHistory = useCallback(
    (term) => {
      if (!searchHistoryEnabled || !term.trim()) return;
      setSearchHistory((prev) => {
        const trimmed = term.trim();
        const filtered = prev.filter((h) => h !== trimmed);
        return [trimmed, ...filtered].slice(0, 5);
      });
    },
    [searchHistoryEnabled],
  );

  const removeFromHistory = useCallback((term) => {
    setSearchHistory((prev) => prev.filter((h) => h !== term));
  }, []);

  const handleSaveSearch = useCallback(
    (name, snapshot) => {
      if (savedSearches.some((s) => s.name === name)) {
        showToast('error', t('notif.duplicateSavedSearch', { name }));
        return;
      }
      setSavedSearches((prev) => [{ id: crypto.randomUUID(), name, ...snapshot }, ...prev]);
    },
    [savedSearches, setSavedSearches, showToast, t],
  );

  const handleApplySavedSearch = useCallback(
    (entry) => {
      setSearch(entry.search ?? '');
      setSearchScope(entry.searchScope ?? DEFAULT_SEARCH_SCOPE);
      setFilters(entry.filters ?? EMPTY_FILTERS);
      setSemanticMode(false);
      setMoodFilter(null);
      if (hasActiveFilterFields(entry.filters ?? EMPTY_FILTERS, null)) setShowFilterBar(true);
    },
    [setSearchScope, setFilters],
  );

  const handleDeleteSavedSearch = useCallback(
    (id) => {
      const entry = savedSearches.find((s) => s.id === id);
      setConfirm({
        title: t('search.saved.deleteTitle'),
        message: t('search.saved.deleteMsg', { name: entry?.name ?? '' }),
        confirmLabel: t('search.saved.deleteConfirm'),
        onConfirm: () => {
          setSavedSearches((prev) => prev.filter((s) => s.id !== id));
          setConfirm(null);
        },
      });
    },
    [savedSearches, t],
  );

  const handleSearchGo = useCallback(() => {
    if (!search.trim()) return;
    searchInputRef.current?.blur();
    setSearchFocused(false);
    // Navigate to library first when searching from a non-library view
    if (!['library', 'worldmap'].includes(view)) {
      setView('library');
      setFilter('all');
      setActiveTag(null);
      setActiveCollection(null);
    }
    if (semanticMode) {
      setSemanticSearching(true);
      invoke('semantic_search', { query: search.trim(), limit: 50 })
        .then((results) => setSemanticResults(results.map((r) => r.item)))
        .catch(console.error)
        .finally(() => setSemanticSearching(false));
    } else {
      addToSearchHistory(search);
    }
  }, [search, semanticMode, addToSearchHistory, view]);

  const handleRenameCollection = useCallback(
    async (id, newName) => {
      if (!newName?.trim()) return;
      try {
        const updated = await invoke('rename_collection', { id, name: newName.trim() });
        setCollections((prev) => prev.map((g) => (g.id === id ? updated : g)));
      } catch (e) {
        if (String(e).includes('DUPLICATE_NAME')) {
          showToast('error', t('notif.duplicateCollection', { name: newName.trim() }));
        } else {
          console.error('Rename failed:', e);
        }
      }
    },
    [t, showToast],
  );

  const handleDeleteCollection = useCallback(
    (id, name) => {
      setConfirm({
        title: t('contextMenu.deleteCollectionTitle'),
        message: t('contextMenu.deleteCollectionMsg', { name }),
        confirmLabel: t('contextMenu.deleteCollectionConfirm'),
        onConfirm: async () => {
          await invoke('delete_collection', { id });
          setCollections((prev) => prev.filter((g) => g.id !== id));
          await reloadMedia();
          if (activeCollection === id) setActiveCollection(null);
          setConfirm(null);
        },
      });
    },
    [activeCollection, t],
  );

  const [pinnedOrder, setPinnedOrder] = usePersistentState(
    'vivid-pinned-order',
    [],
    jsonParse([]),
    JSON.stringify,
  );

  const handleSidebarPin = useCallback(async (id, pin) => {
    const updated = await invoke('set_sidebar_pin', { id, pinned: pin });
    setCollections((prev) => prev.map((g) => (g.id === id ? updated : g)));
    if (!pin) setPinnedOrder((prev) => prev.filter((x) => x !== id));
  }, []);

  const handleReorderPins = useCallback(
    (orderedIds) => setPinnedOrder(orderedIds),
    [setPinnedOrder],
  );

  // ── Navigation ────────────────────────────────────────────────────────────

  const clearSearchAndFilters = useCallback(() => {
    setSearch('');
    setActiveTag(null);
    setFilters(EMPTY_FILTERS);
    setMoodFilter(null);
    setSemanticMode(false);
    setSemanticResults(null);
    setSimilarTo(null);
  }, []);

  const handleFilterChange = useCallback(
    (f) => {
      guardedNav(() => {
        setFilter(f);
        setActiveCollection(null);
        setActiveFolder(null);
        clearChecked();
        clearSearchAndFilters();
        setShowDuplicates(false);
        pushNav({
          filter: f,
          activeTag,
          activeCollection: null,
          activeFolder: null,
          search: '',
          view,
        });
      });
    },
    [activeTag, view, pushNav, clearChecked, clearSearchAndFilters, guardedNav],
  );

  const handleTagClick = useCallback(
    (tag) => {
      setActiveTag(tag);
      pushNav({ filter, activeTag: tag, activeCollection, activeFolder, search, view });
    },
    [filter, activeCollection, activeFolder, search, view, pushNav],
  );

  // Navigate to All Media and apply the tag via filters.tags (same as filter bar)
  const handleTagNavigate = useCallback(
    (tag) => {
      clearSearchAndFilters();
      setFilter('all');
      setActiveCollection(null);
      setActiveFolder(null);
      setView('library');
      setSecondaryPanel(null);
      setShowFilterBar(true);
      setFilters((prev) => ({ ...prev, tags: [tag] }));
      pushNav({
        filter: 'all',
        activeTag: null,
        activeCollection: null,
        activeFolder: null,
        search: '',
        view: 'library',
      });
    },
    [pushNav, clearSearchAndFilters, setActiveFolder],
  );

  const handleCollectionClick = useCallback(
    (id) => {
      // Already viewing this collection — no-op instead of toggling back to All Media.
      if (activeCollection === id) return;
      guardedNav(() => {
        setActiveCollection(id);
        setActiveFolder(null);
        setFilter('all');
        setActiveTag(null);
        pushNav({
          filter: 'all',
          activeTag: null,
          activeCollection: id,
          activeFolder: null,
          search,
          view,
        });
      });
    },
    [activeCollection, search, view, pushNav, guardedNav],
  );

  // Core folder-selection logic, shared by the sidebar/detail-panel entry
  // point (handleFolderClick, wrapped in guardedNav since the viewer or
  // editor may be open there) and the in-page folder breadcrumb below (never
  // rendered while the viewer/editor is open, so it can call this directly).
  const navigateToFolder = useCallback(
    (id) => {
      // Already viewing this folder — no-op instead of toggling back to All Media.
      if (activeFolder === id) return;
      setActiveFolder(id);
      setActiveCollection(null);
      setActiveTag(null);
      setFilter('all');
      setView('library');
      pushNav({
        filter: 'all',
        activeTag: null,
        activeCollection: null,
        activeFolder: id,
        search,
        view: 'library',
      });
    },
    [activeFolder, search, pushNav],
  );

  // Select an on-disk folder: filter the library to its subtree.
  const handleFolderClick = useCallback(
    (id) => guardedNav(() => navigateToFolder(id)),
    [guardedNav, navigateToFolder],
  );

  const handleViewChange = useCallback(
    (v, { mapFocusId: focusId = null, mapScope = null } = {}) => {
      guardedNav(() => {
        setView(v);
        setActiveFolder(null);
        clearChecked();
        clearSearchAndFilters();
        setShowDuplicates(false);
        setMapFocusId(focusId);
        setMapScopeItems(mapScope);
        pushNav({ filter, activeTag, activeCollection, activeFolder: null, search: '', view: v });
      });
    },
    [
      filter,
      activeTag,
      activeCollection,
      view,
      pushNav,
      clearChecked,
      clearSearchAndFilters,
      guardedNav,
    ],
  );

  // macOS menu bar: Workspace > Switch Workspace > <one item per workspace>.
  // The native submenu (rebuilt on the Rust side whenever the registry
  // changes — see `rebuild_workspace_menu` in lib.rs) already shows every
  // choice, so picking one here is a deliberate, specific action — no
  // confirmation dialog, no intermediate picker UI, just switch.
  useEffect(() => {
    let unlisten;
    listen('menu-switch-to-workspace', async (event) => {
      const id = event.payload;
      try {
        const { relaunched } = await switchWorkspaceAndApply(id);
        if (!relaunched) {
          showToast('info', t('settings.workspace.devRestartNeeded'));
        }
      } catch (e) {
        showToast('error', String(e));
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [showToast, t]);

  // macOS menu bar: Workspace > New Workspace…. The actual "pick a folder"
  // flow lives in Settings (WorkspaceSection), so this just navigates there
  // rather than duplicating it at the top level.
  useEffect(() => {
    let unlisten;
    listen('menu-add-workspace', () => {
      setSettingsInitialTab('library');
      handleViewChange('settings');
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [handleViewChange]);

  // The active external workspace's folder disappeared while Vivid was
  // running (removed, renamed, or the drive it's on was unmounted) — the
  // live watcher and a periodic health check both feed this. Nothing in the
  // running process can recover cleanly (the DB connection, thumbnails, and
  // in-memory index all point at that folder), so the only way back to a
  // consistent state is a relaunch: `resolve_startup_workspace` then falls
  // back to the Default workspace exactly as it would for any other
  // unreachable external folder.
  useEffect(() => {
    let unlisten;
    listen('workspace-unavailable', (event) => {
      const name = event.payload?.name ?? '';
      setConfirm({
        title: t('workspacePicker.unavailableTitle'),
        message: t('workspacePicker.unavailableDesc', { name }),
        confirmLabel: t('workspacePicker.unavailableConfirm'),
        onConfirm: async () => {
          setConfirm(null);
          await relaunch();
        },
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [t]);

  // "View on Map" from the detail panel — jumps to the World Map centered on
  // this specific item instead of the usual fit-to-all-pins behavior.
  const handleViewOnMap = useCallback(
    (item) => {
      setViewerItem(null);
      setViewerDetails(false);
      setMapViewerItems(null);
      setMapSelectedId(null);
      setSelected(null);
      handleViewChange('worldmap', { mapFocusId: item.id });
    },
    [handleViewChange],
  );

  // "View on Map" from an album's title bar — restricts the World Map to
  // just that album's images instead of the whole library. Geotagging is
  // per-item, so an album can have zero geotagged images even with photos
  // in it; that's not a nav-worthy error, just a toast.
  const handleViewAlbumOnMap = useCallback(
    (albumImages) => {
      const hasGeo = albumImages.some((i) => i.gps_lat != null && i.gps_lng != null);
      if (!hasGeo) {
        showToast('error', t('notif.noGeotaggedInAlbum'));
        return;
      }
      setMapViewerItems(null);
      setMapSelectedId(null);
      setSelected(null);
      handleViewChange('worldmap', { mapScope: albumImages });
    },
    [handleViewChange, showToast, t],
  );

  const handleSetLocation = useCallback(async (id, lat, lng) => {
    const updated = await invoke('set_media_location', { id, lat, lng });
    setAllItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
    setSelected((prev) => (prev?.id === id ? updated : prev));
    setViewerItem((prev) => (prev?.id === id ? updated : prev));
  }, []);

  // `navItems` scopes FileViewer's prev/next navigation to something other
  // than the default `visible` set — e.g. the World Map passes just the
  // cluster that was clicked, so navigating away from a map pin doesn't leak
  // into the full library. null means "use the default scope".
  const handleCardOpen = useCallback(
    (item, navItems = null) => {
      if (isSelecting) return;
      if (item.media_type === 'audio') {
        // Single-track click — no playlist mode, no auto-advance
        setPlayerPlaylist(false);
        setPlayerExplicitQueue(null);
        setPlayerItem(item);
        setPlayToken((v) => v + 1);
      } else {
        setMapViewerItems(navItems);
        setViewerItem(item);
      }
    },
    [isSelecting],
  );

  const handlePlayAsAudio = useCallback((item) => {
    setPlayerPlaylist(false);
    setPlayerExplicitQueue(null);
    setPlayerItem(item);
    setPlayToken((v) => v + 1);
  }, []);

  // Play a collection of tracks as a playlist (enables auto-advance controls)
  const handlePlayAll = useCallback((tracks, name = null) => {
    if (!tracks || tracks.length === 0) return;
    setPlayerExplicitQueue(tracks);
    setPlayerPlaylist(true);
    setPlayerPlaylistName(typeof name === 'string' ? name : null);
    setPlayerItem(tracks[0]);
    setPlayToken((v) => v + 1);
  }, []);

  const [playerPlaylist, setPlayerPlaylist] = useState(false);
  const [playerPlaylistName, setPlayerPlaylistName] = useState(null);
  const [playerExplicitQueue, setPlayerExplicitQueue] = useState(null);
  const [playerLoop, setPlayerLoop] = useState('none'); // 'none' | 'all' | 'one'
  const handleCardDetails = useCallback(
    (item) => {
      if (!isSelecting) setSelected((prev) => (prev?.id === item.id ? null : item));
    },
    [isSelecting],
  );

  const handleCardContextMenu = useCallback((e, item) => {
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, []);

  // Side-by-side compare. If the right-clicked image is part of a 2-image
  // selection, pre-fill both panes; otherwise open with it on the left and let
  // the user pick the second.
  const [compare, setCompare] = useState(null); // { left, right } | null
  const handleCompare = useCallback(
    (item) => {
      const checkedImgs = allItems.filter((i) => checkedIds.has(i.id) && i.media_type === 'image');
      if (checkedIds.has(item.id) && checkedImgs.length === 2) {
        setCompare({ left: checkedImgs[0], right: checkedImgs[1] });
      } else {
        setCompare({ left: item, right: null });
      }
    },
    [allItems, checkedIds],
  );

  // A captured video frame: add to the library, same as a screenshot — no
  // navigation, it just appears in the grid.
  const handleFrameSaved = useCallback(
    (item) => {
      setAllItems((prev) => [item, ...prev]);
      showToast('success', t('viewer.frameSaved'));
    },
    [setAllItems, showToast, t],
  );

  // Called when a transform creates a copy — add to library and navigate to it
  const handleNewItem = useCallback(async (item, dest = null) => {
    setAllItems((prev) => [item, ...prev]);
    setViewerItem(item);
    if (!dest) return;
    try {
      let updated = item;
      if (dest.folderId) {
        const [moved] = await invoke('move_to_folder', {
          itemIds: [item.id],
          folderId: dest.folderId,
        });
        if (moved) updated = moved;
      } else if (dest.newFolderName) {
        const folder = await invoke('create_folder', { name: dest.newFolderName });
        if (folder) {
          const [moved] = await invoke('move_to_folder', {
            itemIds: [item.id],
            folderId: folder.id,
          });
          if (moved) updated = moved;
        }
      }
      if (dest.collectionId) {
        updated = await invoke('add_to_collection', {
          id: updated.id,
          collectionId: dest.collectionId,
        });
      }
      setAllItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setViewerItem(updated);
    } catch (e) {
      console.error('Failed to assign copy to folder/collection:', e);
    }
  }, []);

  const handleShare = useCallback((filePaths) => {
    invoke('share_files', { filePaths }).catch(console.error);
  }, []);

  const handleFindDuplicates = useCallback(async (scope = 'all') => {
    setScanningDupes(true);
    try {
      const dupes = await invoke('find_duplicates');
      const scoped =
        scope === 'all'
          ? dupes
          : dupes.map((g) => g.filter((i) => i.media_type === scope)).filter((g) => g.length > 1);
      setDuplicateCollections(scoped);
      setShowDuplicates(true);
    } catch (e) {
      console.error(e);
    } finally {
      setScanningDupes(false);
    }
  }, []);

  const handleFindSimilar = useCallback((item) => {
    invoke('find_similar', { itemId: item.id, limit: 60 })
      .then((results) => {
        setSimilarTo({ item, results: results.map((r) => r.item) });
        setFilter('all');
        setView('library');
        setActiveCollection(null);
      })
      .catch(console.error);
  }, []);

  const handleMoodFilter = useCallback(
    (mood) => {
      if (moodFilter?.mood === mood) {
        setMoodFilter(null);
        return;
      }
      invoke('mood_filter', { mood, limit: 200 })
        .then((results) => setMoodFilter({ mood, results: results.map((r) => r.item) }))
        .catch(console.error);
    },
    [moodFilter],
  );

  // Calendar day click: filter to that exact day in library view
  // ── Derived data ──────────────────────────────────────────────────────────

  const topTags = useMemo(() => {
    const counts = {};
    allItems.forEach((it) =>
      (it.tags || []).forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
      }),
    );
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }));
  }, [allItems]);

  const itemCounts = useMemo(() => {
    // Single pass over allItems — avoids 6 separate filter() calls
    let starred = 0,
      image = 0,
      video = 0,
      audio = 0;
    const tagSet = new Set();
    for (const i of allItems) {
      if (i.starred) starred++;
      if (i.media_type === 'image') image++;
      else if (i.media_type === 'video') video++;
      else if (i.media_type === 'audio') audio++;
      if (i.tags) for (const t of i.tags) tagSet.add(t);
    }
    let folders = 0,
      albums = 0,
      playlists = 0;
    for (const g of collections) {
      if (g.kind === 'album') albums++;
      else if (g.kind === 'playlist') playlists++;
      else folders++;
    }
    return {
      all: allItems.length,
      starred,
      image,
      video,
      audio,
      folders,
      albums,
      playlists,
      music: playlists,
      tags: tagSet.size,
    };
  }, [allItems, collections]);

  // Debounce search so the filter pipeline doesn't run on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const visible = useMemo(() => {
    // Precompute loop-invariant bits once, then filter in a single pass instead
    // of chaining ~10 .filter() calls (each of which allocated a new array).
    const q = debouncedSearch.trim().toLowerCase();
    const grp = activeCollection ? collections.find((g) => g.id === activeCollection) : null;
    const albumScope = grp?.kind === 'album';
    const isSemantic = semanticMode && semanticResults !== null;

    // AI modes (semantic search / find-similar / vibe) supply results already
    // ranked by the model — use that as the pool instead of allItems, but
    // still apply every other active filter so they narrow down the ranked
    // results instead of being ignored.
    const pool = isSemantic
      ? semanticResults
      : similarTo
        ? similarTo.results
        : moodFilter
          ? moodFilter.results
          : allItems;
    let items = pool.filter((i) => {
      // Base (sidebar) filter
      if (filter === 'starred') {
        if (!i.starred) return false;
      } else if (filter !== 'all' && i.media_type !== filter) return false;

      // Folder filter (a folder and its descendants)
      if (folderScope && !folderScope.has(folderIdOf(i))) return false;

      // Group / album filter
      if (activeCollection) {
        if (!i.collection_ids?.includes(activeCollection)) return false;
        if (albumScope && i.media_type !== 'image' && i.media_type !== 'video') return false;
      }

      // Tag sidebar filter
      if (activeTag && !(i.tags?.includes(activeTag) || i.auto_tags?.includes(activeTag)))
        return false;

      // Text search (debounced) — skipped in semantic mode, where the same
      // search box is the AI query rather than a literal substring match.
      // Each field only participates when its toggle in searchScope is on.
      if (
        !isSemantic &&
        q &&
        !(
          (searchScope.name &&
            (i.display_name.toLowerCase().includes(q) || i.file_name.toLowerCase().includes(q))) ||
          (searchScope.description && i.description?.toLowerCase().includes(q)) ||
          (searchScope.ocr && i.ocr_text?.toLowerCase().includes(q)) ||
          (searchScope.tags &&
            (i.tags?.some((t) => t.includes(q)) || i.auto_tags?.some((t) => t.includes(q))))
        )
      )
        return false;

      return true;
    });

    // Remaining predicates (exactDay/tags/mediaType/extension/starred/hasGps/
    // hasText/collection/cameras, plus applyFilters' colorLabel/dateRange/
    // orientation/fileSize) — shared with the world map view's own filter bar.
    items = applyAllFilters(items, filters);

    // Preserve similarity/vibe/semantic ranking; sorting would destroy the score order
    if (isSemantic || similarTo || moodFilter) return items;
    return sortItems(items, sortBy);
  }, [
    allItems,
    filter,
    activeCollection,
    activeTag,
    debouncedSearch,
    searchScope,
    sortBy,
    filters,
    semanticMode,
    semanticResults,
    moodFilter,
    similarTo,
    collections,
    folderScope,
  ]);

  // World Map's own item pool: shares the top-bar FilterBar/`filters` state
  // with the library view, but skips the library-only scoping (sidebar
  // type/folder/collection/tag, search, AI ranking modes) — the map always
  // shows every geotagged item that passes the filter bar, regardless of
  // which folder/collection/search the library happens to be on. Restricted
  // to mapScopeItems instead of the whole library when set (e.g. "View on
  // Map" from an album) — filters still apply on top of that scope.
  const mapVisible = useMemo(
    () => applyAllFilters(mapScopeItems ?? allItems, filters),
    [mapScopeItems, allItems, filters],
  );

  // Opening an image from inside an album gets a filmstrip of the album's
  // other images (image-only, matching the album's own scope) instead of the
  // full mixed-media `visible` set FileViewer otherwise navigates through.
  // Opening from the World Map gets the same filmstrip treatment, scoped to
  // just the pin/cluster that was clicked (mapViewerItems).
  const isAlbumImageView = !!activeCollection && viewerItem?.media_type === 'image';
  const viewerItems = isAlbumImageView
    ? visible.filter((i) => i.media_type === 'image')
    : (mapViewerItems ?? visible);
  const viewerFilmstrip = isAlbumImageView || !!mapViewerItems;

  // Freeze the current (filtered + sorted) order as the playlist's manual order:
  // persist each item's sort_order, then switch the sort to manual so it sticks.
  const handleSaveManualOrder = useCallback(() => {
    const ordered = visible;
    setConfirm({
      title: t('sort.saveAsManualTitle'),
      message: t('sort.saveAsManualMsg'),
      confirmLabel: t('sort.saveAsManualConfirm'),
      onConfirm: async () => {
        await Promise.all(
          ordered.map((it, i) => invoke('update_item_order', { id: it.id, sortOrder: i })),
        );
        const orderMap = new Map(ordered.map((it, i) => [it.id, i]));
        setAllItems((prev) =>
          prev.map((it) => (orderMap.has(it.id) ? { ...it, sort_order: orderMap.get(it.id) } : it)),
        );
        setSortBy('manual');
        setConfirm(null);
      },
    });
  }, [visible, t, setAllItems]);

  // ── Global keyboard shortcuts (placed after `visible` is defined) ─────────

  useEffect(() => {
    const handler = (e) => {
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'SELECT'
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCmdPalette((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && isSelecting) {
        e.preventDefault();
        setCheckedIds(new Set(visible.map((i) => i.id)));
        return;
      }
      if (e.key === '?') {
        setShowHelp(true);
        return;
      }
      if (!viewerItem && !playerItem) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const idx = visible.findIndex((i) => i.id === selected?.id);
          if (e.key === 'ArrowLeft' && idx > 0) setSelected(visible[idx - 1]);
          if (e.key === 'ArrowRight' && idx < visible.length - 1) setSelected(visible[idx + 1]);
          if (idx === -1 && visible.length > 0) setSelected(visible[0]);
        }
        if (e.key === 'Enter' && selected) handleCardOpen(selected);
        if (e.key === 'Escape') setSelected(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [viewerItem, playerItem, visible, selected, handleCardOpen, isSelecting, setCheckedIds]);

  // Queue for the bottom player: explicit (playlist) queue takes priority
  const playerQueue = useMemo(() => {
    if (playerExplicitQueue) return playerExplicitQueue;
    // Videos are playable in the audio player (their audio track), so they're
    // part of the implicit queue alongside audio for next/prev.
    const audioItems = visible.filter((i) => i.media_type === 'audio' || i.media_type === 'video');
    if (playerItem && !audioItems.find((i) => i.id === playerItem.id)) {
      return [playerItem, ...audioItems];
    }
    return audioItems;
  }, [visible, playerItem, playerExplicitQueue]);

  return (
    <div className={`app ${isDragging ? 'dragging' : ''}`}>
      <CollectionDragGhost drag={collectionDrag} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} raised={!!playerItem} />
      <Sidebar
        filter={filter}
        onFilterChange={handleFilterChange}
        topTags={topTags}
        activeTag={activeTag}
        onTagClick={handleTagClick}
        counts={itemCounts}
        showCounts={showSidebarCounts}
        view={view}
        onViewChange={handleViewChange}
        secondaryPanel={secondaryPanel}
        onSecondaryPanel={setSecondaryPanel}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        activeCollection={activeCollection}
        activeFolder={activeFolder}
        collections={collections}
        allItems={allItems}
        unreadNotifications={unreadCount}
        onSidebarPin={handleSidebarPin}
        pinnedOrder={pinnedOrder}
        onCollectionClick={handleCollectionClick}
        onPlayPlaylist={handlePlayAll}
        dragOverId={collectionDrag?.overId}
      />

      <div className="app-right">
        <header className="toolbar" data-tauri-drag-region>
          {/* Back / Forward navigation — left of search bar */}
          <button
            className="icon-btn"
            onClick={() => guardedNav(goBack)}
            disabled={!navCanBack}
            title={t('toolbar.goBack')}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => guardedNav(goForward)}
            disabled={!navCanForward}
            title={t('toolbar.goForward')}
          >
            <ChevronRight size={16} />
          </button>

          <div className="search-wrap" style={{ position: 'relative' }}>
            {semanticSearching && <div className="search-progress-bar" />}
            {semanticMode ? (
              <Sparkles size={14} className="search-icon" style={{ color: 'var(--accent)' }} />
            ) : (
              <Search size={14} className="search-icon" />
            )}
            <input
              ref={searchInputRef}
              className={`search-input${semanticMode ? ' semantic-mode' : ''}${search ? ' has-text' : ''}`}
              placeholder={
                isAlbumGroupView
                  ? t('search.placeholderAlbums')
                  : semanticMode
                    ? t('search.aiPlaceholder')
                    : t('search.placeholder')
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.target.blur();
                  handleSearchGo();
                }
              }}
            />
            {search && (
              <button
                className="icon-btn search-clear"
                onClick={() => setSearch('')}
                title={t('toolbar.clearSearch')}
              >
                <X size={13} />
              </button>
            )}
            <button
              className="icon-btn search-submit"
              onClick={handleSearchGo}
              title={semanticMode ? t('toolbar.searchAI') : t('search.placeholder')}
              disabled={!search.trim()}
            >
              <CornerDownLeft size={13} />
            </button>
            {/* Search history dropdown */}
            {searchFocused && searchHistoryEnabled && searchHistory.length > 0 && (
              <div className="search-history-dropdown">
                {searchHistory.map((term) => (
                  <div key={term} className="search-history-item">
                    <button
                      className="search-history-term"
                      onMouseDown={() => {
                        setSearch(term);
                      }}
                    >
                      <Search size={11} />
                      {term}
                    </button>
                    <button
                      className="search-history-remove"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        removeFromHistory(term);
                      }}
                      title="Remove"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Search scope toggles — which fields keyword search checks.
              Doesn't apply to semantic search (an AI query, not a per-field
              match) or the album group page (a plain name filter over
              albums, not a per-field media search), so it's hidden then. */}
          {!semanticMode && !isAlbumGroupView && (
            <SearchScopeMenu scope={searchScope} onChange={setSearchScope} />
          )}

          {/* Semantic search toggle */}
          {multilingualLoaded && !isAlbumGroupView && (
            <button
              className={`icon-btn toolbar-ai-btn ${semanticMode ? 'active' : ''}`}
              title={semanticMode ? t('toolbar.switchToKeyword') : t('toolbar.switchToAI')}
              onClick={() => {
                setSemanticMode((v) => !v);
                setSemanticResults(null);
                setSearch('');
              }}
            >
              <Sparkles size={15} />
            </button>
          )}

          {/* Filter toggle — right of search bar, visually separated from view buttons.
              Shared as-is by the World Map view: same button, same filters state. */}
          {(view === 'library' || view === 'worldmap') && !isAlbumGroupView && (
            <button
              className={`icon-btn toolbar-view-btn ${showFilterBar || hasActiveFilterFields(filters, moodFilter) ? 'active' : ''}`}
              onClick={() => setShowFilterBar((v) => !v)}
              title={t('toolbar.filters')}
            >
              <Filter size={15} />
            </button>
          )}

          {/* Saved searches — bookmark the current search text + scope +
              filters, reachable wherever the Filter toggle is (search/filters
              only drive the library and world-map item lists). */}
          {(view === 'library' || view === 'worldmap') && !isAlbumGroupView && (
            <SavedSearchesMenu
              current={{ search, searchScope, filters }}
              hasCurrent={!!search.trim() || hasActiveFilterFields(filters, null)}
              saved={savedSearches}
              onSave={handleSaveSearch}
              onApply={handleApplySavedSearch}
              onDelete={handleDeleteSavedSearch}
            />
          )}

          {/* Separator between filter and view group */}
          <span className="toolbar-sep" />

          <div className="toolbar-actions">
            <button className="icon-btn" onClick={handleScreenshot} title={t('toolbar.screenshot')}>
              <Camera size={15} />
            </button>

            <span className="toolbar-sep" />
            <button
              className="icon-btn"
              onClick={() => setShowHelp(true)}
              title={t('toolbar.keyboardShortcuts')}
            >
              <Keyboard size={15} />
            </button>
            {loading && !importProgress && <span className="loading-dot" />}
            <button
              className={`icon-btn toolbar-bell-btn ${showNotifications ? 'active' : ''} ${notifications.some((n) => !n.read) ? 'has-unread' : ''}`}
              onClick={() => {
                setShowNotifications((v) => {
                  const next = !v;
                  if (next) markNotificationsRead();
                  return next;
                });
              }}
              title={t('toolbar.systemMessages')}
            >
              <Bell size={15} />
              {notifications.some((n) => !n.read) && (
                <span className="bell-badge">{unreadCount}</span>
              )}
            </button>
            <ImportMenu
              onImport={handleImport}
              onImportFolder={handleImportFolder}
              onDownloadURL={() => setShowDownload(true)}
              onShowReceive={() => setShowReceive(true)}
              onShowICloud={() => setShowICloud(true)}
              onShowCloudSync={() => setShowCloudSync(true)}
              disabled={loading}
            />
          </div>
        </header>

        <div className="app-body">
          {secondaryPanel && (
            <SecondaryPanel
              type={secondaryPanel}
              collections={collections}
              items={allItems}
              onCollectionClick={(id) => {
                handleCollectionClick(id);
                handleViewChange('library');
                setSecondaryPanel(null);
              }}
              onTagClick={handleTagNavigate}
              activeCollectionId={activeCollection}
              onClose={() => setSecondaryPanel(null)}
              onRenameCollection={handleRenameCollection}
              onPlayPlaylist={handlePlayAll}
              onCreateCollection={handleCreateCollection}
              onSidebarPin={handleSidebarPin}
              onDeleteCollection={handleDeleteCollection}
              onSetCollectionCover={(group) => setCollectionCoverTarget(group)}
              dragOverId={collectionDrag?.overId}
              folders={folders}
              folderCounts={folderCounts}
              activeFolderId={activeFolder}
              dragOverFolderId={collectionDrag?.overFolderId}
              onFolderClick={(id) => {
                handleFolderClick(id);
                setSecondaryPanel(null);
              }}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              onMoveFolder={handleMoveFolder}
              onSetCollectionParent={handleSetCollectionParent}
            />
          )}

          <div className="main">
            {/* Similar-to banner */}
            {similarTo && (
              <div className="similar-banner">
                <span>
                  {t('toolbar.similarTo')}{' '}
                  <strong>{similarTo.item.display_name || similarTo.item.file_name}</strong>
                </span>
                <button className="icon-btn" onClick={() => setSimilarTo(null)} title="Clear">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Import progress bar (determinate, ongoing). The result is a toast. */}
            {importProgress && (
              <div className="import-progress-bar">
                <div
                  className="import-progress-fill"
                  style={{
                    width: `${(importProgress.current / Math.max(importProgress.total, 1)) * 100}%`,
                  }}
                />
                <span className="import-progress-label">
                  {t('notif.importingN', {
                    current: importProgress.current,
                    total: importProgress.total,
                  })}
                  {importProgress.file_name && (
                    <span className="import-progress-filename"> — {importProgress.file_name}</span>
                  )}
                </span>
              </div>
            )}

            {/* Filter bar */}
            {(view === 'library' || view === 'worldmap') &&
              !isAlbumGroupView &&
              (showFilterBar || filters.exactDay || moodFilter) && (
                <FilterBar
                  filters={filters}
                  onChange={setFilters}
                  allItems={allItems}
                  moods={multilingualLoaded && showMoodBar ? moods : []}
                  moodFilter={moodFilter?.mood ?? null}
                  onMoodFilter={(mood) => {
                    if (!mood) {
                      setMoodFilter(null);
                      return;
                    }
                    handleMoodFilter(mood);
                    setSimilarTo(null);
                    setSemanticMode(false);
                    setSemanticResults(null);
                  }}
                />
              )}

            {/* Results bar — shown when search or filters narrow the visible set */}
            {view === 'library' &&
              !activeCollection &&
              visible.length > 0 &&
              (() => {
                const hasActiveSearch = search.trim().length > 0;
                const hasActiveFilters = hasActiveFilterFields(filters, moodFilter);
                if (!hasActiveSearch && !hasActiveFilters) return null;
                const hasAudio = visible.some((i) => i.media_type === 'audio');
                const hasNonAudio = visible.some((i) => i.media_type !== 'audio');
                const compatibleCollections = collections.filter((g) => {
                  if (g.kind === 'album') return !hasAudio;
                  if (g.kind === 'playlist') return !hasNonAudio;
                  if (g.kind === 'album_group') return false; // holds albums, not files
                  return true;
                });
                return (
                  <ResultsBar
                    count={visible.length}
                    compatibleCollections={compatibleCollections}
                    allItems={allItems}
                    onAddToCollection={(gid) => handleAddResultsToCollection(gid, visible)}
                  />
                );
              })()}

            {indexing && (
              <AiIndexProgress
                onReady={() => {
                  invoke('start_embed_all').catch((e) => {
                    console.error(e);
                    setIndexing(false);
                  });
                }}
                onDone={() => {
                  setIndexing(false);
                  reloadMedia().catch(console.error);
                }}
              />
            )}

            <DownloadProgress
              onDone={(count, label) => {
                reloadMedia().catch(console.error);
                invoke('list_folders').then(setFolders).catch(console.error);
                invoke('get_collections').then(setCollections).catch(console.error);
                pushNotification(
                  'info',
                  count > 1 ? `Downloaded ${count} items from "${label}"` : `Downloaded "${label}"`,
                );
              }}
              onError={(error, label) => {
                pushNotification('error', `Download failed for "${label}": ${error}`);
              }}
            />

            {/* Secondary topbar — page title for non-library views that don't have their own header */}
            {view !== 'library' &&
              !['settings', 'trash', 'system-messages', 'log-viewer', 'worldmap'].includes(
                view,
              ) && (
                <div className="secondary-topbar">
                  <span className="secondary-topbar-title">
                    {{
                      music: t('nav.music'),
                      tags: t('nav.tags'),
                      stats: t('nav.stats'),
                      folders: t('nav.folders'),
                      albums: t('nav.albums'),
                      playlists: t('nav.playlists'),
                    }[view] ?? view}
                  </span>
                </div>
              )}

            {/* Collection banner — shown instead of breadcrumb when a group is active */}
            {view === 'library' &&
              activeCollection &&
              (() => {
                const grp = collections.find((g) => g.id === activeCollection);
                if (!grp) return null;
                return (
                  <CollectionBanner
                    group={grp}
                    allItems={allItems}
                    visible={visible}
                    onPlayAll={handlePlayAll}
                    playerLoop={playerLoop}
                    onCyclePlayerLoop={() =>
                      setPlayerLoop((l) => (l === 'none' ? 'all' : l === 'all' ? 'one' : 'none'))
                    }
                    onSlideshow={setScreensaverItems}
                    onViewAlbumOnMap={handleViewAlbumOnMap}
                    onSidebarPin={handleSidebarPin}
                    onRename={handleRenameCollection}
                    onSetCover={(group) => setCollectionCoverTarget(group)}
                    onDelete={handleDeleteCollection}
                    onSetDescription={handleSetCollectionDescription}
                    onCreateChildAlbum={
                      grp.kind === 'album_group'
                        ? async (name) => {
                            const album = await handleCreateCollection(name, '', null, 'album');
                            if (album) await handleSetCollectionParent(album.id, grp.id);
                          }
                        : null
                    }
                    childAlbumCount={
                      grp.kind === 'album_group'
                        ? collections.filter((g) => g.parent_id === grp.id).length
                        : 0
                    }
                  />
                );
              })()}

            {/* Content area — detail panel is anchored here so it doesn't cover toolbar/audio player */}
            <div className="content-area">
              {compare ? (
                <CompareView
                  left={compare.left}
                  right={compare.right}
                  allItems={allItems}
                  onClose={() => setCompare(null)}
                />
              ) : viewerItem ? (
                <div className="viewer-split">
                  <FileViewer
                    item={viewerItem}
                    items={viewerItems}
                    filmstrip={viewerFilmstrip}
                    onClose={() => {
                      setViewerItem(null);
                      setViewerDetails(false);
                      setMapViewerItems(null);
                    }}
                    onNavigate={setViewerItem}
                    onToggleDetails={() => setViewerDetails((v) => !v)}
                    detailsOpen={viewerDetails}
                    onStarToggle={handleStarToggle}
                    onNewItem={handleNewItem}
                    onItemUpdated={handleItemUpdated}
                    onFrameSaved={handleFrameSaved}
                    onRequestConfirm={setConfirm}
                    onToast={showToast}
                    onRemove={handleRemove}
                    onEditImage={handleEditImage}
                    onError={(msg) => showToast('error', msg)}
                    cacheKey={viewerCacheKey}
                    overrideSrc={freshUrls[viewerItem.id] || null}
                  />
                  {viewerDetails && (
                    <DetailPanel
                      item={viewerItem}
                      collections={collections}
                      folders={folders}
                      allItems={allItems}
                      onClose={() => setViewerDetails(false)}
                      onSave={handleSave}
                      onStarToggle={handleStarToggle}
                      onSetCollection={handleSetCollection}
                      onRemoveAutoTag={handleRemoveAutoTag}
                      onRetagImage={handleRetagImage}
                      onNavigateToFolder={(id) => {
                        setViewerItem(null);
                        setViewerDetails(false);
                        handleFolderClick(id);
                      }}
                      onOpenCollection={(id) => {
                        setViewerItem(null);
                        setViewerDetails(false);
                        handleCollectionClick(id);
                      }}
                      onViewOnMap={handleViewOnMap}
                      onSetLocation={handleSetLocation}
                      freshSrc={freshUrls[viewerItem.id] || null}
                    />
                  )}
                </div>
              ) : view === 'settings' ? (
                <SettingsPage
                  initialTab={settingsInitialTab}
                  theme={theme}
                  onThemeChange={setTheme}
                  colorTheme={colorTheme}
                  onColorThemeChange={setColorTheme}
                  searchHistoryEnabled={searchHistoryEnabled}
                  onSearchHistoryToggle={setSearchHistoryEnabled}
                  watchedFolders={watchedFolders}
                  onWatchedFoldersChange={setWatchedFolders}
                  onFindDuplicates={handleFindDuplicates}
                  scanningDupes={scanningDupes}
                  trashRetentionDays={trashRetentionDays}
                  onTrashRetentionChange={setTrashRetentionDays}
                  multilingualInstalled={multilingualInstalled}
                  multilingualLoaded={multilingualLoaded}
                  multilingualLoading={multilingualLoading}
                  onMultilingualToggle={toggleMultilingual}
                  onDownloadMultilingual={downloadMultilingual}
                  indexing={indexing}
                  onIndexLibrary={() => setIndexing(true)}
                  homePage={homePage}
                  onHomePageChange={setHomePage}
                  showMoodBar={showMoodBar}
                  onShowMoodBarChange={setShowMoodBar}
                  showSidebarCounts={showSidebarCounts}
                  onShowSidebarCountsChange={setShowSidebarCounts}
                  syncConfig={syncConfig}
                  syncStatus={syncStatus}
                  onSaveSyncConfig={saveSyncConfig}
                  onRemirror={remirrorSync}
                  diskFolders={folders}
                  onRequestConfirm={setConfirm}
                  onViewSystemMessages={() => handleViewChange('system-messages')}
                  onViewLog={() => handleViewChange('log-viewer')}
                  onReplayWelcome={() => setShowWelcome(true)}
                  pinnedCollections={collections.filter((g) => g.sidebar_pin)}
                  pinnedOrder={pinnedOrder}
                  onReorderPins={handleReorderPins}
                  allItems={allItems}
                />
              ) : view === 'music' ? (
                <MusicView
                  onPlayTrack={(item) =>
                    item.media_type === 'video' ? handlePlayAsAudio(item) : handleCardOpen(item)
                  }
                  onPlayAll={handlePlayAll}
                  currentTrack={playerItem}
                  collections={collections}
                  allItems={allItems}
                  onCreateCollection={handleCreateCollection}
                  onUpdateItem={(updated) =>
                    setAllItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
                  }
                />
              ) : view === 'worldmap' ? (
                <WorldMapView
                  items={mapVisible}
                  onOpen={(item) => handleCardOpen(item, [item])}
                  onOpenCluster={(clItems) => handleCardOpen(clItems[0], clItems)}
                  focusItemId={mapFocusId}
                  persistedViewState={mapViewState}
                  onViewStateChange={setMapViewState}
                  persistedSelectedId={mapSelectedId}
                  onSelectedChange={setMapSelectedId}
                />
              ) : view === 'trash' ? (
                <TrashView
                  retentionDays={trashRetentionDays}
                  onItemsRestored={() => {
                    reloadMedia().catch(console.error);
                  }}
                  onItemsDeleted={() => {
                    /* items already gone from DB */
                  }}
                />
              ) : view === 'tags' ? (
                <TagsView allItems={allItems} onTagClick={handleTagNavigate} />
              ) : view === 'system-messages' ? (
                <SystemMessagesPage
                  notifications={notifications}
                  onRemoveOne={removeOneNotification}
                  onClear={clearNotifications}
                />
              ) : view === 'log-viewer' ? (
                <SystemLogPage />
              ) : editorItem ? (
                <ImageEditorPage
                  ref={editorRef}
                  item={editorItem}
                  collections={collections}
                  folders={folders}
                  allItems={allItems}
                  onExit={handleExitEditor}
                  onSaved={handleItemSaved}
                  onNewItem={handleNewItem}
                  onItemUpdated={handleItemUpdated}
                  initialSrc={freshUrls[editorItem.id] || null}
                />
              ) : view === 'library' && isAlbumGroupView ? (
                <AlbumGroupView
                  group={activeCollectionObj}
                  collections={collections}
                  allItems={allItems}
                  search={search}
                  onOpenCollection={handleCollectionClick}
                  onRenameCollection={handleRenameCollection}
                  onSetCollectionCover={(group) => setCollectionCoverTarget(group)}
                  onSidebarPin={handleSidebarPin}
                  onSetCollectionParent={handleSetCollectionParent}
                  onDeleteCollection={handleDeleteCollection}
                />
              ) : (
                <>
                  {/* Library controls — count, sort, view mode toggle, card size */}
                  <div className="library-controls">
                    {/* Page title */}
                    {!activeCollection &&
                      !activeTag &&
                      (() => {
                        if (activeFolder) {
                          const f = folders.find((x) => x.id === activeFolder);
                          if (!f) return null;
                          const segments = f.rel_path.split('/');
                          const allCrumbs = segments.map((seg, i) => {
                            const rel = segments.slice(0, i + 1).join('/');
                            const ancestor = folders.find((x) => x.rel_path === rel);
                            return { seg, id: ancestor?.id ?? null };
                          });
                          // Show at most 3 segments; collapse the middle into "…"
                          const MAX = 3;
                          const truncated = allCrumbs.length > MAX;
                          const crumbs = truncated
                            ? [allCrumbs[0], null, ...allCrumbs.slice(-(MAX - 1))]
                            : allCrumbs;
                          return (
                            <h1 className="lc-page-title lc-folder-path">
                              {crumbs.map((c, i) => (
                                <span key={i}>
                                  {i > 0 && <span className="lc-folder-path-sep">/</span>}
                                  {c === null ? (
                                    <span className="lc-folder-path-ellipsis">…</span>
                                  ) : (
                                    <button
                                      className={`lc-folder-path-seg ${i === crumbs.length - 1 ? 'lc-folder-path-seg-active' : ''}`}
                                      onClick={() => c.id && navigateToFolder(c.id)}
                                    >
                                      {c.seg}
                                    </button>
                                  )}
                                </span>
                              ))}
                            </h1>
                          );
                        }
                        const libTitles = {
                          all: t('sidebar.allMedia'),
                          starred: t('sidebar.starred'),
                          image: t('sidebar.photos'),
                          video: t('sidebar.videos'),
                          audio: t('sidebar.audio'),
                        };
                        const title = libTitles[filter];
                        return title ? <span className="lc-page-title">{title}</span> : null;
                      })()}
                    {activeTag && (
                      <button
                        className="lc-breadcrumb"
                        onClick={() => handleTagClick(null)}
                        title="Clear tag filter"
                      >
                        # {activeTag}
                        <X size={11} />
                      </button>
                    )}
                    {!activeCollection && (
                      <span className="lc-count">
                        {t('common.item', { count: visible.length })}
                      </span>
                    )}
                    <SortDropdown
                      value={sortBy}
                      onChange={setSortBy}
                      allowManual={isPlaylistView}
                      onSaveManualOrder={handleSaveManualOrder}
                    />
                    {['all', 'image', 'video', 'audio'].includes(filter) &&
                      !activeCollection &&
                      !activeTag && (
                        <button
                          className="icon-btn toolbar-dupes-btn"
                          title={t('toolbar.findDuplicates')}
                          onClick={() =>
                            handleFindDuplicates(
                              filter === 'image'
                                ? 'image'
                                : filter === 'video'
                                  ? 'video'
                                  : filter === 'audio'
                                    ? 'audio'
                                    : 'all',
                            )
                          }
                          disabled={scanningDupes}
                        >
                          <ScanSearch size={13} />
                        </button>
                      )}
                    <div className="lc-spacer" />
                    {viewMode !== 'list' && (
                      <div className="zoom-control">
                        <div className="zoom-control-inner">
                          <button
                            className="zoom-control-btn"
                            onClick={() => setGridZoom((z) => Math.max(z - 10, 110))}
                            title={t('viewMode.smaller')}
                          >
                            <Minus size={11} />
                          </button>
                          <input
                            type="range"
                            className="grid-zoom-slider"
                            min={110}
                            max={280}
                            step={10}
                            value={gridZoom}
                            onChange={(e) => setGridZoom(Number(e.target.value))}
                            title={t('viewMode.cardSize')}
                          />
                          <button
                            className="zoom-control-btn"
                            onClick={() => setGridZoom((z) => Math.min(z + 10, 280))}
                            title={t('viewMode.larger')}
                          >
                            <Plus size={11} />
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="view-mode-toggle">
                      <button
                        className={`view-mode-btn ${viewMode === 'masonry' ? 'active' : ''}`}
                        onClick={() => setViewMode('masonry')}
                        title={t('viewMode.masonryTitle')}
                      >
                        <Grid2x2 size={13} />
                        <span>{t('viewMode.masonry')}</span>
                      </button>
                      <button
                        className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
                        onClick={() => setViewMode('grid')}
                        title={t('viewMode.cardsTitle')}
                      >
                        <LayoutGrid size={13} />
                        <span>{t('viewMode.cards')}</span>
                      </button>
                      <button
                        className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
                        onClick={() => setViewMode('list')}
                        title={t('viewMode.listTitle')}
                      >
                        <List size={13} />
                        <span>{t('viewMode.list')}</span>
                      </button>
                    </div>
                    {filter !== 'audio' && viewMode !== 'list' && (
                      <button
                        className={`timeline-toggle-btn ${timelineGrouping ? 'active' : ''}`}
                        onClick={cycleTimeline}
                        title={
                          timelineGrouping === 'asc'
                            ? t('viewMode.timelineAscTitle')
                            : t('viewMode.timelineTitle')
                        }
                      >
                        <CalendarDays size={13} />
                        <span>{t('viewMode.timeline')}</span>
                        {timelineGrouping === 'desc' && (
                          <ArrowDown size={11} style={{ opacity: 0.7 }} />
                        )}
                        {timelineGrouping === 'asc' && (
                          <ArrowUp size={11} style={{ opacity: 0.7 }} />
                        )}
                      </button>
                    )}
                  </div>
                  <MediaGrid
                    items={visible}
                    isFiltered={
                      !!(search.trim() || activeTag) || hasActiveFilterFields(filters, moodFilter)
                    }
                    checkedIds={checkedIds}
                    highlightedId={selected?.id}
                    onOpen={handleCardOpen}
                    onViewDetails={handleCardDetails}
                    onContextMenu={handleCardContextMenu}
                    onStarToggle={handleStarToggle}
                    onCheckToggle={toggleCheck}
                    onCheckRange={checkRange}
                    onImport={handleImport}
                    onImportFolder={handleImportFolder}
                    onClearSearch={clearSearchAndFilters}
                    isDragging={isDragging}
                    sortBy={sortBy}
                    onSortChange={setSortBy}
                    gridZoom={gridZoom}
                    viewMode={viewMode}
                    timelineGrouping={
                      filter !== 'audio' && viewMode !== 'list' ? timelineGrouping : false
                    }
                    onReorder={(reordered) => {
                      setAllItems((prev) => {
                        const map = new Map(
                          reordered.map((item, i) => [item.id, { ...item, sort_order: i }]),
                        );
                        return prev.map((i) => map.get(i.id) ?? i);
                      });
                    }}
                    onCardDragStart={handleCardDragStart}
                    reorderable={isPlaylistView}
                    freshThumbUrls={freshUrls}
                    restoreScrollRef={libraryScrollState}
                    onScrollStateChange={handleLibraryScrollStateChange}
                  />
                </>
              )}

              {selected && !viewerItem && (
                <DetailPanel
                  item={selected}
                  collections={collections}
                  folders={folders}
                  allItems={allItems}
                  onClose={() => setSelected(null)}
                  onSave={handleSave}
                  onStarToggle={handleStarToggle}
                  onSetCollection={handleSetCollection}
                  onRemoveAutoTag={handleRemoveAutoTag}
                  onRetagImage={handleRetagImage}
                  onNavigateToFolder={handleFolderClick}
                  onOpenCollection={(id) => {
                    setSelected(null);
                    handleCollectionClick(id);
                  }}
                  onViewOnMap={handleViewOnMap}
                  onSetLocation={handleSetLocation}
                  freshSrc={selected ? freshUrls[selected.id] || null : null}
                />
              )}
            </div>

            {/* Bottom audio player */}
            {playerItem && (
              <AudioPlayer
                item={playerItem}
                playToken={playToken}
                queue={playerQueue}
                playlistMode={playerPlaylist}
                playlistName={playerPlaylistName}
                onClose={() => {
                  setPlayerItem(null);
                  setPlayerPlaylist(false);
                  setPlayerExplicitQueue(null);
                  setPlayerPlaylistName(null);
                }}
                onNavigate={setPlayerItem}
                keyboardDisabled={!!viewerItem}
                loop={playerLoop}
                onLoopChange={setPlayerLoop}
              />
            )}

            {/* Floating selection bar */}
            {isSelecting && (
              <SelectionBar
                count={checkedIds.size}
                total={visible.length}
                onSelectAll={() => setCheckedIds(new Set(visible.map((i) => i.id)))}
                onClearAll={clearChecked}
                onMassDelete={handleMassDelete}
                onMassTag={() => setShowMassTag(true)}
                onMassCollection={handleMassCollection}
                onMassMoveFolder={handleMassMoveFolder}
                onBatchRename={() => setShowBatchRename(true)}
                onRenameFiles={() =>
                  setRenameFileTargets(allItems.filter((i) => checkedIds.has(i.id)))
                }
                onExport={() => setShowExport(true)}
                collections={collections}
                folders={folders}
                allItems={allItems}
                selectedItems={allItems.filter((i) => checkedIds.has(i.id))}
                hasPlayer={!!playerItem}
              />
            )}
          </div>
          {/* .main */}
        </div>
        {/* .app-body */}
      </div>
      {/* .app-right */}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          // Look up the live item rather than rendering the snapshot taken
          // when the menu opened — otherwise toggling collection membership
          // (or starring, etc.) from the menu itself doesn't visibly update
          // until it's closed and reopened, since `allItems` changes but
          // this stored reference doesn't.
          item={allItems.find((i) => i.id === contextMenu.item.id) ?? contextMenu.item}
          onClose={() => setContextMenu(null)}
          onOpen={handleCardOpen}
          onViewDetails={setSelected}
          onStarToggle={handleStarToggle}
          onRemove={handleRemove}
          onPlayAsAudio={handlePlayAsAudio}
          onSetAudioCover={handleSetAudioCover}
          onRemoveAudioCover={handleRemoveAudioCover}
          onColorLabel={handleColorLabel}
          onEdit={handleEditImage}
          onRenameFile={(item) => setRenameFileTargets([item])}
          onShare={handleShare}
          onFindSimilar={multilingualLoaded ? handleFindSimilar : null}
          onCompare={handleCompare}
          collections={collections}
          diskFolders={folders}
          allItems={allItems}
          onSetCollection={handleSetCollection}
          onMoveToFolder={handleMoveToFolder}
          activeCollection={activeCollection}
          onSetCover={handleSetCollectionCover}
          onError={(msg) => showToast('error', msg)}
        />
      )}

      {showMassTag && (
        <MassTagModal
          count={checkedIds.size}
          allItems={allItems}
          onApply={handleMassTag}
          onClose={() => setShowMassTag(false)}
        />
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {pendingImportPaths && (
        <ImportCollectionModal
          paths={pendingImportPaths}
          collections={collections}
          folders={folders}
          allItems={allItems}
          defaultFolderId={view === 'library' ? activeFolder : null}
          defaultCollectionId={view === 'library' ? activeCollection : null}
          onClose={() => setPendingImportPaths(null)}
          onConfirm={({ folderId, newFolderName, collectionId, filename }) => {
            const paths = pendingImportPaths;
            setPendingImportPaths(null);
            requestImport({ paths, collectionId, folderId, newFolderName, filename });
          }}
        />
      )}

      {importConfirm && (
        <ImportConfirmModal
          preview={importConfirm.preview}
          onCancel={() => setImportConfirm(null)}
          onConfirm={() => {
            const { params } = importConfirm;
            setImportConfirm(null);
            proceedImport(params);
          }}
        />
      )}

      {showCloudSync && (
        <GoogleTakeoutModal
          onClose={() => setShowCloudSync(false)}
          onImportPaths={handleImportPaths}
        />
      )}

      {showICloud && (
        <ICloudImportModal onClose={() => setShowICloud(false)} onImportPaths={handleImportPaths} />
      )}

      {showDownload && (
        <DownloadModal
          onClose={() => setShowDownload(false)}
          collections={collections}
          folders={folders}
        />
      )}

      {showReceive && <UploadServerModal onClose={() => setShowReceive(false)} />}

      {showBatchRename && (
        <BatchRenameModal
          items={allItems.filter((i) => checkedIds.has(i.id))}
          onRename={handleBatchRename}
          onClose={() => setShowBatchRename(false)}
        />
      )}

      {renameFileTargets && (
        <RenameFileModal
          items={renameFileTargets}
          allItems={allItems}
          onRename={handleRenameFiles}
          onClose={() => setRenameFileTargets(null)}
        />
      )}

      {showHelp && <KeyboardHelpModal onClose={() => setShowHelp(false)} />}

      {showExport && (
        <ExportModal
          items={allItems.filter((i) => checkedIds.has(i.id))}
          onClose={() => setShowExport(false)}
        />
      )}

      <CommandPalette
        open={showCmdPalette}
        onClose={() => setShowCmdPalette(false)}
        onViewChange={handleViewChange}
        onFilterChange={handleFilterChange}
        onImport={handleImport}
        onImportFolder={handleImportFolder}
        onToggleFilterBar={() => setShowFilterBar((v) => !v)}
        onFindDuplicates={handleFindDuplicates}
        scanningDupes={scanningDupes}
        onShowHelp={() => setShowHelp(true)}
        onZoomIn={() => setGridZoom((z) => Math.min(z + 20, 280))}
        onZoomOut={() => setGridZoom((z) => Math.max(z - 20, 110))}
        onGoBack={() => guardedNav(goBack)}
        onGoForward={() => guardedNav(goForward)}
        navCanBack={navCanBack}
        navCanForward={navCanForward}
      />

      {showDuplicates && (
        <DuplicatesModal
          collections={duplicateCollections}
          onClose={() => setShowDuplicates(false)}
          onItemsRemoved={(ids) => setAllItems((prev) => prev.filter((i) => !ids.includes(i.id)))}
        />
      )}

      {audioCoverTarget && (
        <ImagePickerModal
          allItems={allItems}
          title={t('imagePicker.title', { name: audioCoverTarget.display_name })}
          currentPath={audioCoverTarget.audio_cover}
          onPick={(image) => applyAudioCover(image.file_path)}
          onClose={() => setAudioCoverTarget(null)}
          onBrowseFiles={browseAudioCoverFile}
        />
      )}

      {collectionCoverTarget && (
        <ImagePickerModal
          allItems={allItems}
          title={t('imagePicker.title', { name: collectionCoverTarget.name })}
          currentPath={
            allItems.find((i) => i.id === collectionCoverTarget.cover_item_id)?.file_path
          }
          onPick={(image) => {
            handleSetCollectionCover(collectionCoverTarget.id, image.id);
            setCollectionCoverTarget(null);
          }}
          onClose={() => setCollectionCoverTarget(null)}
        />
      )}

      {screensaverItems && (
        <ScreensaverOverlay items={screensaverItems} onClose={() => setScreensaverItems(null)} />
      )}

      {showNotifications && (
        <NotificationsPanel
          notifications={notifications}
          onClose={() => setShowNotifications(false)}
          onClear={clearNotifications}
          onViewAll={() => handleViewChange('system-messages')}
        />
      )}

      {showWelcome && (
        <WelcomeFlow
          onFinish={finishWelcome}
          theme={theme}
          onThemeChange={setTheme}
          colorTheme={colorTheme}
          onColorThemeChange={setColorTheme}
          homePage={homePage}
          onHomePageChange={setHomePage}
          multilingualInstalled={multilingualInstalled}
          multilingualLoading={multilingualLoading}
          onDownloadModel={downloadMultilingual}
        />
      )}
    </div>
  );
}
