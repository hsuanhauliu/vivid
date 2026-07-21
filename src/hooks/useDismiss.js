import { useEffect } from 'react';

/**
 * Dismiss a popover/menu/dropdown on an outside mousedown or the Escape key —
 * the pattern that was hand-rolled in Select, SortDropdown, ImportMenu,
 * ContextMenu, NotificationsPanel, SelectionBar, and the download pickers.
 *
 * @param {React.RefObject|React.RefObject[]} ref - element(s) that define
 *                                       "inside"; clicks within any of them
 *                                       (or their descendants) are kept. Pass
 *                                       an array when the toggle button that
 *                                       opens the menu lives outside the
 *                                       menu's own DOM subtree — otherwise
 *                                       its mousedown fires this hook's
 *                                       outside-click dismiss a beat before
 *                                       its own onClick re-opens the menu,
 *                                       which looks like clicking the toggle
 *                                       while open does nothing.
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
    const refs = Array.isArray(ref) ? ref : [ref];
    const onDown = (e) => {
      const inside = refs.some((r) => r?.current && r.current.contains(e.target));
      if (!inside) onDismiss();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, onDismiss, enabled, escape, outside]);
}
