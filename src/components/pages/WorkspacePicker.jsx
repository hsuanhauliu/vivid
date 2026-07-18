import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Check, FolderOpen, HardDrive, Loader, X } from 'lucide-react';
import { switchWorkspaceAndApply } from '../../utils/workspace';
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
 * Lets the user choose among registered workspaces. Two distinct uses,
 * controlled by `mode`:
 *
 * - `'switch'` (default): the app is already running with some workspace
 *   loaded (`runningId`). Picking a different one switches and restarts;
 *   picking the same one just dismisses, since nothing actually changes.
 * - `'startup'`: rendered by `WorkspaceGate` *before* the real app has
 *   mounted at all — the backend deliberately hasn't loaded any workspace
 *   yet (see `initialize_workspace` in lib.rs), so there's nothing running
 *   to compare against and no relaunch needed. Every pick calls
 *   `open_workspace`, which loads it directly in this same process.
 *   `runningId` here is just the pre-selected suggestion (the registry's
 *   last-active id) — since nothing is actually loaded, no row gets the
 *   "Current" badge, and Cancel opens that suggestion rather than merely
 *   dismissing.
 */
export default function WorkspacePicker({ workspaces, runningId, onDismiss, mode = 'switch' }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(runningId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Shared by both the primary button (applies whatever's `selected`) and
  // Cancel (applies `runningId` — the current/suggested workspace — as if
  // the user had picked that one all along). In 'switch' mode that reduces
  // to a plain no-op dismiss for Cancel; in 'startup' mode nothing is loaded
  // yet, so Cancel still has to open *something*, and reverting to the
  // current/last-active choice is the least surprising option.
  async function applyChoice(id) {
    if (mode === 'switch' && id === runningId) {
      onDismiss();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'startup') {
        await invoke('open_workspace', { id });
        onDismiss();
        return;
      }
      const { relaunched } = await switchWorkspaceAndApply(id);
      if (!relaunched) {
        // Dev mode: registry updated, but nothing restarts the dev server
        // for us (see switchWorkspaceAndApply) — surface that instead of
        // sitting on a spinner that'll never resolve into a relaunch.
        setBusy(false);
        setNotice(t('settings.workspace.devRestartNeeded'));
      }
    } catch (e) {
      setBusy(false);
      setError(String(e));
    }
  }

  const handleContinue = () => applyChoice(selected);
  const handleCancel = () => applyChoice(runningId);

  return (
    <div
      className={`welcome-backdrop ${mode === 'startup' ? 'workspace-picker-backdrop-startup' : ''}`}
    >
      {mode === 'startup' && (
        <div className="workspace-picker-float-bg" aria-hidden="true">
          {Array.from({ length: FLOAT_ICON_COUNT }).map((_, i) => (
            <img
              key={i}
              src={vividIcon}
              alt=""
              className={`workspace-picker-float-icon wpf-${i}`}
            />
          ))}
        </div>
      )}
      <div className="welcome-drag-region" data-tauri-drag-region />
      <div className="welcome-modal workspace-picker-modal" role="dialog" aria-modal="true">
        <button
          className="welcome-skip workspace-picker-close"
          onClick={handleCancel}
          disabled={busy}
          title={t('workspacePicker.cancel')}
          aria-label={t('workspacePicker.cancel')}
        >
          <X size={15} />
        </button>

        <div className="welcome-step">
          <h2 className="welcome-step-title">{t('workspacePicker.title')}</h2>
          <p className="welcome-step-desc">{t('workspacePicker.desc')}</p>

          <div className="workspace-picker-list">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                className={`workspace-picker-row ${selected === w.id ? 'active' : ''}`}
                onClick={() => setSelected(w.id)}
                disabled={busy}
              >
                {w.kind === 'default' ? (
                  <HardDrive size={16} className="workspace-picker-row-icon" />
                ) : (
                  <FolderOpen size={16} className="workspace-picker-row-icon" />
                )}
                <span className="workspace-picker-row-text">
                  <span className="workspace-picker-row-name-line">
                    <span className="workspace-picker-row-name">{w.name}</span>
                    {mode === 'switch' && w.id === runningId && (
                      <span className="workspace-picker-current-badge">
                        {t('workspacePicker.current')}
                      </span>
                    )}
                  </span>
                  <span className="workspace-picker-row-path">
                    {w.kind === 'default' ? t('settings.workspace.defaultPath') : w.path}
                  </span>
                </span>
                {selected === w.id && <Check size={14} className="workspace-picker-row-check" />}
              </button>
            ))}
          </div>

          {error && <p className="welcome-workspace-error">{error}</p>}
          {notice && <p className="workspace-notice">{notice}</p>}
        </div>

        <div className="welcome-footer workspace-picker-footer">
          <div className="welcome-actions">
            <button className="btn btn-primary" onClick={handleContinue} disabled={busy}>
              {busy ? (
                <>
                  <Loader size={13} className="settings-indexing-spin" />{' '}
                  {t(mode === 'startup' ? 'workspacePicker.opening' : 'workspacePicker.restarting')}
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
