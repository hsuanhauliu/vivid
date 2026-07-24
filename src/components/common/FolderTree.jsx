import { useMemo, useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import SimpleMenu from './SimpleMenu';
import { COLLECTION_NAME_MAX_LEN } from '../../utils/limits';
import { UNCATEGORIZED_ID } from '../../utils/folders';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronsDown,
  Plus,
  Pencil,
  Trash2,
  X,
  Search,
  FolderInput,
  ExternalLink,
  ArrowDownAZ,
  ArrowUpAZ,
} from 'lucide-react';

function RenameInline({ name, onConfirm, onCancel }) {
  const ref = useRef(null);
  const [val, setVal] = useState(name);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
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
        ref={ref}
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

/** Flat list of folders to pick a move destination, excluding the folder and its subtree. */
function MovePicker({ folders, sourceFolderId, sourceRelPath, onConfirm, onCancel }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const candidates = useMemo(() => {
    const prefix = sourceRelPath + '/';
    return (
      folders
        // The virtual Uncategorized bucket isn't a real nesting target — the
        // "Root level" row above already covers moving a folder there.
        .filter(
          (f) =>
            f.id !== sourceFolderId && f.id !== UNCATEGORIZED_ID && !f.rel_path.startsWith(prefix),
        )
        .sort((a, b) => a.rel_path.localeCompare(b.rel_path))
    );
  }, [folders, sourceFolderId, sourceRelPath]);

  const filtered = query.trim()
    ? candidates.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()))
    : candidates;

  return (
    <div className="ft-move-picker" onClick={(e) => e.stopPropagation()}>
      <div className="ft-move-picker-header">
        <span>{t('panel.moveFolder', 'Move folder to…')}</span>
        <button className="icon-btn" onClick={onCancel}>
          <X size={13} />
        </button>
      </div>
      <div className="ft-move-picker-search">
        <Search size={11} />
        <input
          ref={inputRef}
          className="ft-move-picker-input"
          placeholder={t('panel.searchFolders', 'Search folders…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="ft-move-picker-list">
        <button className="ft-move-picker-row" onClick={() => onConfirm(null)}>
          <Folder size={13} />
          <span>{t('panel.rootLevel', 'Root level')}</span>
        </button>
        {filtered.map((f) => (
          <button key={f.id} className="ft-move-picker-row" onClick={() => onConfirm(f.id)}>
            <Folder size={13} />
            <span>{f.rel_path.replace(/\//g, ' / ')}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="ft-move-picker-empty">
            {t('panel.noFolderResults', 'No folders found')}
          </div>
        )}
      </div>
    </div>
  );
}

/** Build a parent→children map. */
function buildTree(folders) {
  const children = new Map();
  for (const f of folders) {
    const key = f.parent_id || '__root__';
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(f);
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return children;
}

export default function FolderTree({
  folders,
  counts,
  activeFolderId,
  dragOverFolderId,
  onFolderClick,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(() => new Set());
  const [ctxMenu, setCtxMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [creatingParent, setCreatingParent] = useState(undefined);
  const [newName, setNewName] = useState('');
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState(() => localStorage.getItem('vivid-ft-sort') || 'az');
  const [movingFolder, setMovingFolder] = useState(null); // folder being moved
  const newRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('vivid-ft-sort', sortMode);
  }, [sortMode]);

  const tree = useMemo(() => buildTree(folders), [folders]);

  const matchSet = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const matched = new Set();
    for (const f of folders) {
      if (f.name.toLowerCase().includes(q)) {
        matched.add(f.id);
        const segs = f.rel_path.split('/');
        for (let i = 1; i < segs.length; i++) {
          const rel = segs.slice(0, i).join('/');
          const anc = folders.find((x) => x.rel_path === rel);
          if (anc) matched.add(anc.id);
        }
      }
    }
    return matched;
  }, [query, folders]);

  useEffect(() => {
    if (creatingParent !== undefined) setTimeout(() => newRef.current?.focus(), 30);
  }, [creatingParent]);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function submitCreate() {
    const n = newName.trim();
    if (n) onCreateFolder(n, creatingParent ?? null);
    setCreatingParent(undefined);
    setNewName('');
  }

  function handleShowInFinder(folder) {
    setCtxMenu(null);
    invoke('reveal_folder_in_finder', { id: folder.id }).catch(console.error);
  }

  function collectDescendantIds(id, acc) {
    for (const k of tree.get(id) || []) {
      acc.add(k.id);
      collectDescendantIds(k.id, acc);
    }
    return acc;
  }

  function handleExpandAll(folder) {
    setExpanded((prev) => collectDescendantIds(folder.id, new Set(prev).add(folder.id)));
    setCtxMenu(null);
  }

  function handleMoveConfirm(newParentId) {
    setMovingFolder(null);
    if (onMoveFolder) onMoveFolder(movingFolder.id, newParentId);
  }

  const nameCmp = (a, b) => {
    if (a.id === UNCATEGORIZED_ID) return -1;
    if (b.id === UNCATEGORIZED_ID) return 1;
    return sortMode === 'za' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
  };

  function kidsOf(id) {
    return (tree.get(id) || []).filter((k) => !matchSet || matchSet.has(k.id));
  }

  function renderNode(folder, depth, isLast) {
    // VS Code-style "compact folders": fold a run of folders that each have
    // no items of their own and exactly one child folder into a single row
    // showing the whole segment path, instead of a long single-child
    // staircase that eventually pushes the count off the edge of the panel.
    // Disabled while searching so every match still gets its own row.
    const chain = [folder];
    if (!matchSet) {
      let terminal = folder;
      while ((counts[terminal.id] || 0) === 0) {
        const only = kidsOf(terminal.id);
        if (only.length !== 1) break;
        terminal = only[0];
        chain.push(terminal);
      }
    }
    const terminal = chain[chain.length - 1];
    const kids = kidsOf(terminal.id).sort(nameCmp);
    const isOpen = matchSet ? matchSet.has(terminal.id) : expanded.has(terminal.id);
    const isRowActive = chain.some((f) => f.id === activeFolderId);
    const isDragOver = terminal.id === dragOverFolderId;
    const parentGuideX = 20 + (depth - 1) * 14;
    return (
      <div key={folder.id} className="ft-node">
        {depth > 0 && (
          <>
            <div className="ft-stub" style={{ left: parentGuideX }} />
            {/* Runs the full height of this node (including its own
                expanded subtree) so the line keeps going down to the next
                sibling — except for the last sibling, where it stops right
                at the stub instead of trailing off into empty space below
                a subtree that isn't connected to anything further. */}
            <div
              className={`ft-vline ${isLast ? 'ft-vline-last' : ''}`}
              style={{ left: parentGuideX }}
            />
          </>
        )}
        <div
          role="button"
          tabIndex={0}
          data-folder-id={terminal.id}
          className={`ft-row ${isRowActive ? 'ft-active' : ''} ${isDragOver ? 'ft-drag-over' : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => renamingId !== terminal.id && onFolderClick(terminal.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && renamingId !== terminal.id) onFolderClick(terminal.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCtxMenu({ x: e.clientX, y: e.clientY, folder: terminal });
          }}
        >
          <button
            className="ft-twisty"
            onClick={(e) => {
              e.stopPropagation();
              if (kids.length) toggle(terminal.id);
            }}
            tabIndex={-1}
            style={kids.length ? undefined : { cursor: 'default' }}
          >
            {/* Leaf folders render nothing here — the button keeps its fixed
                16px footprint (see .ft-twisty) so names still line up with
                folders that do have a chevron, instead of a "-" that looked
                like a real (but non-functional) control. */}
            {kids.length ? (
              <ChevronRight size={12} style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }} />
            ) : null}
          </button>
          {isOpen && kids.length ? (
            <FolderOpen size={14} className="ft-icon" />
          ) : (
            <Folder size={14} className="ft-icon" />
          )}
          <div className="ft-info">
            <span className="ft-name-chain">
              {chain.map((f, i) => {
                const isMatch =
                  matchSet &&
                  query.trim() &&
                  f.name.toLowerCase().includes(query.trim().toLowerCase());
                return (
                  <span key={f.id}>
                    {renamingId === f.id ? (
                      <RenameInline
                        name={f.name}
                        onConfirm={(val) => {
                          setRenamingId(null);
                          onRenameFolder(f.id, val);
                        }}
                        onCancel={() => setRenamingId(null)}
                      />
                    ) : (
                      <span
                        className={`ft-name ${f.id === activeFolderId ? 'ft-name-active' : ''} ${
                          isMatch ? 'ft-name-match' : ''
                        } ${f.id === UNCATEGORIZED_ID ? 'ft-name-uncategorized' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (renamingId !== f.id) onFolderClick(f.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setCtxMenu({ x: e.clientX, y: e.clientY, folder: f });
                        }}
                      >
                        {f.name}
                      </span>
                    )}
                    {i < chain.length - 1 && <span className="ft-name-sep">/</span>}
                  </span>
                );
              })}
            </span>
            <span className="ft-count">{counts[terminal.id] || 0}</span>
          </div>
        </div>
        {chain.some((f) => f.id === creatingParent) && (
          <form
            className="sp-create-form"
            style={{ paddingLeft: 20 + depth * 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              submitCreate();
            }}
          >
            <input
              ref={newRef}
              className="sp-rename-input"
              placeholder={t('panel.folderName')}
              value={newName}
              maxLength={COLLECTION_NAME_MAX_LEN}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setCreatingParent(undefined);
                  setNewName('');
                }
              }}
              onBlur={submitCreate}
            />
          </form>
        )}
        {isOpen &&
          kids.length > 0 &&
          kids.map((k, i) => renderNode(k, depth + 1, i === kids.length - 1))}
      </div>
    );
  }

  const roots = (tree.get('__root__') || [])
    .filter((f) => !matchSet || matchSet.has(f.id))
    .sort(nameCmp);

  return (
    <div className="ft-tree">
      {/* Toolbar: search inline with new-folder button */}
      <div className="ft-toolbar">
        <div className="ft-search">
          <Search size={11} className="ft-search-icon" />
          <input
            className="ft-search-input"
            placeholder={t('panel.searchFolders', 'Search folders…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="ft-search-clear" onClick={() => setQuery('')}>
              <X size={10} />
            </button>
          )}
        </div>
        <button
          className="ft-new-btn"
          onClick={() => setSortMode((m) => (m === 'az' ? 'za' : 'az'))}
          title={sortMode === 'az' ? t('panel.sortAZ') : t('panel.sortZA')}
        >
          {sortMode === 'za' ? <ArrowUpAZ size={13} /> : <ArrowDownAZ size={13} />}
        </button>
        <button
          className="ft-new-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            setCreatingParent(null);
            setNewName('');
          }}
          title={t('panel.newFolder')}
        >
          <Plus size={13} />
        </button>
      </div>

      {creatingParent === null && (
        <form
          className="sp-create-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitCreate();
          }}
        >
          <input
            ref={newRef}
            className="sp-rename-input"
            placeholder={t('panel.folderName')}
            value={newName}
            maxLength={COLLECTION_NAME_MAX_LEN}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setCreatingParent(undefined);
                setNewName('');
              }
            }}
            onBlur={submitCreate}
          />
        </form>
      )}

      {roots.length === 0 && (
        <div className="sp-empty">
          {matchSet && matchSet.size === 0
            ? t('panel.noFolderResults', 'No folders found')
            : t('panel.noFolders')}
        </div>
      )}
      {roots.map((f) => renderNode(f, 0))}

      {ctxMenu && (
        <SimpleMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}>
          {ctxMenu.folder.id === UNCATEGORIZED_ID ? (
            <button className="sp-ctx-item" onClick={() => handleShowInFinder(ctxMenu.folder)}>
              <ExternalLink size={12} />
              <span>{t('panel.showInFinder', 'Show in Finder')}</span>
            </button>
          ) : (
            <>
              <button
                className="sp-ctx-item"
                onClick={() => {
                  setCreatingParent(ctxMenu.folder.id);
                  setExpanded((p) => new Set(p).add(ctxMenu.folder.id));
                  setCtxMenu(null);
                }}
              >
                <Plus size={12} />
                <span>{t('panel.newSubfolder')}</span>
              </button>
              {(tree.get(ctxMenu.folder.id) || []).length > 0 && (
                <button className="sp-ctx-item" onClick={() => handleExpandAll(ctxMenu.folder)}>
                  <ChevronsDown size={12} />
                  <span>{t('panel.expandAll', 'Expand All')}</span>
                </button>
              )}
              <button
                className="sp-ctx-item"
                onClick={() => {
                  setRenamingId(ctxMenu.folder.id);
                  setCtxMenu(null);
                }}
              >
                <Pencil size={12} />
                <span>{t('panel.rename')}</span>
              </button>
              <button
                className="sp-ctx-item"
                onClick={() => {
                  setMovingFolder(ctxMenu.folder);
                  setCtxMenu(null);
                }}
              >
                <FolderInput size={12} />
                <span>{t('panel.moveFolder', 'Move to…')}</span>
              </button>
              <button className="sp-ctx-item" onClick={() => handleShowInFinder(ctxMenu.folder)}>
                <ExternalLink size={12} />
                <span>{t('panel.showInFinder', 'Show in Finder')}</span>
              </button>
              <div className="sp-ctx-sep" />
              <button
                className="sp-ctx-item sp-ctx-item-danger"
                onClick={() => {
                  onDeleteFolder(ctxMenu.folder.id, ctxMenu.folder.name);
                  setCtxMenu(null);
                }}
              >
                <Trash2 size={12} />
                <span>{t('panel.delete')}</span>
              </button>
            </>
          )}
        </SimpleMenu>
      )}

      {movingFolder && (
        <div className="ft-move-picker-backdrop" onClick={() => setMovingFolder(null)}>
          <MovePicker
            folders={folders}
            sourceFolderId={movingFolder.id}
            sourceRelPath={movingFolder.rel_path}
            onConfirm={handleMoveConfirm}
            onCancel={() => setMovingFolder(null)}
          />
        </div>
      )}
    </div>
  );
}
