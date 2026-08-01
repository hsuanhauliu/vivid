import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { HardDrive, FolderOpen, Loader } from 'lucide-react';
import { pickWorkspaceFolder as pickWorkspaceFolderDialog } from '../../utils/workspace';
import { basenameOf } from '../../utils/path';
import vividIcon from '../../../src-tauri/icons/128x128.png';
import './WelcomeFlow.css';
import './WorkspacePicker.css';

// Purely decorative — see WorkspacePicker.jsx's identical block.
const FLOAT_ICON_COUNT = 8;

/**
 * Shown by `WorkspaceGate` before *anything* else on a genuinely fresh
 * install (no workspace registered at all — see `WorkspaceRegistry::default`
 * in workspace.rs, which is deliberately empty rather than auto-seeding
 * Vivid's managed library). Nothing about the default workspace is created
 * unless the user explicitly picks it here: choosing "my own folder"
 * registers only that external workspace, so a user who never wants Vivid's
 * managed library never gets one.
 */
export default function FirstRunWorkspaceChoice({ onDone }) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState('default');
  const [folder, setFolder] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function pickFolder() {
    const picked = await pickWorkspaceFolderDialog(t('welcome.workspace.chooseTitle'));
    if (!picked) return;
    setFolder(picked.path);
    setChoice('external');
    setError(null);
    // Suggest the folder's own name, but don't clobber a name the user
    // already typed in (e.g. after picking a different folder).
    setName((prev) => (prev.trim() ? prev : picked.suggestedName));
  }

  async function handleContinue() {
    setBusy(true);
    setError(null);
    try {
      if (choice === 'default') {
        const ws = await invoke('add_default_workspace');
        await invoke('open_workspace', { id: ws.id });
      } else {
        if (!folder) {
          setError(t('welcome.workspace.pickFolderFirst'));
          setBusy(false);
          return;
        }
        const ws = await invoke('add_workspace', { path: folder, name: name.trim() });
        await invoke('open_workspace', { id: ws.id });
      }
      onDone();
    } catch (e) {
      setBusy(false);
      setError(String(e));
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
          <h2 className="welcome-step-title">{t('welcome.workspace.title')}</h2>
          <p className="welcome-step-desc">{t('welcome.workspace.desc')}</p>

          <div className="welcome-workspace-options">
            <button
              type="button"
              className={`welcome-workspace-card ${choice === 'default' ? 'active' : ''}`}
              onClick={() => {
                setChoice('default');
                setError(null);
              }}
            >
              <HardDrive size={20} strokeWidth={1.6} />
              <span className="welcome-workspace-card-title">
                {t('welcome.workspace.defaultTitle')}
              </span>
              <span className="welcome-workspace-card-desc">
                {t('welcome.workspace.defaultDesc')}
              </span>
            </button>
            <button
              type="button"
              className={`welcome-workspace-card ${choice === 'external' ? 'active' : ''}`}
              onClick={pickFolder}
            >
              <FolderOpen size={20} strokeWidth={1.6} />
              <span className="welcome-workspace-card-title">
                {t('welcome.workspace.externalTitle')}
              </span>
              <span className="welcome-workspace-card-desc" title={folder || undefined}>
                {choice === 'external' && folder ? folder : t('welcome.workspace.externalDesc')}
              </span>
            </button>
          </div>

          {choice === 'external' && folder && (
            <>
              <button
                type="button"
                className="settings-inline-link"
                style={{ alignSelf: 'flex-start' }}
                onClick={pickFolder}
              >
                {t('welcome.workspace.changeFolder')}
              </button>
              <div className="welcome-field">
                <label className="welcome-label">{t('welcome.workspace.nameLabel')}</label>
                <input
                  className="input full"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={basenameOf(folder)}
                  maxLength={80}
                />
              </div>
            </>
          )}

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
