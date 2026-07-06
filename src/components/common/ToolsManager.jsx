import { useTranslation } from 'react-i18next';
import { Check, Download, Loader, Youtube, Film, RefreshCw } from 'lucide-react';
import useTools from '../../hooks/useTools';
import './ToolsManager.css';

const TOOLS = [
  { name: 'yt-dlp', icon: Youtube, descKey: 'tools.ytdlpDesc' },
  { name: 'ffmpeg', icon: Film, descKey: 'tools.ffmpegDesc' },
];

function pct(p) {
  return p?.total ? `${Math.round((p.downloaded / p.total) * 100)}%` : '0%';
}

/**
 * Status + on-demand download UI for yt-dlp and ffmpeg. Self-contained (owns
 * its useTools state) so it can drop into both the welcome flow and Settings.
 */
export default function ToolsManager() {
  const { t } = useTranslation();
  const { status, progress, downloading, error, download } = useTools();

  return (
    <div className="tools-manager">
      {TOOLS.map(({ name, icon: Icon, descKey }) => {
        const st = status[name];
        const available = st?.available;
        const source = st?.source; // 'system' | 'managed' | 'missing'
        const busy = !!downloading[name];
        const prog = progress[name];
        const failed = error?.tool === name;
        return (
          <div key={name} className="tools-row">
            <div className="tools-icon">
              <Icon size={18} strokeWidth={1.6} />
            </div>
            <div className="tools-body">
              <span className="tools-name">{name}</span>
              <span className="tools-desc">{t(descKey)}</span>
              <span className={`tools-status tools-status-${source || 'missing'}`}>
                {source === 'system' && (
                  <>
                    <Check size={12} /> {t('tools.foundSystem')}
                  </>
                )}
                {source === 'managed' && (
                  <>
                    <Check size={12} /> {t('tools.foundManaged')}
                  </>
                )}
                {(!source || source === 'missing') && <>{t('tools.notInstalled')}</>}
              </span>
              {busy && prog && (
                <div className="tools-progress-track">
                  <div className="tools-progress-fill" style={{ width: pct(prog) }} />
                </div>
              )}
              {failed && !busy && <span className="tools-error">{error.message}</span>}
            </div>
            {available ? (
              source === 'managed' && (
                <button
                  className="btn btn-secondary tools-dl-btn"
                  disabled={busy}
                  onClick={() => download(name)}
                >
                  {busy ? (
                    <>
                      <Loader size={13} className="settings-indexing-spin" />{' '}
                      {t('tools.downloading')}
                    </>
                  ) : (
                    <>
                      <RefreshCw size={13} /> {t('tools.update')}
                    </>
                  )}
                </button>
              )
            ) : (
              <button
                className="btn btn-secondary tools-dl-btn"
                disabled={busy}
                onClick={() => download(name)}
              >
                {busy ? (
                  <>
                    <Loader size={13} className="settings-indexing-spin" /> {t('tools.downloading')}
                  </>
                ) : (
                  <>
                    <Download size={13} /> {t('tools.download')}
                  </>
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
