import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertCircle, Info, Trash2, Bell, MessageSquare, X } from 'lucide-react';
import Modal from '../common/Modal';
import './SystemMessagesPage.css';

function formatFullTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dateBucket(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return 'thisWeek';
  return 'older';
}

const BUCKET_ORDER = ['today', 'yesterday', 'thisWeek', 'older'];

const TYPE_CONFIG = {
  success: { Icon: CheckCircle, colorClass: 'notif-success' },
  error: { Icon: AlertCircle, colorClass: 'notif-error' },
  info: { Icon: Info, colorClass: 'notif-info' },
};

export default function SystemMessagesPage({
  notifications: allNotifications,
  onRemoveOne,
  onClear,
}) {
  const { t } = useTranslation();
  const [confirmClear, setConfirmClear] = useState(false);
  // The page is for warnings/errors only — never routine success confirmations.
  const notifications = allNotifications.filter((n) => n.type !== 'success');
  const unread = notifications.filter((n) => !n.read).length;

  const grouped = notifications.reduce((acc, n) => {
    const bucket = dateBucket(n.time);
    if (!acc[bucket]) acc[bucket] = [];
    acc[bucket].push(n);
    return acc;
  }, {});

  const subtitle =
    notifications.length === 0
      ? t('sysmsgs.noMessages')
      : [
          t('sysmsgs.subtitle', { count: notifications.length }),
          unread > 0 ? t('sysmsgs.unread', { count: unread }) : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <div className="sysmsgs-page">
      <div className="sysmsgs-page-header">
        <div className="sysmsgs-header-left">
          <div className="sysmsgs-header-icon">
            <Bell size={20} />
          </div>
          <div>
            <h2 className="sysmsgs-title">{t('sysmsgs.title')}</h2>
            <p className="sysmsgs-subtitle">{subtitle}</p>
          </div>
        </div>
        {notifications.length > 0 && (
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmClear(true)}>
            <Trash2 size={13} /> {t('sysmsgs.clearAll')}
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="sysmsgs-empty-state">
          <div className="sysmsgs-empty-icon">
            <MessageSquare size={48} strokeWidth={1} />
          </div>
          <h3>{t('sysmsgs.noSysmsgs')}</h3>
          <p>{t('sysmsgs.noSysmsgsDesc')}</p>
        </div>
      ) : (
        <div className="page-scroll">
          <div className="page-panel sysmsgs-feed">
            {BUCKET_ORDER.filter((b) => grouped[b]).map((bucket) => (
              <div key={bucket} className="sysmsgs-date-group">
                <div className="sysmsgs-date-label">{t(`sysmsgs.${bucket}`)}</div>
                <div className="sysmsgs-date-items">
                  {grouped[bucket].map((n) => {
                    const { Icon, colorClass } = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.info;
                    return (
                      <div
                        key={n.id}
                        className={`sysmsgs-item ${n.read ? '' : 'unread'} ${colorClass}`}
                      >
                        <div className="sysmsgs-item-icon">
                          <Icon size={15} />
                        </div>
                        <div className="sysmsgs-item-body">
                          <p className="sysmsgs-item-msg">{n.message}</p>
                          <time className="sysmsgs-item-time" title={formatFullTime(n.time)}>
                            {formatFullTime(n.time)}
                          </time>
                        </div>
                        {!n.read && <span className="sysmsgs-unread-dot" />}
                        <button
                          className="sysmsgs-archive-btn"
                          onClick={() => onRemoveOne(n.id)}
                          title={t('sysmsgs.archive')}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmClear && (
        <Modal header={false} onClose={() => setConfirmClear(false)} width={340}>
          <div className="modal-confirm">
            <div className="modal-confirm-icon modal-confirm-icon-danger">
              <Trash2 size={20} />
            </div>
            <h3 className="modal-confirm-title">{t('sysmsgs.clearAllConfirm')}</h3>
            <p className="modal-confirm-desc">{t('sysmsgs.clearAllConfirmDesc')}</p>
            <div className="modal-confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmClear(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  setConfirmClear(false);
                  onClear();
                }}
              >
                {t('sysmsgs.clearAll')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
