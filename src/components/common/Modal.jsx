import { useEffect } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

/**
 * Shared modal shell: the fixed backdrop, the centered dialog box, and an
 * optional standard header (icon badge + title + close button).
 *
 * Clicking the backdrop does NOT close the modal by design — callers provide an
 * explicit close affordance. The box stops click propagation so interactions
 * inside it don't bubble to anything mounted behind the backdrop.
 *
 * Modals whose header doesn't fit the icon/title/close shape (centered confirm
 * dialogs, custom layouts) pass `header={false}` and render their own content;
 * they still get the backdrop + box wrapper.
 *
 * @param {Function} [props.onClose]   - close handler; also renders the ✕ button.
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.titleIcon] - inline icon inside the title text.
 * @param {React.ReactNode} [props.icon]       - icon shown in the round badge.
 * @param {boolean}  [props.wide]      - apply the wider `modal-wide` layout.
 * @param {string}   [props.className] - extra class(es) on the dialog box.
 * @param {number}   [props.width]     - explicit pixel width override.
 * @param {boolean}  [props.header=true]    - render the standard header.
 * @param {boolean}  [props.showClose=true] - render the ✕ close button.
 * @param {boolean}  [props.closeOnEsc=true] - close on Escape (when onClose set).
 */
export default function Modal({
  onClose,
  title,
  titleIcon,
  icon,
  wide = false,
  className = '',
  width,
  header = true,
  showClose = true,
  closeOnEsc = true,
  children,
}) {
  // Centralized Escape-to-close so every modal behaves consistently. Inner
  // handlers that want to consume Escape (e.g. cancel an inline input) should
  // call e.preventDefault() — we skip already-handled events.
  useEffect(() => {
    if (!closeOnEsc || !onClose) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeOnEsc, onClose]);

  const boxClass = ['modal', wide && 'modal-wide', className].filter(Boolean).join(' ');
  return (
    <div className="modal-backdrop">
      <div
        className={boxClass}
        onClick={(e) => e.stopPropagation()}
        style={width ? { width } : undefined}
      >
        {header && (
          <div className="modal-header" data-tauri-drag-region>
            {icon && <div className="modal-icon">{icon}</div>}
            {title != null && (
              <h2 className="modal-title">
                {titleIcon}
                {title}
              </h2>
            )}
            {showClose && onClose && (
              <button className="icon-btn modal-close" onClick={onClose}>
                <X size={16} />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
