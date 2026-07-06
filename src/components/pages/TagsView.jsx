import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tag, Search } from 'lucide-react';
import { translateTag } from '../../utils/translateTag';
import './TagsView.css';

export default function TagsView({ allItems, onTagClick }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const tags = useMemo(() => {
    const counts = {};
    for (const item of allItems) {
      for (const t of [...(item.tags || []), ...(item.auto_tags || [])]) {
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [allItems]);

  const filtered = search.trim()
    ? tags.filter((t) => t.tag.toLowerCase().includes(search.trim().toLowerCase()))
    : tags;

  return (
    <div className="tags-view">
      <div className="tags-view-header">
        <h2 className="groups-page-title">Tags</h2>
        {tags.length > 0 && (
          <span className="groups-page-subtitle">
            {tags.length} tag{tags.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {tags.length > 8 && (
        <div className="tags-view-search">
          <Search size={13} className="tags-view-search-icon" />
          <input
            className="input tags-view-search-input"
            placeholder="Filter tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="groups-page-empty">
          <h2>{tags.length === 0 ? 'No tags yet' : 'No matching tags'}</h2>
          <p>
            {tags.length === 0
              ? 'Add tags to your media in the Details panel.'
              : 'Try a different search.'}
          </p>
        </div>
      ) : (
        <div className="tags-grid">
          {filtered.map(({ tag, count }) => (
            <button
              key={tag}
              className="tag-card"
              onClick={() => onTagClick(tag)}
              title={`${count} item${count !== 1 ? 's' : ''}`}
            >
              <Tag size={13} className="tag-card-icon" />
              <span className="tag-card-name">{translateTag(tag, t)}</span>
              <span className="tag-card-count">{count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
