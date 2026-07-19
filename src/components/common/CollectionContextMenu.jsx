import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Image, Pin, Trash2, FolderInput, FolderMinus } from 'lucide-react';
import SimpleMenu from './SimpleMenu';
import CollectionAvatar from './CollectionAvatar';

/**
 * The full right-click menu for a collection (album/playlist/album_group)
 * row — shared by the secondary panel's album/playlist lists and the album
 * group page, so both surfaces offer the same actions instead of drifting
 * apart. Self-contained: "Move to Group…" swaps its own content to a group
 * picker rather than needing the caller to manage a second popover.
 *
 * @param {object}   target       - the collection this menu is for.
 * @param {Array}    collections  - full album/album_group list, for the pin
 *                                  cap check and the "move to group" targets.
 * @param {Function} onRename     - () => void, enters rename mode for `target`.
 * @param {Function} [onSetCover] - (target) => void; omit to hide the item.
 * @param {Function} [onSidebarPin] - (id, pinned) => void; omit to hide.
 * @param {Function} [onSetParent]  - (albumId, groupId|null) => void; omit to
 *                                    hide the move/remove-from-group actions.
 * @param {Function} [onDelete]     - (id, name) => void; omit to hide.
 */
export default function CollectionContextMenu({
  x,
  y,
  onClose,
  target,
  collections,
  onRename,
  onSetCover,
  onSidebarPin,
  onSetParent,
  onDelete,
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('main');

  if (mode === 'move') {
    const targets = collections.filter(
      (g) => g.kind === 'album_group' && g.id !== target.parent_id,
    );
    return (
      <SimpleMenu x={x} y={y} onClose={onClose}>
        {targets.length === 0 ? (
          <div className="sp-ctx-item sp-ctx-item-disabled">{t('collection.noOtherGroups')}</div>
        ) : (
          targets.map((g) => (
            <button
              key={g.id}
              className="sp-ctx-item"
              onClick={() => {
                onSetParent(target.id, g.id);
                onClose();
              }}
            >
              <CollectionAvatar group={g} allItems={[]} size={16} radius={4} />
              <span>{g.name}</span>
            </button>
          ))
        )}
      </SimpleMenu>
    );
  }

  const pinnedCount = collections.filter((x2) => x2.sidebar_pin).length;

  return (
    <SimpleMenu x={x} y={y} onClose={onClose}>
      <button
        className="sp-ctx-item"
        onClick={() => {
          onRename();
          onClose();
        }}
      >
        <Pencil size={12} />
        <span>{t('panel.rename')}</span>
      </button>
      {onSetCover && (
        <button
          className="sp-ctx-item"
          onClick={() => {
            onSetCover(target);
            onClose();
          }}
        >
          <Image size={12} />
          <span>{t('panel.setCover')}</span>
        </button>
      )}
      {onSetParent && target.kind === 'album' && (
        <>
          {collections.some((g) => g.kind === 'album_group') && (
            <button className="sp-ctx-item" onClick={() => setMode('move')}>
              <FolderInput size={12} />
              <span>{t('collection.moveToGroup')}</span>
            </button>
          )}
          {target.parent_id && (
            <button
              className="sp-ctx-item"
              onClick={() => {
                onSetParent(target.id, null);
                onClose();
              }}
            >
              <FolderMinus size={12} />
              <span>{t('collection.removeFromGroup')}</span>
            </button>
          )}
        </>
      )}
      {onSidebarPin && (
        <button
          className="sp-ctx-item"
          onClick={() => {
            if (!target.sidebar_pin && pinnedCount >= 5) {
              onClose();
              return;
            }
            onSidebarPin(target.id, !target.sidebar_pin);
            onClose();
          }}
        >
          <Pin size={12} />
          <span>{target.sidebar_pin ? t('panel.unpin') : t('panel.pin')}</span>
          {!target.sidebar_pin && pinnedCount >= 5 && (
            <span style={{ fontSize: 10, color: 'var(--fg-dim)', marginLeft: 4 }}>
              {t('panel.maxPinned')}
            </span>
          )}
        </button>
      )}
      {onDelete && (
        <>
          <div className="sp-ctx-sep" />
          <button
            className="sp-ctx-item sp-ctx-item-danger"
            onClick={() => {
              onDelete(target.id, target.name);
              onClose();
            }}
          >
            <Trash2 size={12} />
            <span>{t('panel.delete')}</span>
          </button>
        </>
      )}
    </SimpleMenu>
  );
}
