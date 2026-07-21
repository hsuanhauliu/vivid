import { CheckCircle, AlertCircle, Info, ExternalLink } from 'lucide-react';
import { useMemo, useRef } from 'react';
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
  triggerRef,
}) {
  const { t } = useTranslation();
  const ref = useRef(null);
  // Warnings/errors only — drop routine success confirmations.
  const notifications = allNotifications.filter((n) => n.type !== 'success');

  // Also treat the toggle button (the bell) as "inside" — otherwise its own
  // mousedown fires as an outside click, closing the panel a beat before its
  // onClick re-opens it, which looks like clicking the bell while the panel
  // is open does nothing.
  const dismissRefs = useMemo(() => [ref, triggerRef], [triggerRef]);
  useDismiss(dismissRefs, onClose);

  return (
    <div className="notif-panel" ref={ref}>
      <div className="notif-header">
        <span className="notif-title">{t('notif.title')}</span>
        {notifications.length > 0 && (
          <button className="notif-clear-btn" onClick={onClear}>
            {t('notif.clearAll')}
          </button>
        )}
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
