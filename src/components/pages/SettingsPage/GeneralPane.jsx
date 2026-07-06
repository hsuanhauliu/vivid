import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ExternalLink, Sparkles } from 'lucide-react';
import ToolsManager from '../../common/ToolsManager';
import Select from '../../common/Select';
import { SettingsPane, SettingsSection, SettingRow } from './primitives';
import { LANGUAGES, HOME_PAGE_OPTIONS } from './constants';

export default function GeneralPane({
  title,
  homePage,
  onHomePageChange,
  onViewSystemMessages,
  onViewLog,
  onReplayWelcome,
}) {
  const { t, i18n } = useTranslation();
  const [lang, setLang] = useState(localStorage.getItem('vivid-language') || '');

  function changeLang(value) {
    setLang(value);
    if (value === '') {
      localStorage.removeItem('vivid-language');
      i18n.changeLanguage(navigator.language);
    } else {
      localStorage.setItem('vivid-language', value);
      i18n.changeLanguage(value);
    }
  }

  return (
    <SettingsPane title={title}>
      <SettingsSection title={t('settings.sections.language')}>
        <SettingRow
          icon={Globe}
          label={t('settings.appearance.language')}
          desc={t('settings.appearance.languageDesc')}
        >
          <Select
            ariaLabel={t('settings.appearance.language')}
            menuAlign="right"
            value={lang}
            onChange={changeLang}
            options={LANGUAGES.map(({ value, label, labelKey }) => ({
              value,
              label: labelKey ? t(labelKey) : label,
            }))}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings.sections.navigation')}>
        <div className="settings-section-body">
          <SettingRow
            className="settings-select-row"
            label={t('settings.general.homePage')}
            desc={t('settings.general.homePageDesc')}
          >
            <Select
              ariaLabel={t('settings.general.homePage')}
              menuAlign="right"
              value={homePage}
              onChange={onHomePageChange}
              options={HOME_PAGE_OPTIONS.map(({ value, labelKey }) => ({
                value,
                label: t(labelKey),
              }))}
            />
          </SettingRow>
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.sections.system')}>
        <SettingRow
          label={t('settings.general.syncHistory')}
          desc={t('settings.general.syncHistoryDesc')}
        >
          <button
            className="btn btn-secondary"
            onClick={onViewSystemMessages}
            style={{ flexShrink: 0 }}
          >
            <ExternalLink size={13} /> {t('settings.general.viewHistory')}
          </button>
        </SettingRow>
        <SettingRow label={t('systemLog.title')} desc={t('systemLog.emptyHint')}>
          <button className="btn btn-secondary" onClick={onViewLog} style={{ flexShrink: 0 }}>
            <ExternalLink size={13} /> {t('systemLog.title')}
          </button>
        </SettingRow>
        <SettingRow
          label={t('settings.general.welcomeTour')}
          desc={t('settings.general.welcomeTourDesc')}
        >
          <button className="btn btn-secondary" onClick={onReplayWelcome} style={{ flexShrink: 0 }}>
            <Sparkles size={13} /> {t('settings.general.replayWelcome')}
          </button>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings.sections.mediaTools')}>
        <p className="settings-section-subtitle">{t('settings.general.mediaToolsDesc')}</p>
        <div className="settings-section-body">
          <ToolsManager />
        </div>
      </SettingsSection>
    </SettingsPane>
  );
}
