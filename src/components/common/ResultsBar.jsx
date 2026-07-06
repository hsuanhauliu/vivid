import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderPlus, ChevronDown } from 'lucide-react';
import CollectionAvatar from './CollectionAvatar';
import useDismiss from '../../hooks/useDismiss';

export default function ResultsBar({ count, compatibleCollections, allItems, onAddToCollection }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), { enabled: open, escape: false });
  return (
    <div className="results-bar">
      <span className="results-bar-count">{t('results.count', { count })}</span>
      <div className="results-bar-actions" ref={ref}>
        <button
          className="results-bar-btn"
          onClick={() => setOpen((v) => !v)}
          title={t('results.addAllTo')}
        >
          <FolderPlus size={13} /> {t('results.addAllTo')}
          <ChevronDown size={11} style={{ marginLeft: 2 }} />
        </button>
        {open && (
          <div className="results-bar-dropdown">
            {compatibleCollections.length === 0 ? (
              <div className="results-bar-empty">{t('results.noCollections')}</div>
            ) : (
              compatibleCollections.map((g) => (
                <button
                  key={g.id}
                  className="results-bar-option"
                  onClick={() => {
                    onAddToCollection(g.id);
                    setOpen(false);
                  }}
                >
                  <CollectionAvatar group={g} allItems={allItems} size={22} radius={5} />
                  {g.name}
                  <span className="results-bar-kind">{t(`common.${g.kind}`)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
