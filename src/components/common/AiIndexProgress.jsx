import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { Sparkles, X, CheckCircle, Tag } from 'lucide-react';
import { translateTag } from '../../utils/translateTag';

export default function AiIndexProgress({ onDone, onReady }) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(null);
  const [visible, setVisible] = useState(true);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // `listen()` is async — it resolves only once the event subscription is
  // actually registered on the Tauri side. If the backend work this component
  // is watching starts (and finishes) before that resolves, its "done" event
  // fires into the void and is lost (Tauri doesn't buffer/replay for late
  // subscribers), leaving this stuck showing nothing forever and the caller's
  // "indexing" state stuck true forever. `onReady` lets the caller defer
  // starting that work until the listener is confirmed live, closing the race.
  useEffect(() => {
    let cancelled = false;
    const listenPromise = listen('clip-progress', (e) => {
      setProgress(e.payload);
      if (e.payload.done) onDoneRef.current?.();
    });
    listenPromise.then(() => {
      if (!cancelled) onReadyRef.current?.();
    });
    return () => {
      cancelled = true;
      listenPromise.then((f) => f());
    };
  }, []);

  if (!visible || !progress) return null;

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  const hasTags = progress.auto_tags?.length > 0;

  return (
    <div className="ai-progress-bar">
      <Sparkles size={13} className="ai-progress-icon" />
      {progress.done ? (
        <>
          <CheckCircle size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span className="ai-progress-label">
            Indexing complete — {progress.total} item{progress.total !== 1 ? 's' : ''} indexed
          </span>
          <button className="icon-btn ai-progress-dismiss" onClick={() => setVisible(false)}>
            <X size={11} />
          </button>
        </>
      ) : (
        <>
          <div className="ai-progress-track">
            <div className="ai-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="ai-progress-info">
            <span className="ai-progress-label">
              {progress.file_name ? (
                <>
                  <span className="ai-progress-filename">{progress.file_name}</span>
                  <span className="ai-progress-count">
                    {' '}
                    · {progress.current}/{progress.total}
                  </span>
                </>
              ) : (
                `Indexing ${progress.current} / ${progress.total}`
              )}
            </span>
            {hasTags && (
              <span className="ai-progress-tags">
                <Tag size={10} />
                {progress.auto_tags
                  .slice(0, 4)
                  .map((tag) => translateTag(tag, t))
                  .join(', ')}
              </span>
            )}
          </div>
          <span className="ai-progress-pct">{pct}%</span>
        </>
      )}
    </div>
  );
}
