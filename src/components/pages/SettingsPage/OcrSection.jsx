import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Loader, ScanText } from 'lucide-react';
import { SettingsSection } from './primitives';

export default function OcrSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null);

  const refresh = () =>
    invoke('get_ocr_status')
      .then(setStatus)
      .catch(() => {});

  useEffect(() => {
    refresh();
    let unlisten;
    listen('ocr-progress', ({ payload }) => {
      setProgress(payload);
      if (payload.done) {
        setScanning(false);
        setProgress(null);
        refresh();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  async function scan() {
    setScanning(true);
    setProgress(null);
    try {
      await invoke('run_ocr_all');
    } catch {
      setScanning(false);
    }
  }

  const remaining = status ? status.total - status.scanned : 0;

  return (
    <SettingsSection title={t('settings.ocr.title')}>
      <div className="settings-section-body">
        <p className="settings-section-desc">{t('settings.ocr.desc')}</p>
        <div className="settings-feature-list">
          <div className="settings-feature-row">
            <div className="settings-toggle-text">
              <span className="settings-toggle-label">{t('settings.ocr.scanLabel')}</span>
              <span className="settings-toggle-desc">
                {status
                  ? t('settings.ocr.scannedCount', { scanned: status.scanned, total: status.total })
                  : '…'}
              </span>
              {scanning && progress && (
                <div className="settings-indexing-status">
                  {t('settings.ocr.scanning', { current: progress.current, total: progress.total })}
                </div>
              )}
            </div>
            <button
              className="btn btn-primary"
              style={{ flexShrink: 0, marginTop: 2 }}
              disabled={scanning || (status && remaining === 0)}
              onClick={scan}
            >
              {scanning ? (
                <>
                  <Loader size={13} className="settings-indexing-spin" />{' '}
                  {t('settings.ocr.scanningBtn')}
                </>
              ) : (
                <>
                  <ScanText size={13} /> {t('settings.ocr.scanBtn')}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
