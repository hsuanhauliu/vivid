import { useState, useRef, useCallback } from 'react';

const DRAG_THRESHOLD = 6; // px of movement before a press becomes a drag

/**
 * Pointer-based "drag files onto a collection" gesture. A press that moves past
 * the threshold begins a drag; while dragging we hit-test the element under the
 * cursor for the nearest `[data-collection-id]` drop target and expose it as
 * `drag.overId` (so the sidebar / panel can highlight it). On release over a
 * target, `onDrop(items, collectionId)` fires.
 *
 * A real drag swallows the trailing click so it doesn't also open the file.
 */
export default function useCollectionDrag(onDrop) {
  const [drag, setDrag] = useState(null); // { items, x, y, overId, overFolderId } | null
  const pending = useRef(null); // { items, startX, startY }
  const dragRef = useRef(null); // mirrors `drag` for event handlers

  const beginCollectionDrag = useCallback(
    (e, items) => {
      if (e.button !== 0 || !items?.length) return;
      pending.current = { items, startX: e.clientX, startY: e.clientY };

      function hitTest(x, y) {
        const el = document.elementFromPoint(x, y);
        return {
          overId: el?.closest('[data-collection-id]')?.getAttribute('data-collection-id') ?? null,
          overFolderId: el?.closest('[data-folder-id]')?.getAttribute('data-folder-id') ?? null,
        };
      }

      function onMove(ev) {
        const p = pending.current;
        if (!p) return;
        if (!dragRef.current) {
          if (Math.hypot(ev.clientX - p.startX, ev.clientY - p.startY) < DRAG_THRESHOLD) return;
          document.body.classList.add('collection-dragging');
        }
        const next = {
          items: p.items,
          x: ev.clientX,
          y: ev.clientY,
          ...hitTest(ev.clientX, ev.clientY),
        };
        dragRef.current = next;
        setDrag(next);
      }

      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        const d = dragRef.current;
        const wasDragging = !!d;
        dragRef.current = null;
        pending.current = null;
        document.body.classList.remove('collection-dragging');
        setDrag(null);

        if (wasDragging) {
          // Suppress the click that fires after a drag so we don't open the file.
          const swallow = (ce) => {
            ce.stopPropagation();
            ce.preventDefault();
            document.removeEventListener('click', swallow, true);
          };
          document.addEventListener('click', swallow, true);
          if (d.overId || d.overFolderId)
            onDrop(d.items, { collectionId: d.overId, folderId: d.overFolderId });
        }
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [onDrop],
  );

  return { drag, beginCollectionDrag };
}
