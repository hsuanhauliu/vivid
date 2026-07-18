import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Sun,
  Moon,
  Globe,
  Check,
  ArrowRight,
  ArrowLeft,
  Download,
  Loader,
  Image as ImageIcon,
  HardDrive,
  FolderOpen,
} from 'lucide-react';
import ToolsManager from '../common/ToolsManager';
import Select from '../common/Select';
import { basenameOf } from '../../utils/path';
import { switchWorkspaceAndApply } from '../../utils/workspace';
import vividIcon from '../../../src-tauri/icons/128x128.png';
import './WelcomeFlow.css';

// A small, curated accent palette — the full 14-color set lives in Settings.
// Values match the global color-theme keys so picks apply app-wide instantly.
const ACCENTS = [
  { value: 'blue', color: '#1d7af0' },
  { value: 'purple', color: '#a855f7' },
  { value: 'pink', color: '#ec4899' },
  { value: 'red', color: '#ef4444' },
  { value: 'green', color: '#22c55e' },
  { value: 'teal', color: '#14b8a6' },
];

const LANGUAGES = [
  { value: '', labelKey: 'settings.appearance.systemDefault' },
  { value: 'zh-CN', labelKey: 'settings.appearance.languages.zhCN' },
  { value: 'zh-TW', labelKey: 'settings.appearance.languages.zhTW' },
  { value: 'en', labelKey: 'settings.appearance.languages.en' },
  { value: 'fr', labelKey: 'settings.appearance.languages.fr' },
  { value: 'de', labelKey: 'settings.appearance.languages.de' },
  { value: 'hi', labelKey: 'settings.appearance.languages.hi' },
  { value: 'ja', labelKey: 'settings.appearance.languages.ja' },
  { value: 'ko', labelKey: 'settings.appearance.languages.ko' },
  { value: 'pt', labelKey: 'settings.appearance.languages.pt' },
  { value: 'es', labelKey: 'settings.appearance.languages.es' },
  { value: 'vi', labelKey: 'settings.appearance.languages.vi' },
];

const HOME_OPTIONS = [
  { value: 'all', labelKey: 'settings.homePageOptions.all' },
  { value: 'image', labelKey: 'settings.homePageOptions.image' },
  { value: 'video', labelKey: 'settings.homePageOptions.video' },
  { value: 'audio', labelKey: 'settings.homePageOptions.audio' },
  { value: 'folders', labelKey: 'settings.homePageOptions.folders' },
  { value: 'albums', labelKey: 'settings.homePageOptions.albums' },
  { value: 'music', labelKey: 'settings.homePageOptions.music' },
];

const STEP_COUNT = 5;
const WORKSPACE_STEP = 1;

/**
 * First-run onboarding. Surfaces the handful of settings new users most want to
 * review (where to store the library, language, theme, accent, default view)
 * with sensible defaults already selected, then offers the optional AI model
 * download. Every choice writes through to the app's real state, so picks
 * preview live behind the modal and persist whether or not the user finishes.
 */
