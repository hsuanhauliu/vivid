import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertTriangle, XCircle, Info, ChevronDown } from 'lucide-react';
import './ToastStack.css';

const TYPE_ICON = {
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
};

// Above this, the message collapses to one line behind a chevron toggle
// instead of pushing the toast tall — long messages are mostly backend
// error detail (e.g. a trim failure's stderr), useful for debugging but not
// something that should dominate a transient notification by default.
const COLLAPSE_THRESHOLD = 100;

function Toast({ toast, onDismiss }) {
  const { t } = useTranslation();
  const Icon = TYPE_ICON[toast.type] ?? Info;
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const collapsible = toast.message.length > COLLAPSE_THRESHOLD;
  const remainingRef = useRef(toast.duration);
  // Real value is always assigned by the mount-time run of the effect below
  // (hovered starts false, so the `else` branch sets it) before anything
  // ever reads it — 0 here is just a placeholder, not a real timestamp, so
  // this avoids calling the impure `Date.now()` during render itself.
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);

  // Pause the auto-dismiss timer on hover, resume with whatever time was left.
  // Deliberately only depends on `hovered` — `toast.id`/`toast.duration` are
  // fixed for this Toast instance's whole lifetime (a new toast is a new key,
  // never a prop update), and `onDismiss` is stable, so re-running on those
  // would just restart the same timer for no reason.
  useEffect(() => {
    if (hovered) {
      clearTimeout(timerRef.current);
      remainingRef.current -= Date.now() - startedAtRef.current;
    } else {
      startedAtRef.current = Date.now();
      timerRef.current = setTimeout(() => onDismiss(toast.id), remainingRef.current);
    }
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered]);

  return (
    <div
      className={`app-toast app-toast-${toast.type}`}
      role="alert"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Icon size={14} className="app-toast-icon" />
      <span className={`app-toast-msg${collapsible && !expanded ? ' app-toast-msg-clamped' : ''}`}>
        {toast.message}
      </span>
      {collapsible && (
        <button
          className="app-toast-expand"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? t('common.showLess') : t('common.showMore')}
        >
          <ChevronDown size={13} className={expanded ? 'app-toast-expand-open' : ''} />
        </button>
      )}
      <button className="app-toast-close" onClick={() => onDismiss(toast.id)}>
        <X size={12} />
      </button>
    </div>
  );
}

export default function ToastStack({ toasts, onDismiss, raised = false }) {
  if (toasts.length === 0) return null;
  // Portals to document.body so it always renders above app content — including
  // the fullscreen video player, which is its own fixed-position stacking
  // context — regardless of z-index math or ancestor stacking quirks.
  return createPortal(
    <div className={`app-toast-stack${raised ? ' app-toast-stack-raised' : ''}`}>
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}
