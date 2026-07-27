import { useTranslation } from 'react-i18next';
import { COLLECTION_KIND_ICONS, FOLDER_ICON } from '../../utils/collectionIcons';

const KIND_ICON = { ...COLLECTION_KIND_ICONS, folder: FOLDER_ICON };

// A search text that matches a collection/playlist/folder name shows those
// as clickable rows above the media grid — clicking one navigates straight
// into it (App.jsx's handleCollectionClick/navigateToFolder), preserving
// whatever's still typed in the search box.
export default function SearchEntityMatches({ matches, onSelect }) {
  const { t } = useTranslation();
  if (matches.length === 0) return null;

  return (
    <div className="search-entity-matches">
      {matches.map((m) => {
        const Icon = KIND_ICON[m.kind] ?? FOLDER_ICON;
        return (
          <button
            key={`${m.kind}-${m.id}`}
            className="search-entity-match"
            onClick={() => onSelect(m)}
          >
            <Icon size={13} className="search-entity-match-icon" />
            <span className="search-entity-match-name">{m.name}</span>
            <span className="search-entity-match-kind">{t(`common.${m.kind}`)}</span>
            <span className="search-entity-match-count">
              {t('common.item', { count: m.count })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