export default function WelcomeFlow({
  onFinish,
  theme,
  onThemeChange,
  colorTheme,
  onColorThemeChange,
  homePage,
  onHomePageChange,
  multilingualInstalled,
  multilingualLoading,
  onDownloadModel,
}) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);
  const [lang, setLang] = useState(localStorage.getItem('vivid-language') || '');
  const [downloading, setDownloading] = useState(false);

  // Workspace choice (step WORKSPACE_STEP): "default" uses Vivid's own managed
  // library, unchanged from before this step existed; "external" registers an
  // existing folder as a portable workspace. Registration happens when the
  // user advances past this step (not on every folder pick) so a change of
  // mind before then never needs to touch the backend at all. `wsRegistered`
  // tracks what's actually been registered so we can clean up a stale
  // registration if the user comes back and changes their pick.
  const [wsChoice, setWsChoice] = useState('default');
  const [wsFolder, setWsFolder] = useState(null);
  const [wsName, setWsName] = useState('');
  const [wsRegistered, setWsRegistered] = useState(null); // { id, path, name } | null
  const [wsBusy, setWsBusy] = useState(false);
  const [wsError, setWsError] = useState(null);
  const [relaunching, setRelaunching] = useState(false);

  function changeLang(value) {
    setLang(value);
    if (value === '') {
      localStorage.removeItem('vivid-language');
      i18n.changeLanguage(navigator.language);
    } else {
      i18n.changeLanguage(value);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      await onDownloadModel?.();
    } catch {
      /* errors are surfaced (and retryable) on the Settings AI page */
    } finally {
      setDownloading(false);
    }
  }

  async function pickWorkspaceFolder() {
    const picked = await open({ directory: true, title: t('welcome.workspace.chooseTitle') });
    if (!picked) return;
    const path = typeof picked === 'string' ? picked : picked[0];
    setWsFolder(path);
    setWsChoice('external');
    setWsError(null);
    // Suggest the folder's own name, but don't clobber a name the user
    // already typed in (e.g. after picking a different folder).
    setWsName((prev) => (prev.trim() ? prev : basenameOf(path)));
  }

  // Reconcile the backend registry with whatever's currently chosen, then
  // advance. Only ever called when leaving WORKSPACE_STEP.
  async function commitWorkspaceStep() {
    setWsError(null);
    if (wsChoice === 'default') {
      if (wsRegistered) {
        await invoke('remove_workspace', { id: wsRegistered.id }).catch(() => {});
        setWsRegistered(null);
      }
      setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
      return;
    }
    if (!wsFolder) {
      setWsError(t('welcome.workspace.pickFolderFirst'));
      return;
    }
    const trimmedName = wsName.trim();
    if (wsRegistered && wsRegistered.path === wsFolder) {
      // Same folder already registered — just reconcile the name if it changed.
      if (trimmedName && trimmedName !== wsRegistered.name) {
        setWsBusy(true);
        try {
          const ws = await invoke('rename_workspace', { id: wsRegistered.id, name: trimmedName });
          setWsRegistered({ id: ws.id, path: wsFolder, name: ws.name });
        } catch (e) {
          setWsError(String(e));
          setWsBusy(false);
          return;
        }
        setWsBusy(false);
      }
      setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
      return;
    }
    setWsBusy(true);
    try {
      if (wsRegistered) {
        await invoke('remove_workspace', { id: wsRegistered.id }).catch(() => {});
      }
      const ws = await invoke('add_workspace', { path: wsFolder, name: trimmedName });
      setWsRegistered({ id: ws.id, path: wsFolder, name: ws.name });
      setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
    } catch (e) {
      setWsError(String(e));
    } finally {
      setWsBusy(false);
    }
  }

  function next() {
    if (step === WORKSPACE_STEP) {
      commitWorkspaceStep();
      return;
    }
    setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  }
  const back = () => setStep((s) => Math.max(s - 1, 0));

  // Skip and Finish both end the flow, so both must equally honor a workspace
  // choice already committed via commitWorkspaceStep — bailing out early
  // shouldn't silently discard a folder the user already picked and confirmed.
  async function finish() {
    if (wsRegistered) {
      localStorage.setItem('vivid-onboarded', 'true');
      setRelaunching(true);
      try {
        const { relaunched } = await switchWorkspaceAndApply(wsRegistered.id);
        if (relaunched) {
          // One-shot: the workspace picker (shown for returning users with
          // 2+ workspaces) would otherwise immediately re-ask about the very
          // choice just made here, right after this relaunch completes.
          localStorage.setItem('vivid-skip-workspace-picker-once', 'true');
          return;
        }
        // Dev mode: registry updated, but nothing auto-restarts the dev
        // server (see switchWorkspaceAndApply) — finish onboarding anyway
        // and leave applying the switch to a manual restart.
        console.info('Workspace switched — restart `npm run tauri dev` to apply it.');
      } catch (e) {
        setRelaunching(false);
        setWsError(String(e));
        return;
      }
    }
    onFinish();
  }

  const modelBusy = downloading || multilingualLoading;
  const workspaceBusy = wsBusy || relaunching;

  return (
    <div className="welcome-backdrop">
      {/* The full-screen backdrop covers the window's titlebar, so re-expose a
          drag strip across the top edge to keep the window movable. */}
      <div className="welcome-drag-region" data-tauri-drag-region />
      <div className="welcome-modal" role="dialog" aria-modal="true">
        <button className="welcome-skip" onClick={finish} disabled={workspaceBusy}>
          {t('welcome.skip')}
        </button>

        {step === 0 && (
          <div className="welcome-step welcome-step-intro">
            <img src={vividIcon} alt="Vivid" className="welcome-hero-logo" width={80} height={80} />
            <h1 className="welcome-title">{t('welcome.title')}</h1>
            <p className="welcome-subtitle">{t('welcome.subtitle')}</p>
          </div>
        )}

        {step === WORKSPACE_STEP && (
          <div className="welcome-step">
            <h2 className="welcome-step-title">{t('welcome.workspace.title')}</h2>
            <p className="welcome-step-desc">{t('welcome.workspace.desc')}</p>

            <div className="welcome-workspace-options">
              <button
                type="button"
                className={`welcome-workspace-card ${wsChoice === 'default' ? 'active' : ''}`}
                onClick={() => {
                  setWsChoice('default');
                  setWsError(null);
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
                className={`welcome-workspace-card ${wsChoice === 'external' ? 'active' : ''}`}
                onClick={pickWorkspaceFolder}
              >
                <FolderOpen size={20} strokeWidth={1.6} />
                <span className="welcome-workspace-card-title">
                  {t('welcome.workspace.externalTitle')}
                </span>
                <span className="welcome-workspace-card-desc" title={wsFolder || undefined}>
                  {wsChoice === 'external' && wsFolder
                    ? wsFolder
                    : t('welcome.workspace.externalDesc')}
                </span>
              </button>
            </div>

            {wsChoice === 'external' && wsFolder && (
              <>
                <button
                  type="button"
                  className="settings-inline-link"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={pickWorkspaceFolder}
                >
                  {t('welcome.workspace.changeFolder')}
                </button>
                <div className="welcome-field">
                  <label className="welcome-label">{t('welcome.workspace.nameLabel')}</label>
                  <input
                    className="input full"
                    value={wsName}
                    onChange={(e) => setWsName(e.target.value)}
                    placeholder={basenameOf(wsFolder)}
                    maxLength={80}
                  />
                </div>
              </>
            )}

            {wsError && <p className="welcome-workspace-error">{wsError}</p>}
          </div>
        )}

        {step === 2 && (
          <div className="welcome-step">
            <h2 className="welcome-step-title">{t('welcome.personalizeTitle')}</h2>
            <p className="welcome-step-desc">{t('welcome.personalizeDesc')}</p>

            <div className="welcome-field">
              <label className="welcome-label">
                <Globe size={13} /> {t('welcome.language')}
              </label>
              <Select
                className="full"
                ariaLabel={t('welcome.language')}
                value={lang}
                onChange={changeLang}
                options={LANGUAGES.map(({ value, label, labelKey }) => ({
                  value,
                  label: labelKey ? t(labelKey) : label,
                }))}
              />
            </div>

            <div className="welcome-field">
              <label className="welcome-label">{t('welcome.theme')}</label>
              <div className="welcome-theme-options">
                <button
                  className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                  onClick={() => onThemeChange('light')}
                >
                  <Sun size={18} strokeWidth={1.6} />
                  <span>{t('settings.appearance.light')}</span>
                </button>
                <button
                  className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => onThemeChange('dark')}
                >
                  <Moon size={18} strokeWidth={1.6} />
                  <span>{t('settings.appearance.dark')}</span>
                </button>
              </div>
            </div>

            <div className="welcome-field">
              <label className="welcome-label">{t('welcome.accent')}</label>
              <div className="welcome-accent-row">
                {ACCENTS.map(({ value, color }) => (
                  <button
                    key={value}
                    className={`welcome-accent-dot ${colorTheme === value ? 'active' : ''}`}
                    style={{ '--swatch': color }}
                    onClick={() => onColorThemeChange(value)}
                    aria-label={value}
                  >
                    {colorTheme === value && <Check size={12} />}
                  </button>
                ))}
              </div>
            </div>

            <div className="welcome-field">
              <label className="welcome-label">{t('welcome.homeView')}</label>
              <Select
                className="full"
                ariaLabel={t('welcome.homeView')}
                value={homePage}
                onChange={onHomePageChange}
                options={HOME_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="welcome-step">
            <h2 className="welcome-step-title">{t('welcome.toolsTitle')}</h2>
            <p className="welcome-step-desc">{t('welcome.toolsDesc')}</p>
            <ToolsManager />
            <p className="welcome-ai-note">{t('welcome.toolsNote')}</p>
          </div>
        )}

        {step === 4 && (
          <div className="welcome-step">
            <h2 className="welcome-step-title">{t('welcome.aiTitle')}</h2>
            <p className="welcome-step-desc">{t('welcome.aiDesc')}</p>

            <div className="welcome-ai-card">
              <div className="welcome-ai-icon">
                <ImageIcon size={20} strokeWidth={1.6} />
              </div>
              <div className="welcome-ai-body">
                <span className="welcome-ai-name">{t('welcome.aiModelName')}</span>
                <span className="welcome-ai-meta">{t('welcome.aiModelMeta')}</span>
              </div>
              {multilingualInstalled ? (
                <span className="welcome-ai-installed">
                  <Check size={14} /> {t('welcome.aiInstalled')}
                </span>
              ) : (
                <button
                  className="btn btn-primary welcome-ai-dl"
                  onClick={handleDownload}
                  disabled={modelBusy}
                >
                  {modelBusy ? (
                    <>
                      <Loader size={13} className="settings-indexing-spin" />{' '}
                      {t('welcome.aiDownloading')}
                    </>
                  ) : (
                    <>
                      <Download size={13} /> {t('welcome.aiDownload')}
                    </>
                  )}
                </button>
              )}
            </div>
            <p className="welcome-ai-note">{t('welcome.aiNote')}</p>
          </div>
        )}

        <div className="welcome-footer">
          <div className="welcome-dots">
            {Array.from({ length: STEP_COUNT }).map((_, i) => (
              <span key={i} className={`welcome-dot ${i === step ? 'active' : ''}`} />
            ))}
          </div>
          <div className="welcome-actions">
            {step > 0 && (
              <button className="btn btn-secondary" onClick={back} disabled={workspaceBusy}>
                <ArrowLeft size={13} /> {t('welcome.back')}
              </button>
            )}
            {step < STEP_COUNT - 1 ? (
              <button className="btn btn-primary" onClick={next} disabled={workspaceBusy}>
                {wsBusy ? (
                  <>
                    <Loader size={13} className="settings-indexing-spin" />{' '}
                    {t('welcome.workspace.adding')}
                  </>
                ) : (
                  <>
                    {step === 0 ? t('welcome.getStarted') : t('welcome.next')}{' '}
                    <ArrowRight size={13} />
                  </>
                )}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={finish} disabled={workspaceBusy}>
                {relaunching ? (
                  <>
                    <Loader size={13} className="settings-indexing-spin" />{' '}
                    {t('welcome.workspace.restarting')}
                  </>
                ) : (
                  <>
                    <Check size={13} /> {t('welcome.finish')}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
