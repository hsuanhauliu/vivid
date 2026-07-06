import { useState, useEffect, useRef, useMemo } from 'react';
import './CommandPalette.css';
import {
  Search,
  Library,
  Star,
  Image,
  Video,
  Music,
  Map,
  LayoutGrid,
  Settings,
  Import,
  Filter,
  Layers,
  Shuffle,
  ZoomIn,
  ZoomOut,
  ScanSearch,
  ArrowLeft,
  ArrowRight,
  X,
} from 'lucide-react';

/**
 * All static commands are defined here. Dynamic commands (per-item actions,
 * group navigation) are injected by the parent via `extraCommands`.
 */
function buildCommands({
  onViewChange,
  onFilterChange,
  onImport,
  onToggleFilterBar,
  onFindDuplicates,
  onShowHelp,
  onZoomIn,
  onZoomOut,
  onGoBack,
  onGoForward,
  navCanBack,
  navCanForward,
}) {
  return [
    // ── Navigation ──
    {
      id: 'nav-library',
      label: 'Go to Library',
      icon: Library,
      category: 'Navigate',
      action: () => onViewChange('library'),
    },
    {
      id: 'nav-worldmap',
      label: 'World Map',
      icon: Map,
      category: 'Navigate',
      action: () => onViewChange('worldmap'),
    },
    {
      id: 'nav-albums',
      label: 'Albums',
      icon: Layers,
      category: 'Navigate',
      action: () => onViewChange('albums'),
    },
    {
      id: 'nav-settings',
      label: 'Settings',
      icon: Settings,
      category: 'Navigate',
      action: () => onViewChange('settings'),
    },
    {
      id: 'nav-back',
      label: 'Go Back',
      icon: ArrowLeft,
      category: 'Navigate',
      action: onGoBack,
      disabled: !navCanBack,
    },
    {
      id: 'nav-forward',
      label: 'Go Forward',
      icon: ArrowRight,
      category: 'Navigate',
      action: onGoForward,
      disabled: !navCanForward,
    },

    // ── Library filters ──
    {
      id: 'flt-all',
      label: 'Show All Media',
      icon: Library,
      category: 'Filter',
      action: () => {
        onViewChange('library');
        onFilterChange('all');
      },
    },
    {
      id: 'flt-starred',
      label: 'Show Starred',
      icon: Star,
      category: 'Filter',
      action: () => {
        onViewChange('library');
        onFilterChange('starred');
      },
    },
    {
      id: 'flt-image',
      label: 'Show Photos',
      icon: Image,
      category: 'Filter',
      action: () => {
        onViewChange('library');
        onFilterChange('image');
      },
    },
    {
      id: 'flt-video',
      label: 'Show Videos',
      icon: Video,
      category: 'Filter',
      action: () => {
        onViewChange('library');
        onFilterChange('video');
      },
    },
    {
      id: 'flt-audio',
      label: 'Show Audio',
      icon: Music,
      category: 'Filter',
      action: () => {
        onViewChange('library');
        onFilterChange('audio');
      },
    },
    {
      id: 'flt-bar',
      label: 'Toggle Filters',
      icon: Filter,
      category: 'Filter',
      action: onToggleFilterBar,
    },

    // ── Import ──
    {
      id: 'imp-files',
      label: 'Import Files or Folder',
      icon: Import,
      category: 'Import',
      action: onImport,
    },

    // ── View ──
    {
      id: 'view-grid',
      label: 'Grid View',
      icon: LayoutGrid,
      category: 'View',
      action: () => onViewChange('library'),
    },
    {
      id: 'view-zoom-in',
      label: 'Zoom In (cards)',
      icon: ZoomIn,
      category: 'View',
      action: onZoomIn,
    },
    {
      id: 'view-zoom-out',
      label: 'Zoom Out (cards)',
      icon: ZoomOut,
      category: 'View',
      action: onZoomOut,
    },

    // ── Tools ──
    {
      id: 'tool-dupes',
      label: 'Find Duplicates',
      icon: ScanSearch,
      category: 'Tools',
      action: onFindDuplicates,
    },
    {
      id: 'tool-help',
      label: 'Keyboard Shortcuts',
      icon: Shuffle,
      category: 'Tools',
      action: onShowHelp,
    },
  ];
}

function score(cmd, query) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const label = cmd.label.toLowerCase();
  const cat = cmd.category.toLowerCase();
  if (label.startsWith(q)) return 3;
  if (label.includes(q)) return 2;
  if (cat.includes(q)) return 1;
  return 0;
}

export default function CommandPalette({ open, onClose, commands: extraCommands = [], ...props }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const allCommands = useMemo(() => [...buildCommands(props), ...extraCommands], [extraCommands]);

  const filtered = useMemo(() => {
    return allCommands
      .map((cmd) => ({ cmd, s: score(cmd, query) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s)
      .map(({ cmd }) => cmd);
  }, [allCommands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);
  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, filtered.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[cursor];
        if (cmd && !cmd.disabled) {
          cmd.action();
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, filtered, cursor, onClose]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector('.cp-item.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  // Group by category
  const grouped = [];
  let lastCat = null;
  for (const cmd of filtered) {
    if (cmd.category !== lastCat) {
      grouped.push({ type: 'header', label: cmd.category });
      lastCat = cmd.category;
    }
    grouped.push({ type: 'cmd', cmd });
  }

  let cmdIndex = -1;

  return (
    <div className="cp-backdrop" onClick={onClose}>
      <div className="cp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cp-search-row">
          <Search size={15} className="cp-search-icon" />
          <input
            ref={inputRef}
            className="cp-input"
            placeholder="Type a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="icon-btn cp-clear" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
          <kbd className="cp-esc-hint">esc</kbd>
        </div>

        <div className="cp-list" ref={listRef}>
          {grouped.length === 0 && <div className="cp-empty">No matching commands</div>}
          {grouped.map((entry, i) => {
            if (entry.type === 'header') {
              return (
                <div key={`h-${i}`} className="cp-category">
                  {entry.label}
                </div>
              );
            }
            cmdIndex++;
            const idx = cmdIndex;
            const { cmd } = entry;
            const Icon = cmd.icon;
            return (
              <button
                key={cmd.id}
                className={`cp-item ${idx === cursor ? 'active' : ''} ${cmd.disabled ? 'cp-item-disabled' : ''}`}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => {
                  if (!cmd.disabled) {
                    cmd.action();
                    onClose();
                  }
                }}
              >
                <span className="cp-item-icon">
                  <Icon size={14} />
                </span>
                <span className="cp-item-label">{cmd.label}</span>
                <span className="cp-item-cat">{cmd.category}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
