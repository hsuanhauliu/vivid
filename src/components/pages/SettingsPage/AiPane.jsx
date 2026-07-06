import { useTranslation } from 'react-i18next';
import { Globe, Download, Sparkles, Loader } from 'lucide-react';
import {
  useDownloadStore,
  beginModelDownload,
  endModelDownload,
  failModelDownload,
} from '../../../stores/downloadStore';
import { formatBytes } from '../../../utils/format';
import { SettingsPane, SettingsSection, ToggleSwitch } from './primitives';
import OcrSection from './OcrSection';

function ModelStatusBadge({ loading, available }) {
  if (loading)
    return (
      <span className="model-badge loading">
        <Loader size={10} className="settings-indexing-spin" /> Loading…
      </span>
    );
  if (available) return <span className="model-badge ready">● Ready</span>;
  return <span className="model-badge missing">○ Not loaded</span>;
}

export default function AiPane({
  title,
  multilingualInstalled,
  multilingualLoaded,
  multilingualLoading,
  onMultilingualToggle,
  onDownloadMultilingual,
  onIndexLibrary,
  indexing,
}) {
  const { t } = useTranslation();
  const { modelProgress: dlProgress, modelDownloading, modelError: dlError } = useDownloadStore();

  async function handleDownloadMultilingual() {
    beginModelDownload();
    try {
      await onDownloadMultilingual();
      endModelDownload();
    } catch (e) {
      failModelDownload(String(e));
    }
  }

  return (
    <SettingsPane title={title}>
      <SettingsSection title={t('settings.ai.visualAI')}>
        <div className="settings-section-body">
          <p className="settings-section-desc">{t('settings.ai.visualAIDesc')}</p>

          <div className="settings-feature-list">
            <div className="settings-feature-row">
              <Globe
                size={16}
                className="settings-row-icon"
                style={{ color: multilingualLoaded ? 'var(--accent)' : undefined, marginTop: 2 }}
              />
              <div className="settings-toggle-text">
                <span className="settings-toggle-label">
                  {t('settings.ai.visualAI')}
                  <ModelStatusBadge loading={multilingualLoading} available={multilingualLoaded} />
                  <span className="model-ram-req">{t('settings.ai.ramReqVisual')}</span>
                </span>
                <span className="settings-toggle-desc">
                  {multilingualLoaded
                    ? t('settings.ai.activeDesc')
                    : multilingualLoading
                      ? t('settings.ai.loadingDesc')
                      : multilingualInstalled
                        ? t('settings.ai.downloadedDesc')
                        : t('settings.ai.notInstalledDesc')}
                </span>
                {modelDownloading && dlProgress && (
                  <div className="model-dl-progress">
                    <span className="model-dl-file">{dlProgress.file}</span>
                    <div className="model-dl-bar-track">
                      <div
                        className="model-dl-bar-fill"
                        style={{
                          width:
                            dlProgress.total > 0
                              ? `${((dlProgress.downloaded / dlProgress.total) * 100).toFixed(0)}%`
                              : '0%',
                        }}
                      />
                    </div>
                    <span className="model-dl-bytes">
                      {formatBytes(dlProgress.downloaded)} / {formatBytes(dlProgress.total)}
                    </span>
                  </div>
                )}
                {dlError && <span className="model-dl-error">{dlError}</span>}
              </div>
              {!multilingualInstalled && !multilingualLoading ? (
                <button
                  className="btn btn-primary"
                  style={{ flexShrink: 0, marginTop: 2 }}
                  disabled={modelDownloading}
                  onClick={handleDownloadMultilingual}
                >
                  {modelDownloading ? (
                    <>
                      <Loader size={13} className="settings-indexing-spin" />{' '}
                      {t('settings.ai.downloading')}
                    </>
                  ) : (
                    <>
                      <Download size={13} /> {t('settings.ai.download')}
                    </>
                  )}
                </button>
              ) : (
                <ToggleSwitch
                  on={multilingualLoaded}
                  onToggle={onMultilingualToggle}
                  disabled={multilingualLoading}
                  title={multilingualLoading ? t('settings.ai.modelLoading') : undefined}
                />
              )}
            </div>

            {multilingualLoaded && (
              <div className="settings-feature-row">
                <div className="settings-toggle-text" style={{ gap: 4 }}>
                  <span className="settings-toggle-label">{t('settings.ai.indexLibrary')}</span>
                  <span className="settings-toggle-desc">{t('settings.ai.indexLibraryDesc')}</span>
                  {indexing && (
                    <div className="settings-indexing-status">
                      <Loader size={12} className="settings-indexing-spin" />
                      {t('settings.ai.indexingInProgress')}
                    </div>
                  )}
                </div>
                <button
                  className="btn btn-primary"
                  style={{ flexShrink: 0, marginTop: 2 }}
                  disabled={indexing}
                  onClick={onIndexLibrary}
                >
                  <Sparkles size={13} />
                  {indexing ? t('settings.ai.indexing') : t('settings.ai.indexNow')}
                </button>
              </div>
            )}
          </div>
        </div>
      </SettingsSection>

      <OcrSection />
    </SettingsPane>
  );
}
