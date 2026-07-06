import { useState, useMemo } from 'react';
import { X, FolderOpen, BookImage, Disc, Library, Search, Check, Plus, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import CollectionAvatar from '../common/CollectionAvatar';

const KIND_ICON = { album: BookImage, playlist: Disc };

function CollectionRowAvatar({ group, allItems }) {
  const Icon = KIND_ICON[group.kind] ?? Library;
  return (
    <CollectionAvatar
      group={group}
      allItems={allItems}
      size={24}
      radius={6}
      allowAny
      fallback={<Icon size={13} />}
    />
  );
}

export default function SaveCopyModal({ collections, folders, allItems, onConfirm, onClose }) {
  const { t } = useTranslation();

  const uncategorized = folders?.find((f) => f.rel_path === 'Uncategorized');
  const [folderId, setFolderId] = useState(uncategorized?.id ?? null);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderConfirmed, setNewFolderConfirmed] = useState(false);
  const [folderSearch, setFolderSearch] = useState('');
  const [collectionId, setCollectionId] = useState('none');
  const [collSearch, setCollSearch] = useState('');

  function pickFolder(id) {
    setNewFolderMode(false);
    setNewFolderConfirmed(false);
    setFolderId(id);
  }

  function openNewFolder() {
    setFolderId(null);
    setNewFolderMode(true);
    setNewFolderConfirmed(false);
  }

  function confirmNewFolder() {
    if (!newFolderName.trim()) {
      cancelNewFolder();
      return;
    }
    setNewFolderMode(false);
    setNewFolderConfirmed(true);
  }

  function cancelNewFolder() {
    setNewFolderMode(false);
    setNewFolderConfirmed(false);
    setFolderId(uncategorized?.id ?? null);
  }

  function handleConfirm() {
    onConfirm({
      folderId: newFolderMode || newFolderConfirmed ? null : folderId,
      newFolderName:
        (newFolderMode || newFolderConfirmed) && newFolderName.trim() ? newFolderName.trim() : null,
      collectionId: collectionId !== 'none' ? collectionId : null,
    });
  }

  const folderList = useMemo(
    () =>
      [...(folders ?? [])].sort((a, b) => {
        if (a.rel_path === 'Uncategorized') return -1;
        if (b.rel_path === 'Uncategorized') return 1;
        return a.rel_path.localeCompare(b.rel_path);
      }),
    [folders],
  );

  const filteredFolders = useMemo(() => {
    const q = folderSearch.trim().toLowerCase();
    return q
      ? folderList.filter(
          (f) => f.name.toLowerCase().includes(q) || f.rel_path.toLowerCase().includes(q),
        )
      : folderList;
  }, [folderList, folderSearch]);

  // Save Copy is always for images — only albums are compatible (no playlists).
  const albums = useMemo(() => collections.filter((g) => g.kind === 'album'), [collections]);
  const pinned = useMemo(
    () => collections.filter((g) => g.sidebar_pin && g.kind === 'album'),
    [collections],
  );
  const hasCollections = pinned.length + albums.length > 0;

  const collSections = useMemo(() => {
    const q = collSearch.trim().toLowerCase();
    const filter = (items) => (q ? items.filter((g) => g.name.toLowerCase().includes(q)) : items);
    return [
      {
        key: 'pinned',
        label: t('importModal.pinnedCollections'),
        showType: false,
        items: filter(pinned),
      },
      { key: 'albums', label: t('importModal.albums'), showType: false, items: filter(albums) },
    ].filter((s) => s.items.length > 0);
  }, [pinned, albums, collSearch, t]);

  const selectedFolder = newFolderConfirmed
    ? { name: newFolderName.trim(), rel_path: newFolderName.trim() }
    : folderList.find((f) => f.id === folderId);
  const selectedColl = collections.find((g) => g.id === collectionId);
  const canSave = newFolderMode
    ? newFolderName.trim().length > 0
    : newFolderConfirmed || !!folderId;

  return (
    <div className="modal-backdrop">
      <div
        className={`igm-modal ${hasCollections ? 'igm-two-pane' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="igm-header">
          <div className="igm-header-left">
            <span className="igm-title">Save as Copy</span>
            <span className="igm-subtitle">
              {selectedFolder ? `→ ${selectedFolder.rel_path}` : ''}
              {selectedColl ? ` · ${selectedColl.name}` : ''}
            </span>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="igm-panes">
          {/* Folder picker */}
          <div className="igm-pane">
            <div className="igm-pane-header">
              <span className="igm-pane-title">{t('importModal.destinationFolder')}</span>
            </div>
            {folderList.length > 6 && (
              <div className="igm-search">
                <Search size={12} />
                <input
                  className="igm-search-input"
                  placeholder={t('importModal.searchFolders')}
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                />
              </div>
            )}
            <div className="igm-list">
              {filteredFolders.map((f) => {
                const active = !newFolderMode && !newFolderConfirmed && folderId === f.id;
                const depth = (f.rel_path.match(/\//g) || []).length;
                return (
                  <button
                    key={f.id}
                    className={`igm-row ${active ? 'igm-row-active' : ''}`}
                    onClick={() => pickFolder(f.id)}
                  >
                    <div
                      className="igm-row-icon igm-row-icon-folder"
                      style={{ marginLeft: depth * 10 }}
                    >
                      <FolderOpen size={14} />
                    </div>
                    <span className="igm-row-name">{f.name}</span>
                    {active && <Check size={13} className="igm-row-check" />}
                  </button>
                );
              })}
              {filteredFolders.length === 0 && folderSearch && (
                <div className="igm-empty">{t('importModal.noFoldersMatch')}</div>
              )}
              {newFolderConfirmed ? (
                <button
                  className="igm-row igm-row-active"
                  onClick={() => {
                    setNewFolderConfirmed(false);
                    setNewFolderMode(true);
                  }}
                >
                  <div className="igm-row-icon igm-row-icon-new">
                    <Plus size={14} />
                  </div>
                  <span className="igm-row-name">{newFolderName.trim()}</span>
                  <Pencil size={11} className="igm-row-check" style={{ opacity: 0.6 }} />
                </button>
              ) : newFolderMode ? (
                <div className="igm-row igm-row-active igm-new-folder-input-row">
                  <div className="igm-row-icon igm-row-icon-new">
                    <Plus size={14} />
                  </div>
                  <input
                    className="igm-name-input"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    autoFocus
                    placeholder={t('importModal.newFolderName')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        confirmNewFolder();
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelNewFolder();
                      }
                    }}
                    onBlur={confirmNewFolder}
                  />
                </div>
              ) : (
                <button className="igm-row" onClick={openNewFolder}>
                  <div className="igm-row-icon igm-row-icon-new">
                    <Plus size={14} />
                  </div>
                  <span className="igm-row-name">{t('importModal.newFolder')}</span>
                </button>
              )}
            </div>
          </div>

          {/* Collection picker */}
          {hasCollections && (
            <div className="igm-pane igm-pane-right">
              <div className="igm-pane-header">
                <span className="igm-pane-title">
                  {t('importModal.collection')}{' '}
                  <span className="igm-pane-optional">{t('importModal.optional')}</span>
                </span>
              </div>
              {pinned.length + albums.length > 6 && (
                <div className="igm-search">
                  <Search size={12} />
                  <input
                    className="igm-search-input"
                    placeholder={t('importModal.searchCollections')}
                    value={collSearch}
                    onChange={(e) => setCollSearch(e.target.value)}
                  />
                </div>
              )}
              <div className="igm-list">
                <button
                  className={`igm-row ${collectionId === 'none' ? 'igm-row-active' : ''}`}
                  onClick={() => setCollectionId('none')}
                >
                  <div className="igm-row-icon igm-row-icon-folder">
                    <Library size={14} />
                  </div>
                  <span className="igm-row-name">{t('importModal.none')}</span>
                  {collectionId === 'none' && <Check size={13} className="igm-row-check" />}
                </button>
                {collSections.map(({ key, label, showType, items }) => (
                  <div key={key}>
                    <div className="igm-section-label">{label}</div>
                    {items.map((g) => {
                      const active = collectionId === g.id;
                      return (
                        <button
                          key={g.id}
                          className={`igm-row ${active ? 'igm-row-active' : ''}`}
                          onClick={() => setCollectionId(g.id)}
                        >
                          <CollectionRowAvatar group={g} allItems={allItems} />
                          <span className="igm-row-name">{g.name}</span>
                          {showType && (
                            <span className="igm-row-type">
                              {g.kind === 'album'
                                ? t('importModal.album')
                                : t('importModal.playlist')}
                            </span>
                          )}
                          {active && <Check size={13} className="igm-row-check" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {collSections.length === 0 && collSearch && (
                  <div className="igm-empty">{t('importModal.noCollectionsMatch')}</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="igm-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('importModal.cancel')}
          </button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={!canSave}>
            Save Copy
          </button>
        </div>
      </div>
    </div>
  );
}
