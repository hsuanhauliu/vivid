import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import './ToastStack.css';

const TYPE_ICON = {
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
};

function Toast({ toast, onDismiss }) {
  const Icon = TYPE_ICON[toast.type] ?? Info;
  const [hovered, setHovered] = useState(false);
  const remainingRef = useRef(toast.duration);
  const startedAtRef = useRef(Date.now());
  const timerRef = useRef(null);

  useEffect(() => {
    if (hovered) {
      clearTimeout(timerRef.current);
      remainingRef.current -= Date.now() - startedAtRef.current;
    } else {
      startedAtRef.current = Date.now();
      timerRef.current = setTimeout(() => onDismiss(toast.id), remainingRef.current);
    }
    return () => clearTimeout(timerRef.current);
  }, [hovered]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className={`app-toast app-toast-${toast.type}`}
      role="alert"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Icon size={14} className="app-toast-icon" />
      <span className="app-toast-msg">{toast.message}</span>
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
