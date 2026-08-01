import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
} from 'lucide-react';
import ToolsManager from '../common/ToolsManager';
import Select from '../common/Select';
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

const STEP_COUNT = 4;

/**
 * First-run onboarding. Surfaces the handful of settings new users most want
 * to review (language, theme, accent, default view) with sensible defaults
 * already selected, then offers the optional AI model download. Every choice
 * writes through to the app's real state, so picks preview live behind the
 * modal and persist whether or not the user finishes.
 *
 * Which workspace to use is resolved *before* this ever mounts (see
 * `WorkspaceGate`/`FirstRunWorkspaceChoice`) — by the time a user reaches
 * this flow, some workspace is already loaded and running, so there's
 * nothing about it left to ask here.
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

  const next = () => setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const modelBusy = downloading || multilingualLoading;

  return (
    <div className="welcome-backdrop">
      {/* The full-screen backdrop covers the window's titlebar, so re-expose a
          drag strip across the top edge to keep the window movable. */}
      <div className="welcome-drag-region" data-tauri-drag-region />
      <div className="welcome-modal" role="dialog" aria-modal="true">
        <button className="welcome-skip" onClick={onFinish}>
          {t('welcome.skip')}
        </button>

        {step === 0 && (
          <div className="welcome-step welcome-step-intro">
            <img src={vividIcon} alt="Vivid" className="welcome-hero-logo" width={80} height={80} />
            <h1 className="welcome-title">{t('welcome.title')}</h1>
            <p className="welcome-subtitle">{t('welcome.subtitle')}</p>
          </div>
        )}

        {step === 1 && (
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

        {step === 2 && (
          <div className="welcome-step">
            <h2 className="welcome-step-title">{t('welcome.toolsTitle')}</h2>
            <p className="welcome-step-desc">{t('welcome.toolsDesc')}</p>
            <ToolsManager />
            <p className="welcome-ai-note">{t('welcome.toolsNote')}</p>
          </div>
        )}

        {step === 3 && (
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
              <button className="btn btn-secondary" onClick={back}>
                <ArrowLeft size={13} /> {t('welcome.back')}
              </button>
            )}
            {step < STEP_COUNT - 1 ? (
              <button className="btn btn-primary" onClick={next}>
                {step === 0 ? t('welcome.getStarted') : t('welcome.next')} <ArrowRight size={13} />
              </button>
            ) : (
              <button className="btn btn-primary" onClick={onFinish}>
                <Check size={13} /> {t('welcome.finish')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
