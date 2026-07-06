import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Smartphone, Wifi, Copy, Check, ShieldCheck } from 'lucide-react';
import Modal from '../common/Modal';
import './UploadServerModal.css';

function formatCountdown(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * "Receive from phone" — spins up a temporary LAN HTTP server (in Rust) and
 * shows a QR code + URL another device on the same network can open to upload
 * files straight into the library. The server is explicit-start, token-gated,
 * and auto-expires; closing this modal stops it.
 */
export default function UploadServerModal({ onClose }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState(null); // { url, qr_svg, port, expires_in_secs }
  const [remaining, setRemaining] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const activeRef = useRef(false); // whether a server is currently running

  const start = useCallback(async () => {
    setStarting(true);
    setError('');
    try {
      const res = await invoke('start_upload_server');
      setInfo(res);
      setRemaining(res.expires_in_secs);
      activeRef.current = true;
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  }, []);

  // Stop the server when the modal unmounts (close / quit) so it never lingers.
  useEffect(() => {
    return () => {
      if (activeRef.current) invoke('stop_upload_server').catch(() => {});
    };
  }, []);

  // Backend tells us when the server stops (manual, expiry, or error).
  useEffect(() => {
    let cancelled = false;
    let unlisten;
    listen('upload-server-stopped', () => {
      if (cancelled) return;
      activeRef.current = false;
      setInfo(null);
      setRemaining(0);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Local countdown mirror of the backend's auto-expiry timer.
  useEffect(() => {
    if (!info || remaining <= 0) return;
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [info, remaining]);

  function handleStop() {
    activeRef.current = false;
    invoke('stop_upload_server').catch(() => {});
    setInfo(null);
    setRemaining(0);
  }

  function copyUrl() {
    if (!info) return;
    navigator.clipboard?.writeText(info.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Modal wide onClose={onClose} icon={<Smartphone size={20} />} title={t('upload.title')}>
      {!info ? (
        <div className="upload-intro">
          <p className="modal-message">{t('upload.intro')}</p>
          <ul className="upload-security">
            <li>
              <ShieldCheck size={14} />
              {t('upload.secExplicit')}
            </li>
            <li>
              <ShieldCheck size={14} />
              {t('upload.secToken')}
            </li>
            <li>
              <ShieldCheck size={14} />
              {t('upload.secExpire')}
            </li>
          </ul>
          {error && <p className="modal-error">{error}</p>}
          <button className="btn btn-primary upload-start-btn" onClick={start} disabled={starting}>
            {starting ? (
              <>
                <span className="loading-dot" />
                {t('upload.starting')}
              </>
            ) : (
              <>
                <Wifi size={14} />
                {t('upload.start')}
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="upload-active">
          <div className="upload-qr" dangerouslySetInnerHTML={{ __html: info.qr_svg }} />
          <p className="upload-scan-hint">{t('upload.scanHint')}</p>

          <div className="upload-url-row">
            <span className="upload-url" title={info.url}>
              {info.url}
            </span>
            <button className="icon-btn" onClick={copyUrl} title={t('upload.copy')}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>

          <div className="upload-status-row">
            <span className="upload-countdown">
              {t('upload.expiresIn', { time: formatCountdown(remaining) })}
            </span>
            <button className="btn btn-secondary upload-stop-btn" onClick={handleStop}>
              {t('upload.stop')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
