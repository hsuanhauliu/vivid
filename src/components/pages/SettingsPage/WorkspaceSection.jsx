import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import {
  FolderPlus,
  Unlink,
  FolderOpen,
  CheckCircle2,
  RotateCcw,
  Pencil,
  Check,
  X,
  AlertTriangle,
} from 'lucide-react';
import { SettingsSection } from './primitives';
import { basenameOf } from '../../../utils/path';
import {
  fetchWorkspaceRegistry,
  pickWorkspaceFolder as pickWorkspaceFolderDialog,
  switchWorkspaceAndApply,
} from '../../../utils/workspace';

/**
 * Lets the user point Vivid at an external folder to use as a workspace
 * instead of — or in addition to — the default app-managed library. Media
 * files are indexed in place, never copied; Vivid's own index lives in a
 * hidden `.vivid` folder inside it, but thumbnails and any format-converted
 * previews are cached in Vivid's own app data folder, never written near the
 * user's files. Switching requires a restart since the DB connection and
 * derived-data caches are only ever opened once at process startup.
 */
export default function WorkspaceSection({ onRequestConfirm }) {
  const { t } = useTranslation();
  const [registry, setRegistry] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // A folder has been picked but not yet registered — waiting on a name.
  const [draftPath, setDraftPath] = useState(null);
  const [draftName, setDraftName] = useState('');

  // Inline rename of an already-registered workspace. `cancelingRef` guards
  // against the Escape key's blur (input unmounts, firing onBlur) also
  // committing the very edit Escape was meant to discard.
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const editingInputRef = useRef(null);
  const cancelingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const { registry: reg, active } = await fetchWorkspaceRegistry();
      setRegistry(reg);
      setRunningId(active.id);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (editingId) editingInputRef.current?.select();
  }, [editingId]);

  // Switching is a deliberate, single-purpose action the user just clicked a
  // "Switch" button to take — no confirmation dialog in between.
  const switchTo = useCallback(
    async (id) => {
      setError(null);
      setNotice(null);
      try {
        const { relaunched } = await switchWorkspaceAndApply(id);
        if (!relaunched) {
          setNotice(t('settings.workspace.devRestartNeeded'));
          await refresh();
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh, t],
  );

  async function pickWorkspaceFolder() {
    const picked = await pickWorkspaceFolderDialog(t('settings.workspace.chooseTitle'));
    if (!picked) return;
    setError(null);
    setDraftPath(picked.path);
    setDraftName(picked.suggestedName);
  }

  function cancelDraft() {
    setDraftPath(null);
    setDraftName('');
  }

  async function commitDraft() {
    if (!draftPath) return;
    setBusy(true);
    setError(null);
    try {
      // Registers it but doesn't switch to it — the user can click "Switch"
      // whenever they're ready; adding a workspace shouldn't itself jump the
      // running app over to it.
      await invoke('add_workspace', { path: draftPath, name: draftName.trim() });
      setDraftPath(null);
      setDraftName('');
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function startRename(w) {
    cancelingRef.current = false;
    setEditingId(w.id);
    setEditingName(w.name);
  }

  function cancelRename() {
    cancelingRef.current = true;
    setEditingId(null);
  }

  async function commitRename(id) {
    if (cancelingRef.current) {
      cancelingRef.current = false;
      return;
    }
    const name = editingName.trim();
    setEditingId(null);
    if (!name) return;
    setError(null);
    try {
      const ws = await invoke('rename_workspace', { id, name });
      setRegistry(
        (r) => r && { ...r, workspaces: r.workspaces.map((w) => (w.id === id ? ws : w)) },
      );
    } catch (e) {
      setError(String(e));
      await refresh(); // roll display back to the real registry state
    }
  }

  async function fixPath(w) {
    const picked = await pickWorkspaceFolderDialog(
      t('settings.workspace.fixPathTitle', { name: w.name }),
    );
    if (!picked) return;
    setError(null);
    setBusy(true);
    try {
      const ws = await invoke('update_workspace_path', { id: w.id, path: picked.path });
      setRegistry(
        (r) =>
          r && {
            ...r,
            workspaces: r.workspaces.map((x) => (x.id === w.id ? { ...ws, valid: true } : x)),
          },
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Forget a registered external workspace, leaving its folder (and
  // everything inside it, including its own `.vivid/` database) untouched
  // on disk — it can always be re-added later by picking the folder again.
  // Unlike the plain "Remove" this used to be, unlinking the *active*
  // workspace is allowed: it switches to the default workspace first (a
  // registry-only write), forgets the old entry, then relaunches once so
  // the running process actually picks up the default instead of the one
  // that just got unlinked.
  function unlinkWorkspace(id, name) {
    const isActive = id === runningId;
    onRequestConfirm?.({
      title: t('settings.workspace.unlinkTitle'),
      message: isActive
        ? t('settings.workspace.unlinkActiveConfirm', { name })
        : t('settings.workspace.unlinkConfirm', { name }),
      confirmLabel: t('settings.workspace.unlink'),
      onConfirm: async () => {
        onRequestConfirm(null);
        setError(null);
        setNotice(null);
        try {
          if (isActive) {
            const defaultWs = workspaces.find((w) => w.kind === 'default');
            if (defaultWs) await invoke('switch_workspace', { id: defaultWs.id });
            await invoke('remove_workspace', { id });
            if (import.meta.env.DEV) {
              // Same dev-mode limitation as switchWorkspaceAndApply: the
              // Tauri CLI supervises the dev binary, so a self-relaunch
              // doesn't reconnect to the Vite dev server.
              setNotice(t('settings.workspace.devRestartNeeded'));
              await refresh();
            } else {
              await relaunch();
            }
          } else {
            await invoke('remove_workspace', { id });
            await refresh();
          }
        } catch (e) {
          setError(String(e));
        }
      },
    });
  }

  const workspaces = registry?.workspaces ?? [];
  const pendingId = registry?.active_id;

  return (
    <SettingsSection title={t('settings.sections.workspace')}>
      <div className="settings-section-body">
        <p className="settings-section-desc">{t('settings.workspace.desc')}</p>
        {error && <p className="workspace-error">{error}</p>}
        {notice && <p className="workspace-notice">{notice}</p>}

        <div className="workspace-list">
          {workspaces.map((w) => {
            const isRunning = w.id === runningId;
            const isPending = !isRunning && w.id === pendingId;
            const isEditing = editingId === w.id;
            const isInvalid = w.valid === false;
            return (
              <div key={w.id} className="workspace-row">
                <FolderOpen size={15} className="settings-row-icon" />
                <div className="workspace-row-text">
                  {isEditing ? (
                    <input
                      ref={editingInputRef}
                      className="input workspace-row-name-input"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(w.id);
                        if (e.key === 'Escape') cancelRename();
                      }}
                      onBlur={() => commitRename(w.id)}
                      maxLength={80}
                      autoFocus
                    />
                  ) : (
                    <span className="workspace-row-name-line">
                      <span className="workspace-row-name">{w.name}</span>
                      {isRunning && (
                        <span className="workspace-badge workspace-badge-active">
                          <CheckCircle2 size={12} /> {t('settings.workspace.active')}
                        </span>
                      )}
                      {isPending && (
                        <span className="workspace-badge workspace-badge-pending">
                          <RotateCcw size={12} /> {t('settings.workspace.pendingRestart')}
                        </span>
                      )}
                      {isInvalid && (
                        <span className="workspace-badge workspace-badge-invalid">
                          <AlertTriangle size={12} /> {t('settings.workspace.invalid')}
                        </span>
                      )}
                    </span>
                  )}
                  <span className="workspace-row-path">
                    {w.kind === 'default' ? t('settings.workspace.defaultPath') : w.path}
                  </span>
                </div>
                {isInvalid && !isEditing && (
                  <button className="btn btn-secondary" onClick={() => fixPath(w)} disabled={busy}>
                    {t('settings.workspace.fixPath')}
                  </button>
                )}
                {!isRunning && !isPending && !isEditing && !isInvalid && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => switchTo(w.id)}
                    disabled={busy}
                  >
                    {t('settings.workspace.switch')}
                  </button>
                )}
                {isEditing ? (
                  <button
                    className="icon-btn"
                    title={t('settings.workspace.saveName')}
                    onClick={() => commitRename(w.id)}
                  >
                    <Check size={13} />
                  </button>
                ) : (
                  <button
                    className="icon-btn"
                    title={t('settings.workspace.rename')}
                    onClick={() => startRename(w)}
                  >
                    <Pencil size={13} />
                  </button>
                )}
                {w.kind !== 'default' && !isEditing && (
                  <button
                    className="icon-btn"
                    title={t('settings.workspace.unlink')}
                    onClick={() => unlinkWorkspace(w.id, w.name)}
                  >
                    <Unlink size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {draftPath ? (
          <div className="workspace-draft">
            <span className="workspace-draft-path" title={draftPath}>
              {draftPath}
            </span>
            <div className="workspace-draft-row">
              <input
                className="input"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={basenameOf(draftPath)}
                maxLength={80}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && commitDraft()}
              />
              <button
                className="icon-btn"
                title={t('batchRename.cancel')}
                onClick={cancelDraft}
                disabled={busy}
              >
                <X size={14} />
              </button>
              <button className="btn btn-primary" onClick={commitDraft} disabled={busy}>
                {t('settings.workspace.add')}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn btn-secondary"
            style={{ alignSelf: 'flex-start' }}
            onClick={pickWorkspaceFolder}
            disabled={busy}
          >
            <FolderPlus size={13} style={{ marginRight: 4 }} />
            {t('settings.workspace.add')}
          </button>
        )}
      </div>
    </SettingsSection>
  );
}
