import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Trash2,
  Tag,
  Pencil,
  Download,
  FolderInput,
  FolderTree,
  Search,
  BookImage,
  Disc,
} from 'lucide-react';
import CollectionAvatar from './CollectionAvatar';
import useDismiss from '../../hooks/useDismiss';
import './SelectionBar.css';

const VISIBLE_LIMIT = 6;

// "Move to Collection" menu: collections collections by type (albums / playlists),
// shows real cover thumbnails, and reveals a search box when there are many.
function MoveToCollectionMenu({ collections, allItems, onMassCollection }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), { enabled: open });
  useEffect(() => {
    if (!open) {
      setExpanded(false);
      setSearch('');
    }
  }, [open]);

  function pick(value) {
    onMassCollection(value);
    setOpen(false);
  }

  const albums = useMemo(() => collections.filter((g) => g.kind === 'album'), [collections]);
  const playlists = useMemo(() => collections.filter((g) => g.kind === 'playlist'), [collections]);

  const q = search.trim().toLowerCase();
  const showAll = expanded || q.length > 0;
  const match = (g) => !q || g.name.toLowerCase().includes(q);

  // Build a flat list with type headers; cap the collapsed view.
  const sections = [
    { key: 'album', label: t('selection.albums'), icon: BookImage, items: albums.filter(match) },
    {
      key: 'playlist',
      label: t('selection.playlists'),
      icon: Disc,
      items: playlists.filter(match),
    },
  ].filter((s) => s.items.length > 0);

  const totalReal = albums.length + playlists.length;
  const hasMore = !showAll && totalReal > VISIBLE_LIMIT;

  // When collapsed, limit how many rows render across all sections.
  let budget = showAll ? Infinity : VISIBLE_LIMIT;

  return (
    <div className="sel-collection-menu" ref={ref}>
      <button
        className="btn btn-secondary selection-action"
        onClick={() => setOpen((v) => !v)}
        title={t('selection.moveToCollection')}
      >
        <FolderInput size={16} />
      </button>
      {open && (
        <div className="sel-collection-pop">
          {showAll && (
            <div className="sel-collection-search">
              <Search size={12} />
              <input
                autoFocus
                className="sel-collection-search-input"
                placeholder={t('selection.searchCollections')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
          <div className="sel-collection-list">
            <button
              className="sel-collection-item sel-collection-none"
              onClick={() => pick('__none__')}
            >
              <X size={12} /> {t('selection.noCollection')}
            </button>
            {sections.map(({ key, label, icon: Icon, items }) => {
              const rows = items.slice(0, budget);
              budget -= rows.length;
              if (rows.length === 0) return null;
              return (
                <div key={key}>
                  <div className="sel-collection-header">
                    <Icon size={11} /> {label}
                  </div>
                  {rows.map((g) => (
                    <button key={g.id} className="sel-collection-item" onClick={() => pick(g.id)}>
                      <CollectionAvatar
                        group={g}
                        allItems={allItems}
                        size={22}
                        radius={5}
                        allowAny
                      />
                      <span className="sel-collection-name">{g.name}</span>
                    </button>
                  ))}
                </div>
              );
            })}
            {sections.length === 0 && (
              <div className="sel-collection-empty">
                {q ? t('selection.noMatches') : t('selection.noCollections')}
              </div>
            )}
          </div>
          {hasMore && (
            <button className="sel-collection-more" onClick={() => setExpanded(true)}>
              <Search size={11} /> {t('selection.findMore', { count: totalReal - VISIBLE_LIMIT })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// "Move to Folder" menu: on-disk destination folders, indented by depth,
// Uncategorized first, with a search box for large trees.
function MoveToFolderMenu({ folders, onMassMoveFolder }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), { enabled: open });
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const sorted = useMemo(
    () =>
      [...folders].sort((a, b) => {
        if (a.rel_path === 'Uncategorized') return -1;
        if (b.rel_path === 'Uncategorized') return 1;
        return a.rel_path.localeCompare(b.rel_path);
      }),
    [folders],
  );

  const q = search.trim().toLowerCase();
  const shown = q ? sorted.filter((f) => f.name.toLowerCase().includes(q)) : sorted;
  const showSearch = folders.length > VISIBLE_LIMIT;

  function pick(id) {
    onMassMoveFolder(id);
    setOpen(false);
  }

  return (
    <div className="sel-collection-menu" ref={ref}>
      <button
        className="btn btn-secondary selection-action"
        onClick={() => setOpen((v) => !v)}
        title={t('selection.moveToFolder')}
      >
        <FolderTree size={16} />
      </button>
      {open && (
        <div className="sel-collection-pop">
          {showSearch && (
            <div className="sel-collection-search">
              <Search size={12} />
              <input
                autoFocus
                className="sel-collection-search-input"
                placeholder={t('selection.searchFolders')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
          <div className="sel-collection-list">
            {shown.map((f) => {
              const depth = (f.rel_path.match(/\//g) || []).length;
              return (
                <button key={f.id} className="sel-collection-item" onClick={() => pick(f.id)}>
                  <span className="sel-folder-avatar" style={{ marginLeft: depth * 12 }}>
                    <FolderInput size={13} />
                  </span>
                  <span className="sel-collection-name">{f.name}</span>
                </button>
              );
            })}
            {shown.length === 0 && (
              <div className="sel-collection-empty">{t('selection.noFolders')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SelectionBar({
  count,
  total,
  onSelectAll,
  onClearAll,
  onMassDelete,
  onMassTag,
  onMassCollection,
  onMassMoveFolder,
  onBatchRename,
  onExport,
  collections,
  folders,
  allItems,
  hasPlayer,
}) {
  const { t } = useTranslation();
  return (
    <div className="selection-bar" style={hasPlayer ? { bottom: 'calc(65px + 16px)' } : undefined}>
      <div className="selection-bar-left">
        <button
          className="icon-btn selection-close"
          onClick={onClearAll}
          title={t('selection.clearSelection')}
        >
          <X size={15} />
        </button>
        <span className="selection-count">{t('selection.selected', { count })}</span>
        {count < total && (
          <button className="selection-link" onClick={onSelectAll}>
            {t('selection.selectAll', { count: total })}
          </button>
        )}
      </div>

      <div className="selection-bar-actions">
        <button className="btn btn-secondary selection-action" onClick={onExport} title={t('selection.export')}>
          <Download size={16} />
        </button>
        <button
          className="btn btn-secondary selection-action"
          onClick={onBatchRename}
          title={t('selection.rename')}
        >
          <Pencil size={16} />
        </button>
        <button
          className="btn btn-secondary selection-action"
          onClick={onMassTag}
          title={t('selection.addTags')}
        >
          <Tag size={16} />
        </button>
        <MoveToCollectionMenu
          collections={collections}
          allItems={allItems}
          onMassCollection={onMassCollection}
        />
        {folders?.length > 0 && onMassMoveFolder && (
          <MoveToFolderMenu folders={folders} onMassMoveFolder={onMassMoveFolder} />
        )}
        <button
          className="btn btn-danger selection-action"
          onClick={onMassDelete}
          title={t('selection.deleteCount', { count })}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
