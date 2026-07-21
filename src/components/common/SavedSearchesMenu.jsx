import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, BookmarkPlus, Search, X } from 'lucide-react';
import useDismiss from '../../hooks/useDismiss';
import ScrollArea from './ScrollArea';
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
  const [filter, setFilter] = useState('');
  // Tracked in JS rather than relying on CSS :hover: deleting a bookmark
  // shrinks the list and shifts the row below up into the (stationary)
  // cursor's position without a real mouseenter — WebKit doesn't recompute
  // :hover from layout changes alone, so the old row's delete button was
  // staying visible. An id that no longer matches any rendered row just
  // naturally shows nothing, which self-corrects this.
  const [hoveredId, setHoveredId] = useState(null);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), { enabled: open, escape: false });

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, current);
    setName('');
  }

  const filteredSaved = filter.trim()
    ? saved.filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : saved;

  return (
    <div className="saved-search-wrap" ref={ref}>
      <button
        type="button"
        className={`icon-btn toolbar-view-btn ${open ? 'active' : ''}`}
        onClick={() =>
          setOpen((v) => {
            if (v) setFilter('');
            return !v;
          })
        }
        title={t('search.saved.title')}
      >
        <Bookmark size={14} />
      </button>
      {open && (
        <div className="saved-search-menu">
          {saved.length > 0 && (
            <div className="saved-search-filter-row">
              <Search size={11} className="saved-search-filter-icon" />
              <input
                type="text"
                className="saved-search-filter-input"
                placeholder={t('search.saved.filterPlaceholder')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          )}
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
          <ScrollArea className="saved-search-list" innerClassName="saved-search-list-inner">
            {saved.length === 0 ? (
              <div className="saved-search-empty">{t('search.saved.empty')}</div>
            ) : filteredSaved.length === 0 ? (
              <div className="saved-search-empty">{t('search.saved.noMatches')}</div>
            ) : (
              filteredSaved.map((s) => (
                <div
                  key={s.id}
                  className="search-history-item"
                  onMouseEnter={() => setHoveredId(s.id)}
                  onMouseLeave={() => setHoveredId((id) => (id === s.id ? null : id))}
                >
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
                    className={`search-history-remove ${hoveredId === s.id ? 'visible' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setHoveredId((id) => (id === s.id ? null : id));
                      onDelete(s.id);
                    }}
                    title={t('search.saved.delete')}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
