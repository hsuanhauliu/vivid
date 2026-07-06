import { useState, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import useDismiss from '../../hooks/useDismiss';
import './Select.css';

/**
 * A custom dropdown that replaces the native <select> so its menu matches the
 * rest of the app (the OS-rendered <select> popup can't be themed). Options are
 * `{ value, label }` with labels already translated by the caller. `value` is
 * matched by strict equality, so an empty-string value (e.g. "system default")
 * works fine.
 */
export default function Select({
  value,
  onChange,
  options,
  className = '',
  ariaLabel,
  menuAlign = 'left',
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef(null);

  // Estimate the menu height and flip it above the trigger when there isn't
  // enough room below (e.g. the control sits near the bottom of the page).
  const openMenu = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      const estimated = Math.min(280, options.length * 34 + 8);
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropUp(spaceBelow < estimated + 12 && rect.top > spaceBelow);
    }
    setOpen((v) => !v);
  };

  useDismiss(ref, () => setOpen(false), { enabled: open });

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`vivid-select ${open ? 'open' : ''} ${className}`} ref={ref}>
      <button
        type="button"
        className="vivid-select-trigger"
        onClick={openMenu}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="vivid-select-value">{selected ? selected.label : ''}</span>
        <ChevronDown size={14} className="vivid-select-caret" />
      </button>

      {open && (
        <div
          className={`vivid-select-menu align-${menuAlign} ${dropUp ? 'drop-up' : ''}`}
          role="listbox"
        >
          {options.map((o) => (
            <button
              type="button"
              key={String(o.value)}
              role="option"
              aria-selected={o.value === value}
              className={`vivid-select-option ${o.value === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="vivid-select-option-label">{o.label}</span>
              {o.value === value && <Check size={13} className="vivid-select-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
