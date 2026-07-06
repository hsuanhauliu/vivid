import { useTranslation } from 'react-i18next';
import { Github, Globe } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';

const REPO_URL = 'https://github.com/hsuanhauliu/vivid';
const WEBSITE_URL = 'https://hsuanhauliu.github.io/vivid/';

export default function AboutPane() {
  const { t } = useTranslation();
  return (
    <div className="settings-section-body about-pane-body">
      <div className="about-block">
        <div className="about-logo">Vivid</div>
        <p className="about-desc">{t('settings.about.tagline')}</p>
        <div className="about-meta">
          <span>{t('settings.about.version')}</span>
          <span>{t('settings.about.built')}</span>
          <span className="about-copyright">{t('settings.about.copyright')}</span>
        </div>
        <div className="about-links">
          <button type="button" className="about-repo-link" onClick={() => openUrl(REPO_URL)}>
            <Github size={15} />
            <span>{t('settings.about.viewSource')}</span>
          </button>
          <button type="button" className="about-repo-link" onClick={() => openUrl(WEBSITE_URL)}>
            <Globe size={15} />
            <span>{t('settings.about.website')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
