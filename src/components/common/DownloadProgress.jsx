import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Download, X, CheckCircle, AlertCircle } from 'lucide-react';

export default function DownloadProgress({ onDone, onError }) {
  const [jobs, setJobs] = useState({});

  useEffect(() => {
    const unlisten = listen('download-progress', (e) => {
      const p = e.payload;
      setJobs((prev) => ({ ...prev, [p.job_id]: p }));
      if (p.done) {
        if (p.error) {
          onError?.(p.error, p.label);
        } else {
          onDone?.(p.success_count, p.label);
        }
        // Auto-dismiss after 4s
        setTimeout(() => {
          setJobs((prev) => {
            const n = { ...prev };
            delete n[p.job_id];
            return n;
          });
        }, 4000);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [onDone, onError]);

  const active = Object.values(jobs);
  if (active.length === 0) return null;

  return (
    <>
      {active.map((job) => (
        <DownloadBar
          key={job.job_id}
          job={job}
          onDismiss={() =>
            setJobs((prev) => {
              const n = { ...prev };
              delete n[job.job_id];
              return n;
            })
          }
        />
      ))}
    </>
  );
}

function DownloadBar({ job, onDismiss }) {
  const indeterminate = job.total === 0;
  const pct = indeterminate ? null : Math.round((job.current / job.total) * 100);

  if (job.done) {
    return (
      <div className="ai-progress-bar">
        {job.error ? (
          <AlertCircle size={13} style={{ color: 'var(--error, #f43f5e)', flexShrink: 0 }} />
        ) : (
          <CheckCircle size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        )}
        <span className="ai-progress-label">
          {job.error
            ? `Download failed: ${job.error}`
            : job.success_count > 1
              ? `Downloaded ${job.success_count} items`
              : `Downloaded "${job.label}"`}
        </span>
        <button className="icon-btn ai-progress-dismiss" onClick={onDismiss}>
          <X size={11} />
        </button>
      </div>
    );
  }

  return (
    <div className="ai-progress-bar">
      <Download size={13} className="ai-progress-icon" />
      <div className="ai-progress-track">
        <div
          className={`ai-progress-fill${indeterminate ? ' ai-progress-indeterminate' : ''}`}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
      <div className="ai-progress-info">
        <span className="ai-progress-label">
          {job.file_name ? (
            <>
              <span className="ai-progress-filename">{job.file_name}</span>
              {job.total > 0 && (
                <span className="ai-progress-count">
                  {' '}
                  · {job.current}/{job.total}
                </span>
              )}
            </>
          ) : (
            `Downloading ${job.label}…`
          )}
        </span>
      </div>
      {pct !== null && <span className="ai-progress-pct">{pct}%</span>}
    </div>
  );
}
