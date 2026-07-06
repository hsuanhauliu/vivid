import { X, CheckCircle, AlertCircle, Info, ExternalLink } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useDismiss from '../../hooks/useDismiss';
import './NotificationsPanel.css';

function typeIcon(type) {
  if (type === 'success') return <CheckCircle size={14} className="notif-icon success" />;
  if (type === 'error') return <AlertCircle size={14} className="notif-icon error" />;
  return <Info size={14} className="notif-icon info" />;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotificationsPanel({
  notifications: allNotifications,
  onClose,
  onClear,
  onViewAll,
}) {
  const { t } = useTranslation();
  const ref = useRef(null);
  // Warnings/errors only — drop routine success confirmations.
  const notifications = allNotifications.filter((n) => n.type !== 'success');

  useDismiss(ref, onClose);

  return (
    <div className="notif-panel" ref={ref}>
      <div className="notif-header">
        <span className="notif-title">{t('notif.title')}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {notifications.length > 0 && (
            <button className="notif-clear-btn" onClick={onClear}>
              {t('notif.clearAll')}
            </button>
          )}
          <button className="notif-close-btn" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="notif-list">
        {notifications.length === 0 ? (
          <div className="notif-empty">{t('notif.empty')}</div>
        ) : (
          notifications.slice(0, 10).map((n) => (
            <div key={n.id} className={`notif-item ${n.type}`}>
              {typeIcon(n.type)}
              <div className="notif-body">
                <span className="notif-msg">{n.message}</span>
                <span className="notif-time">{formatTime(n.time)}</span>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="notif-footer">
        <button
          className="notif-view-all-btn"
          onClick={() => {
            onViewAll();
            onClose();
          }}
        >
          <ExternalLink size={12} /> {t('notif.viewAll')}
        </button>
      </div>
    </div>
  );
}
