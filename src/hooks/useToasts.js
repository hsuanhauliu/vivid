import { useCallback, useState } from 'react';

/**
 * Transient top toasts: a stack of self-dismissing messages for import results,
 * duplicate-name errors, and similar one-off feedback. Distinct from the
 * determinate progress bars (ongoing work) and the bell/messages page
 * (persistent background failures).
 *
 * Each toast auto-removes after `duration` ms; `showToast` returns its id so a
 * caller can dismiss it early via `dismissToast`.
 *
 * @returns {{ toasts: Array, showToast: Function, dismissToast: Function }}
 */
export default function useToasts() {
  const [toasts, setToasts] = useState([]); // [{ id, type, message, duration }]

  const dismissToast = useCallback(
    (id) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    [],
  );

  const showToast = useCallback((type, message, duration = 4500) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message, duration }]);
    return id;
  }, []);

  return { toasts, showToast, dismissToast };
}
