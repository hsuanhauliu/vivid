import { useRef, useState, useCallback } from 'react';

const INITIAL = {
  filter: 'all',
  activeTag: null,
  activeCollection: null,
  activeFolder: null,
  search: '',
  view: 'library',
};

/**
 * Browser-style back/forward navigation history. Records snapshots of the
 * view/filter state and applies them via the injected `applySnapshot` callback.
 *
 * @param {(snap: object) => void} applySnapshot - applies a recorded snapshot
 *        to the host component's state. Must be stable (wrap in useCallback).
 */
export default function useNavHistory(applySnapshot) {
  const historyRef = useRef([INITIAL]);
  const indexRef = useRef(0);
  const travelling = useRef(false); // true while applying back/forward
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  const syncButtons = useCallback(() => {
    setCanBack(indexRef.current > 0);
    setCanForward(indexRef.current < historyRef.current.length - 1);
  }, []);

  /** Record a new navigation state. Skips no-op duplicates and forward-truncates. */
  const push = useCallback(
    (snap) => {
      if (travelling.current) return;
      const history = historyRef.current;
      const idx = indexRef.current;
      const cur = history[idx];
      if (
        cur &&
        cur.filter === snap.filter &&
        cur.activeTag === snap.activeTag &&
        cur.activeCollection === snap.activeCollection &&
        cur.activeFolder === snap.activeFolder &&
        cur.search === snap.search &&
        cur.view === snap.view
      )
        return;
      historyRef.current = [...history.slice(0, idx + 1), snap];
      indexRef.current = historyRef.current.length - 1;
      syncButtons();
    },
    [syncButtons],
  );

  const travel = useCallback(
    (delta) => {
      const next = indexRef.current + delta;
      if (next < 0 || next > historyRef.current.length - 1) return;
      indexRef.current = next;
      travelling.current = true;
      applySnapshot(historyRef.current[next]);
      syncButtons();
      requestAnimationFrame(() => {
        travelling.current = false;
      });
    },
    [applySnapshot, syncButtons],
  );

  const goBack = useCallback(() => travel(-1), [travel]);
  const goForward = useCallback(() => travel(1), [travel]);

  return { canBack, canForward, push, goBack, goForward };
}
