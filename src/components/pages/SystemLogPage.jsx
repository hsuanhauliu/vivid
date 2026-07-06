import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, Terminal } from 'lucide-react';
import './SystemLogPage.css';

export default function SystemLogPage() {
  const { t } = useTranslation();
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const text = await invoke('get_log_content');
      setContent(text);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="system-log-page">
      <div className="system-log-header">
        <div className="system-log-title">
          <Terminal size={16} />
          {t('systemLog.title')}
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'settings-indexing-spin' : ''} />
          {t('systemLog.refresh')}
        </button>
      </div>

      <div className="page-scroll system-log-body">
        {loading && !content && <div className="system-log-empty">{t('systemLog.loading')}</div>}
        {error && (
          <div className="system-log-error">
            {t('systemLog.error')}: {error}
          </div>
        )}
        {!loading && !error && content !== null && content.trim() === '' && (
          <div className="system-log-empty">
            <p>{t('systemLog.empty')}</p>
            <p className="system-log-empty-hint">{t('systemLog.emptyHint')}</p>
          </div>
        )}
        {content && content.trim() !== '' && (
          <div className="page-panel">
            <pre className="system-log-pre">{content}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
