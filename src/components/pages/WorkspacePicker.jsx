import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, Check, FolderOpen, HardDrive, Loader } from 'lucide-react';
import vividIcon from '../../../src-tauri/icons/128x128.png';
import './WelcomeFlow.css';
import './WorkspacePicker.css';

// Purely decorative — a handful of app-icon copies gently bobbing behind the
// startup picker, each positioned/timed by its index (see the `wpf-N` rules
// in WorkspacePicker.css) so the field reads as loosely scattered rather
// than a visible grid, with no per-render randomness to keep it stable
// across re-renders.
const FLOAT_ICON_COUNT = 8;

/**
 * Rendered by `WorkspaceGate` *before* the real app has mounted at all — the
 * backend deliberately hasn't loaded any workspace yet (see
 * `initialize_workspace` in lib.rs), so there's nothing running to compare
 * against and no relaunch needed. Every pick calls `open_workspace`, which
 * loads it directly in this same process. `runningId` is just the
 * pre-selected suggestion (the registry's last-active id) — since nothing is
 * actually loaded, no row gets a "current" badge, and there's deliberately no
 * Cancel/dismiss affordance: picking a workspace *is* the only way forward,
 * so "cancel" would have nothing meaningful to return to.
 *
 * Switching workspaces from an already-running app is a separate, simpler
 * path now — the macOS "Workspace" menu switches directly (see
 * `menu-switch-to-workspace` in App.jsx), no picker UI involved.
 */
export default function WorkspacePicker({ workspaces, runningId, onDismiss }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(runningId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleContinue() {
    setBusy(true);
    setError(null);
    try {
      await invoke('open_workspace', { id: selected });
      onDismiss();
    } catch (e) {
      setBusy(false);
      // `open_workspace` refuses (rather than silently recreating) a
      // workspace whose folder has vanished — that specific error deserves
      // its own message pointing at Settings, since "fixing" it means
      // picking a new folder there, not retrying the same pick.
      setError(
        String(e) === 'workspace-path-missing' ? t('workspacePicker.pathMissing') : String(e),
      );
    }
  }

  return (
    <div className="welcome-backdrop workspace-picker-backdrop-startup">
      <div className="workspace-picker-mesh" aria-hidden="true">
        <span />
      </div>
      <div className="workspace-picker-float-bg" aria-hidden="true">
        {Array.from({ length: FLOAT_ICON_COUNT }).map((_, i) => (
          <img key={i} src={vividIcon} alt="" className={`workspace-picker-float-icon wpf-${i}`} />
        ))}
      </div>
      <div className="welcome-drag-region" data-tauri-drag-region />
      <div className="welcome-modal workspace-picker-modal" role="dialog" aria-modal="true">
        <div className="welcome-step">
          <h2 className="welcome-step-title">{t('workspacePicker.title')}</h2>
          <p className="welcome-step-desc">{t('workspacePicker.desc')}</p>

          <div className="workspace-picker-list">
            {workspaces.map((w) => {
              const invalid = w.valid === false;
              return (
                <button
                  key={w.id}
                  type="button"
                  className={`workspace-picker-row ${selected === w.id ? 'active' : ''} ${invalid ? 'invalid' : ''}`}
                  onClick={() => setSelected(w.id)}
                  disabled={busy}
                  title={invalid ? t('workspacePicker.pathMissing') : undefined}
                >
                  {w.kind === 'default' ? (
                    <HardDrive size={16} className="workspace-picker-row-icon" />
                  ) : (
                    <FolderOpen size={16} className="workspace-picker-row-icon" />
                  )}
                  <span className="workspace-picker-row-text">
                    <span className="workspace-picker-row-name-line">
                      <span className="workspace-picker-row-name">{w.name}</span>
                      {invalid && (
                        <span className="workspace-picker-invalid-badge">
                          <AlertTriangle size={11} /> {t('workspacePicker.invalid')}
                        </span>
                      )}
                    </span>
                    <span className="workspace-picker-row-path">
                      {w.kind === 'default' ? t('settings.workspace.defaultPath') : w.path}
                    </span>
                  </span>
                  {selected === w.id && <Check size={14} className="workspace-picker-row-check" />}
                </button>
              );
            })}
          </div>

          {error && <p className="welcome-workspace-error">{error}</p>}
        </div>

        <div className="welcome-footer workspace-picker-footer">
          <div className="welcome-actions">
            <button className="btn btn-primary" onClick={handleContinue} disabled={busy}>
              {busy ? (
                <>
                  <Loader size={13} className="settings-indexing-spin" />{' '}
                  {t('workspacePicker.opening')}
                </>
              ) : (
                t('workspacePicker.continue')
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
