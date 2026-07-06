import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Search, FolderOpen } from 'lucide-react';
import Modal from '../common/Modal';
import './ImagePickerModal.css';

/**
 * Pick an image from the Vivid library (used for audio cover art). Shows every
 * library image in a searchable grid, highlighting the current selection.
 * `onPick` receives the chosen item; `onBrowseFiles` (optional) offers a
 * fall-back to the system file picker for images that aren't in the library.
 */
export default function ImagePickerModal({
  allItems,
  title,
  currentPath,
  onPick,
  onClose,
  onBrowseFiles,
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const images = useMemo(() => {
    const imgs = allItems.filter((i) => i.media_type === 'image');
    const q = query.trim().toLowerCase();
    if (!q) return imgs;
    return imgs.filter(
      (i) =>
        i.display_name.toLowerCase().includes(q) ||
        i.file_name.toLowerCase().includes(q) ||
        i.tags?.some((tag) => tag.toLowerCase().includes(q)) ||
        i.auto_tags?.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [allItems, query]);

  return (
    <Modal className="cover-picker-modal" onClose={onClose} title={title}>
      <div className="cover-picker-search">
        <Search size={13} />
        <input
          className="input"
          placeholder={t('imagePicker.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {images.length === 0 ? (
        <p className="cover-picker-empty">{t('imagePicker.empty')}</p>
      ) : (
        <div className="cover-picker-grid">
          {images.map((item) => {
            const selected = currentPath && currentPath === item.file_path;
            const src = item.thumb_path
              ? convertFileSrc(item.thumb_path)
              : convertFileSrc(item.file_path);
            return (
              <div
                key={item.id}
                className={`cover-picker-cell ${selected ? 'selected' : ''}`}
                title={item.display_name}
                onClick={() => {
                  onPick(item);
                  onClose();
                }}
              >
                <img
                  src={src}
                  alt={item.display_name}
                  className="cover-picker-img"
                  loading="lazy"
                  decoding="async"
                />
                {selected && <div className="cover-picker-check">✓</div>}
              </div>
            );
          })}
        </div>
      )}

      {onBrowseFiles && (
        <div className="cover-picker-footer">
          <button className="btn btn-secondary" onClick={onBrowseFiles}>
            <FolderOpen size={13} /> {t('imagePicker.browse')}
          </button>
        </div>
      )}
    </Modal>
  );
}
