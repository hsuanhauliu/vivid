import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import './SimpleMenu.css';

/**
 * Lightweight fixed-position context menu shared by places that just need a
 * small list of actions (secondary panel collection rows, sidebar pins).
 * Dismisses on the next click or right-click anywhere else. For menus that
 * need cursor-clamping/submodes, use ContextMenu.jsx instead.
 *
 * Portals to document.body so `position: fixed` positioning is always
 * relative to the viewport, regardless of any ancestor's overflow/transform
 * (e.g. the sidebar's scrollable, overflow-clipped container).
 */
export default function SimpleMenu({ x, y, onClose, children }) {
  useEffect(() => {
    function close() {
      onClose();
    }
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="sp-ctx-menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 9999 }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
