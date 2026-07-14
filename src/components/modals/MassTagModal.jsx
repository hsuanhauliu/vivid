import { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Tag, X, Plus } from 'lucide-react';
import Modal from '../common/Modal';
import './MassTagModal.css';

const MAX_SUGGESTIONS = 8;

export default function MassTagModal({ count, allItems = [], onApply, onClose }) {
  const { t } = useTranslation();
  const [tags, setTags] = useState([]);
  const [input, setInput] = useState('');
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef(null);

  // All existing tags across the library (manual + auto), for autocomplete.
  const allTags = useMemo(() => {
    const set = new Set();
    allItems.forEach((i) => {
      (i.tags || []).forEach((t) => set.add(t));
      (i.auto_tags || []).forEach((t) => set.add(t));
    });
    return [...set];
  }, [allItems]);

  // Partial-match suggestions for the current input, excluding already-added tags.
  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return allTags
      .filter((t) => t.toLowerCase().includes(q) && !tags.includes(t))
      .sort((a, b) => {
        // Prefix matches first, then alphabetical.
        const ap = a.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || a.localeCompare(b);
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [input, allTags, tags]);

  function addTag(value) {
    const t = (value ?? input).trim().toLowerCase();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setInput('');
    setActiveIdx(-1);
    inputRef.current?.focus();
  }

  function removeTag(t) {
    setTags((prev) => prev.filter((x) => x !== t));
  }

  function handleKey(e) {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(activeIdx >= 0 ? suggestions[activeIdx] : undefined);
    } else if (e.key === 'Escape' && suggestions.length) {
      e.preventDefault();
      setActiveIdx(-1);
      setInput('');
    }
  }

  return (
    <Modal
      wide
      onClose={onClose}
      icon={<Tag size={20} />}
      title={t('massTag.title', { count })}
    >
      <div className="modal-form">
        <div className="field">
          <label>{t('massTag.tagsToAdd')}</label>
          <div className="tags-wrap" style={{ marginBottom: 6 }}>
            {tags.map((tg) => (
              <span key={tg} className="tag">
                <Tag size={11} />
                {tg}
                <button className="tag-remove" onClick={() => removeTag(tg)}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="tag-input-row" style={{ position: 'relative' }}>
            <input
              ref={inputRef}
              className="input tag-input"
              placeholder={t('massTag.placeholder')}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setActiveIdx(-1);
              }}
              onKeyDown={handleKey}
              autoFocus
            />
            <button className="icon-btn" onClick={() => addTag()}>
              <Plus size={15} />
            </button>

            {suggestions.length > 0 && (
              <div className="masstag-suggestions">
                {suggestions.map((s, i) => (
                  <button
                    key={s}
                    className={`masstag-suggestion ${i === activeIdx ? 'active' : ''}`}
                    // mousedown (not click) so it fires before the input blurs
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTag(s);
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                  >
                    <Tag size={11} style={{ opacity: 0.6 }} />
                    <span className="masstag-suggestion-name">{s}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('massTag.mergeHint')}</p>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('massTag.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onApply(tags);
              onClose();
            }}
            disabled={tags.length === 0}
          >
            {t('massTag.addCount', { count: tags.length })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
