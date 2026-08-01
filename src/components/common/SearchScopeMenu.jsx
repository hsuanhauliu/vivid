import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, Check } from 'lucide-react';
import useDismiss from '../../hooks/useDismiss';
import './SearchScopeMenu.css';

// Which MediaItem fields the keyword search checks — kept in one place so
// the toggle menu and the default (everything on) can't drift apart.
export const SEARCH_SCOPE_FIELDS = [
  { key: 'name', labelKey: 'search.scope.name' },
  { key: 'tags', labelKey: 'search.scope.tags' },
  { key: 'description', labelKey: 'search.scope.description' },
  { key: 'ocr', labelKey: 'search.scope.ocr' },
];

export const DEFAULT_SEARCH_SCOPE = Object.fromEntries(
  SEARCH_SCOPE_FIELDS.map((f) => [f.key, true]),
);

/**
 * Narrows keyword search to specific fields (name, tags, description, OCR
 * text) instead of always matching all of them. A small popover of toggles
 * next to the search bar — `scope` defaults to everything on, so this is
 * opt-in narrowing, not a mode switch. Hidden while semantic search is
 * active, since that's an AI query rather than a literal per-field match.
 */
export default function SearchScopeMenu({ scope, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), { enabled: open, escape: false });

  const allOn = SEARCH_SCOPE_FIELDS.every((f) => scope[f.key]);

  function toggle(key) {
    // Never let every field turn off — a search box that can't match
    // anything is a dead end, not a narrower search.
    const next = { ...scope, [key]: !scope[key] };
    if (SEARCH_SCOPE_FIELDS.some((f) => next[f.key])) onChange(next);
  }

  return (
    <div className="search-scope-wrap" ref={ref}>
      <button
        type="button"
        className={`icon-btn toolbar-view-btn ${!allOn || open ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={t('search.scope.title')}
      >
        <SlidersHorizontal size={14} />
      </button>
      {open && (
        <div className="search-scope-menu">
          <div className="search-scope-menu-label">{t('search.scope.title')}</div>
          {SEARCH_SCOPE_FIELDS.map(({ key, labelKey }) => (
            <button
              key={key}
              type="button"
              className="search-scope-item"
              onClick={() => toggle(key)}
            >
              <span className={`search-scope-check ${scope[key] ? 'checked' : ''}`}>
                {scope[key] && <Check size={10} strokeWidth={3} />}
              </span>
              {t(labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
