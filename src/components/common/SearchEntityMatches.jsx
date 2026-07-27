import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COLLECTION_KIND_ICONS, FOLDER_ICON } from '../../utils/collectionIcons';

const KIND_ICON = { ...COLLECTION_KIND_ICONS, folder: FOLDER_ICON };
// Fixed order, matching the primary sidebar's Album/Playlist/Folder listing.
const KIND_ORDER = [
  { kind: 'album', labelKey: 'sidebar.albums' },
  { kind: 'playlist', labelKey: 'sidebar.playlists' },
  { kind: 'folder', labelKey: 'sidebar.folders' },
];
const MAX_VISIBLE_PER_GROUP = 6;

export default function SearchEntityMatches({ matches, onSelect }) {
  const { t } = useTranslation();
  const [expandedKinds, setExpandedKinds] = useState(() => new Set());
  if (matches.length === 0) return null;

  const groups = KIND_ORDER.map(({ kind, labelKey }) => ({
    kind,
    labelKey,
    items: matches.filter((m) => m.kind === kind),
  })).filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;

  const toggleExpanded = (kind) =>
    setExpandedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  return (
    <div className="search-entity-matches">
      {groups.map(({ kind, labelKey, items }) => {
        const Icon = KIND_ICON[kind];
        const expanded = expandedKinds.has(kind);
        const visible = expanded ? items : items.slice(0, MAX_VISIBLE_PER_GROUP);
        const hiddenCount = items.length - visible.length;
        return (
          <div className="search-entity-group" key={kind}>
            <div className="search-entity-group-label">
              <Icon size={12} />
              <span>{t(labelKey)}</span>
            </div>
            <div className="search-entity-group-row">
              {visible.map((m) => (
                <button
                  key={m.id}
                  className="search-entity-match"
                  onClick={() => onSelect(m)}
                  title={m.name}
                >
                  <span className="search-entity-match-name">{m.name}</span>
                  <span className="search-entity-match-count">
                    {t('common.item', { count: m.count })}
                  </span>
                </button>
              ))}
              {hiddenCount > 0 && (
                <button
                  className="search-entity-match search-entity-match-toggle"
                  onClick={() => toggleExpanded(kind)}
                >
                  {t('search.moreMatches', { count: hiddenCount })}
                </button>
              )}
              {expanded && items.length > MAX_VISIBLE_PER_GROUP && (
                <button
                  className="search-entity-match search-entity-match-toggle"
                  onClick={() => toggleExpanded(kind)}
                >
                  {t('search.showLessMatches')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
