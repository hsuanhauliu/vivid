import { useEffect } from 'react';

/**
 * Dismiss a popover/menu/dropdown on an outside mousedown or the Escape key —
 * the pattern that was hand-rolled in Select, SortDropdown, ImportMenu,
 * ContextMenu, NotificationsPanel, SelectionBar, and the download pickers.
 *
 * @param {React.RefObject} ref       - element that defines "inside"; clicks
 *                                       within it (or its descendants) are kept.
 * @param {Function}        onDismiss - called on an outside click or Escape.
 * @param {object}  [opts]
 * @param {boolean} [opts.enabled=true] - attach listeners only while truthy
 *                                        (e.g. pass the menu's `open` state).
 * @param {boolean} [opts.escape=true]  - dismiss on the Escape key.
 * @param {boolean} [opts.outside=true] - dismiss on an outside mousedown.
 */
export default function useDismiss(
  ref,
  onDismiss,
  { enabled = true, escape = true, outside = true } = {},
) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onDismiss();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onDismiss();
    };
    if (outside) document.addEventListener('mousedown', onDown);
    if (escape) document.addEventListener('keydown', onKey);
    return () => {
      if (outside) document.removeEventListener('mousedown', onDown);
      if (escape) document.removeEventListener('keydown', onKey);
    };
  }, [ref, onDismiss, enabled, escape, outside]);
}
