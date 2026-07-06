import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownUp, ChevronDown, Check, ListChecks } from 'lucide-react';
import { SORT_OPTIONS } from '../../utils/sort';
import useDismiss from '../../hooks/useDismiss';
import './SortDropdown.css';

export default function SortDropdown({ value, onChange, allowManual = false, onSaveManualOrder }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const options = allowManual ? SORT_OPTIONS : SORT_OPTIONS.filter((o) => o.value !== 'manual');
  const current = options.find((o) => o.value === value) ?? options[0];

  useDismiss(ref, () => setOpen(false), { enabled: open, escape: false });

  return (
    <div className="sort-dd" ref={ref}>
      <button className="sort-dd-btn" onClick={() => setOpen((v) => !v)}>
        <ArrowDownUp size={11} />
        <span>{t(current.labelKey)}</span>
        <ChevronDown
          size={10}
          style={{
            transition: 'transform 0.15s',
            transform: open ? 'rotate(180deg)' : 'none',
            flexShrink: 0,
          }}
        />
      </button>
      {open && (
        <div className="sort-dd-menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              className={`sort-dd-item ${opt.value === value ? 'active' : ''}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <span>{t(opt.labelKey)}</span>
              {opt.value === value && <Check size={11} />}
            </button>
          ))}
          {allowManual && onSaveManualOrder && (
            <>
              <div className="sort-dd-sep" />
              <button
                className="sort-dd-item sort-dd-action"
                onClick={() => {
                  setOpen(false);
                  onSaveManualOrder();
                }}
              >
                <ListChecks size={12} />
                <span>{t('sort.saveAsManual')}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
