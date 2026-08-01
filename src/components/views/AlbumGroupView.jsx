import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Minus, Plus } from 'lucide-react';
import CollectionAvatar from '../common/CollectionAvatar';
import CollectionContextMenu from '../common/CollectionContextMenu';
import SortDropdown from '../common/SortDropdown';
import usePersistentState from '../../hooks/usePersistentState';
import { COLLECTION_SORT_OPTIONS } from '../../utils/sort';
import { COLLECTION_NAME_MAX_LEN } from '../../utils/limits';
import './AlbumGroupView.css';

function sortAlbums(albums, mode) {
  const list = [...albums];
  switch (mode) {
    case 'name-desc':
      return list.sort((a, b) => b.name.localeCompare(a.name));
    case 'date-desc':
      return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case 'date-asc':
      return list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    case 'name-asc':
    default:
      return list.sort((a, b) => a.name.localeCompare(b.name));
  }
}

function RenameForm({ name, onConfirm, onCancel }) {
  const [val, setVal] = useState(name);
  return (
    <form
      className="agv-rename-form"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(val);
      }}
    >
      <input
        autoFocus
        className="agv-rename-input"
        value={val}
        maxLength={COLLECTION_NAME_MAX_LEN}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => onConfirm(val)}
        onClick={(e) => e.stopPropagation()}
      />
    </form>
  );
}

/**
 * The page for an "album group" — a collection whose only purpose is to
 * organize other albums, never media items directly. Reuses the same
 * library-controls toolbar shell, SortDropdown, and zoom-control the regular
 * library/album pages use (just with a collection-appropriate sort option
 * set), and swaps the media grid for a card grid of child albums — no
 * masonry/slideshow/view-mode toggles, since there's no media here.
 */
export default function AlbumGroupView({
  group,
  collections,
  allItems,
  search = '',
  onOpenCollection,
  onRenameCollection,
  onSetCollectionCover,
  onSidebarPin,
  onSetCollectionParent,
  onDeleteCollection,
}) {
  const { t } = useTranslation();
  const [sortMode, setSortMode] = usePersistentState('vivid-album-group-sort', 'name-asc');
  const [cardSize, setCardSize] = usePersistentState('vivid-album-group-card-size', 150, Number);
  const [renamingId, setRenamingId] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);

  // The main search box searches media elsewhere, but there's no media on
  // this page — here it filters the group's own child albums by name instead.
  const q = search.trim().toLowerCase();
  const allChildren = collections.filter((g) => g.parent_id === group.id);
  const children = sortAlbums(
    q ? allChildren.filter((g) => g.name.toLowerCase().includes(q)) : allChildren,
    sortMode,
  );

  return (
    <>
      <div className="library-controls">
        <span className="lc-count">{t('collection.albumCount', { count: children.length })}</span>
        <SortDropdown value={sortMode} onChange={setSortMode} options={COLLECTION_SORT_OPTIONS} />
        <div className="lc-spacer" />
        <div className="zoom-control">
          <div className="zoom-control-inner">
            <button
              className="zoom-control-btn"
              onClick={() => setCardSize((z) => Math.max(z - 10, 110))}
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
              value={cardSize}
              onChange={(e) => setCardSize(Number(e.target.value))}
              title={t('viewMode.cardSize')}
            />
            <button
              className="zoom-control-btn"
              onClick={() => setCardSize((z) => Math.min(z + 10, 280))}
              title={t('viewMode.larger')}
            >
              <Plus size={11} />
            </button>
          </div>
        </div>
      </div>

      {children.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <FolderOpen size={48} strokeWidth={1.2} />
          </div>
          <p>{q ? t('panel.noMatches') : t('collection.emptyGroup')}</p>
        </div>
      ) : (
        <div
          className="album-group-grid"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` }}
        >
          {children.map((album) => {
            const count = allItems.filter((i) => i.collection_ids?.includes(album.id)).length;
            return (
              <div
                key={album.id}
                className="album-group-card"
                role="button"
                tabIndex={0}
                onClick={() => renamingId !== album.id && onOpenCollection(album.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renamingId !== album.id) onOpenCollection(album.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCtxMenu({ x: e.clientX, y: e.clientY, group: album });
                }}
              >
                <CollectionAvatar
                  group={album}
                  allItems={allItems}
                  size={Math.min(cardSize - 30, 160)}
                  radius={10}
                  allowAny
                  draggable={false}
                />
                {renamingId === album.id ? (
                  <RenameForm
                    name={album.name}
                    onConfirm={(val) => {
                      setRenamingId(null);
                      const trimmed = val.trim();
                      if (trimmed && trimmed !== album.name) onRenameCollection(album.id, trimmed);
                    }}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <>
                    <span className="album-group-card-name">{album.name}</span>
                    <span className="album-group-card-count">{t('common.item', { count })}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {ctxMenu && (
        <CollectionContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          target={ctxMenu.group}
          collections={collections}
          onRename={() => setRenamingId(ctxMenu.group.id)}
          onSetCover={onSetCollectionCover ? (g) => onSetCollectionCover(g) : undefined}
          onSidebarPin={onSidebarPin}
          onSetParent={onSetCollectionParent}
          onDelete={onDeleteCollection}
        />
      )}
    </>
  );
}
