import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FolderOpen, HardDrive, Loader } from 'lucide-react';
import { switchWorkspaceAndApply } from '../../utils/workspace';
import './WelcomeFlow.css';
import './WorkspacePicker.css';

/**
 * Startup gate shown only when more than one workspace is registered — with
 * just the default workspace there's nothing to choose between, so most
 * users never see this. Pre-selects whichever workspace this process
 * actually opened with; picking a different one switches and restarts,
 * picking the same one just dismisses (nothing to change).
 */
export default function WorkspacePicker({ workspaces, runningId, onDismiss }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(runningId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function handleContinue() {
    if (selected === runningId) {
      onDismiss();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { relaunched } = await switchWorkspaceAndApply(selected);
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

  return (
    <div className="welcome-backdrop">
      <div className="welcome-drag-region" data-tauri-drag-region />
      <div className="welcome-modal workspace-picker-modal" role="dialog" aria-modal="true">
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
                  <span className="workspace-picker-row-name">{w.name}</span>
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
                  {t('workspacePicker.restarting')}
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
