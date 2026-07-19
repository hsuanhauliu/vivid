import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, BookmarkPlus, X } from 'lucide-react';
import useDismiss from '../../hooks/useDismiss';
import './SavedSearchesMenu.css';

/**
 * Save the current search text + search-scope toggles + filter-bar filters
 * as a named shortcut, and re-apply one later — a bookmark for a search you
 * come back to often, distinct from the auto-recorded recent-search history.
 * `hasCurrent` gates whether there's anything worth saving right now.
 */
export default function SavedSearchesMenu({
  current,
  hasCurrent,
  saved,
  onSave,
  onApply,
  onDelete,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), { enabled: open, escape: false });

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, current);
    setName('');
  }

  return (
    <div className="saved-search-wrap" ref={ref}>
      <button
        type="button"
        className="icon-btn toolbar-view-btn"
        onClick={() => setOpen((v) => !v)}
        title={t('search.saved.title')}
      >
        <Bookmark size={14} />
      </button>
      {open && (
        <div className="saved-search-menu">
          {hasCurrent && (
            <div className="saved-search-save-row">
              <input
                type="text"
                className="saved-search-name-input"
                placeholder={t('search.saved.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                }}
                autoFocus
              />
              <button
                type="button"
                className="saved-search-save-btn"
                onClick={handleSave}
                disabled={!name.trim()}
                title={t('search.saved.save')}
              >
                <BookmarkPlus size={13} />
              </button>
            </div>
          )}
          {saved.length === 0 ? (
            <div className="saved-search-empty">{t('search.saved.empty')}</div>
          ) : (
            saved.map((s) => (
              <div key={s.id} className="search-history-item">
                <button
                  type="button"
                  className="search-history-term"
                  onClick={() => {
                    onApply(s);
                    setOpen(false);
                  }}
                >
                  <Bookmark size={11} />
                  {s.name}
                </button>
                <button
                  type="button"
                  className="search-history-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                  title={t('search.saved.delete')}
                >
                  <X size={10} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
