import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import {
  X,
  Tag,
  Check,
  Plus,
  Star,
  MapPin,
  MapPinOff,
  Map as MapIcon,
  FolderInput,
  RefreshCw,
} from 'lucide-react';
import { translateTag } from '../../utils/translateTag';
import { useDisplayableSrc } from '../../hooks/useDisplayableSrc';
import { formatBytes, formatDateTime } from '../../utils/format';
import CollectionAvatar from '../common/CollectionAvatar';
import WorldMapView from '../views/WorldMapView';
import ScrollArea from '../common/ScrollArea';
import LocationPickerModal from '../modals/LocationPickerModal';
import {
  NAME_MAX_LEN,
  DESCRIPTION_MAX_LEN,
  TAG_MAX_LEN,
  MAX_TAGS,
  AUDIO_FIELD_MAX_LEN,
} from '../../utils/limits';
import './DetailPanel.css';

function MetaRow({ label, value, mono }) {
  if (!value) return null;
  return (
    <div className="meta-row">
      <span>{label}</span>
      <span className={mono ? 'meta-mono' : ''}>{value}</span>
    </div>
  );
}

function ExifSection({ meta, item, t }) {
  if (!meta) return null;

  const hasCamera = meta.camera_make || meta.camera_model;
  const cameraStr = [meta.camera_make, meta.camera_model].filter(Boolean).join(' ');
  const hasExposure = meta.focal_length || meta.aperture || meta.shutter_speed || meta.iso;

  return (
    <>
      {(meta.width || meta.height) && (
        <div className="meta-section">
          <p className="meta-section-title">{t('exif.image')}</p>
          <MetaRow
            label={t('exif.dimensions')}
            value={meta.width && meta.height ? `${meta.width} × ${meta.height}` : null}
          />
          <MetaRow label={t('exif.colorSpace')} value={meta.color_space} />
          <MetaRow label={t('exif.software')} value={meta.software} />
          <MetaRow label={t('exif.orientation')} value={meta.orientation} />
        </div>
      )}

      {(hasCamera || meta.lens_model) && (
        <div className="meta-section">
          <p className="meta-section-title">{t('exif.camera')}</p>
          <MetaRow label={t('exif.device')} value={cameraStr || null} />
          <MetaRow label={t('exif.lens')} value={meta.lens_model} />
        </div>
      )}

      {hasExposure && (
        <div className="meta-section">
          <p className="meta-section-title">{t('exif.exposure')}</p>
          <MetaRow label={t('exif.focalLength')} value={meta.focal_length} />
          <MetaRow label={t('exif.aperture')} value={meta.aperture} />
          <MetaRow label={t('exif.shutterSpeed')} value={meta.shutter_speed} />
          <MetaRow label="ISO" value={meta.iso != null ? `ISO ${meta.iso}` : null} />
          <MetaRow label={t('exif.flash')} value={meta.flash} />
        </div>
      )}

      {meta.date_taken && (
        <div className="meta-section">
          <p className="meta-section-title">{t('exif.capture')}</p>
          <MetaRow label={t('exif.dateTaken')} value={meta.date_taken} />
        </div>
      )}
    </>
  );
}

// Authoritative location UI — driven by item.gps_lat/gps_lng (synced from
// EXIF at import time for images, but also the field manual edits write to),
// unlike ExifSection's read-only display of the raw EXIF tags. Available for
// images and videos: view the pin on the full World Map, or add/adjust it
// via the map picker.
function LocationSection({ item, onViewOnMap, onOpenPicker, t }) {
  const hasGps = item.gps_lat != null && item.gps_lng != null;
  const mapPin = hasGps
    ? [
        {
          id: item.id,
          gps_lat: item.gps_lat,
          gps_lng: item.gps_lng,
          media_type: item.media_type,
          file_path: item.file_path,
          display_name: item.display_name,
        },
      ]
    : [];
  const mapsUrl = hasGps
    ? `https://www.google.com/maps?q=${item.gps_lat.toFixed(6)},${item.gps_lng.toFixed(6)}`
    : null;

  return (
    <div className="meta-section">
      <p
        className="meta-section-title"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5 }}
      >
        <span>{t('exif.location')}</span>
        <button className="icon-btn retag-btn" onClick={onOpenPicker} title={t('detail.setLocationTitle')}>
          {hasGps ? <MapPin size={12} /> : <MapPinOff size={12} />}
        </button>
      </p>

      {hasGps ? (
        <>
          <div className="meta-row meta-gps-row">
            <span>{t('exif.gps')}</span>
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="meta-gps-link">
              <MapPin size={11} />
              {item.gps_lat.toFixed(5)}, {item.gps_lng.toFixed(5)}
            </a>
          </div>
          <div className="map-view">
            <WorldMapView
              items={mapPin}
              onOpen={() => {}}
              showStyleToggle={false}
              showMapTools={false}
              simplePins
            />
          </div>
          <button className="btn btn-secondary btn-sm detail-view-on-map-btn" onClick={onViewOnMap}>
            <MapIcon size={12} /> {t('detail.viewOnMap')}
          </button>
        </>
      ) : (
        <p className="meta-empty-hint">{t('detail.noLocation')}</p>
      )}
    </div>
  );
}

function DetailPreview({ item, freshSrc }) {
  const src = useDisplayableSrc(item.file_path);
  const displaySrc = freshSrc || src;
  if (!displaySrc) return <div className="detail-preview detail-preview-loading" />;
  return (
    <div className="detail-preview">
      <img src={displaySrc} alt={item.display_name} />
    </div>
  );
}

export default function DetailPanel({
  item,
  collections,
  folders,
  allItems,
  onClose,
  onSave,
  onStarToggle,
  onRemoveAutoTag,
  onRetagImage,
  onNavigateToFolder,
  onViewOnMap,
  onSetLocation,
  freshSrc = null,
}) {
  const { t } = useTranslation();
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [dirty, setDirty] = useState(false);
  const [exifMeta, setExifMeta] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [audioArtist, setAudioArtist] = useState('');
  const [audioAlbum, setAudioAlbum] = useState('');
  const [audioTitle, setAudioTitle] = useState('');
  const [audioYear, setAudioYear] = useState('');
  const [audioTrack, setAudioTrack] = useState('');
  const [retagging, setRetagging] = useState(false);
  const [retagError, setRetagError] = useState(null);
  const [retagInfo, setRetagInfo] = useState(null);
  const [removedAutoTags, setRemovedAutoTags] = useState([]);
  const origRef = useRef(null);

  useEffect(() => {
    if (!item) return;
    const orig = {
      display_name: item.display_name,
      description: item.description,
      tags: item.tags || [],
    };
    origRef.current = orig;
    setDisplayName(orig.display_name);
    setDescription(orig.description);
    setTags(orig.tags);
    setTagInput('');
    setDirty(false);
    setConfirmDiscard(false);
    setExifMeta(null);
    setRetagging(false);
    setRetagError(null);
    setRetagInfo(null);
    setRemovedAutoTags([]);
    setShowLocationPicker(false);
    if (item.media_type === 'audio') {
      setAudioArtist(item.audio_artist ?? '');
      setAudioAlbum(item.audio_album ?? '');
      setAudioTitle(item.audio_title ?? '');
      setAudioYear(item.audio_year != null ? String(item.audio_year) : '');
      setAudioTrack(item.audio_track != null ? String(item.audio_track) : '');
    }
    if (item.media_type === 'image') {
      invoke('get_media_metadata', { filePath: item.file_path })
        .then(setExifMeta)
        .catch(console.error);
    }
  }, [item?.id]);

  // Re-sync pending auto-tag removals whenever the item's actual auto_tags
  // change from outside this pending edit (e.g. a re-tag run replaces the
  // whole list) — independent of the id-keyed effect above so it doesn't
  // clobber in-progress name/description/tags edits.
  useEffect(() => {
    setRemovedAutoTags([]);
  }, [item?.auto_tags]);

  if (!item) return null;
  const markDirty = () => setDirty(true);

  function addTag() {
    const t = tagInput.trim().toLowerCase().slice(0, TAG_MAX_LEN);
    if (t && !tags.includes(t) && tags.length < MAX_TAGS) {
      setTags([...tags, t]);
      setDirty(true);
    }
    setTagInput('');
  }
  function removeTag(tag) {
    setTags(tags.filter((t) => t !== tag));
    setDirty(true);
  }
  function markAutoTagRemoved(tag) {
    setRemovedAutoTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    setDirty(true);
  }
  function handleTagKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  }
  async function handleSave() {
    const payload = { id: item.id, display_name: displayName, description, tags };
    if (item.media_type === 'audio') {
      payload.audio_artist = audioArtist || null;
      payload.audio_album = audioAlbum || null;
      payload.audio_title = audioTitle || null;
      payload.audio_year = audioYear ? parseInt(audioYear, 10) || null : null;
      payload.audio_track = audioTrack ? parseInt(audioTrack, 10) || null : null;
    }
    await onSave(payload);
    // Applied one at a time (not in parallel) so each removal reads the
    // previous one's result rather than racing on the same DB row.
    for (const tag of removedAutoTags) {
      await onRemoveAutoTag(item.id, tag);
    }
    setRemovedAutoTags([]);
    setDirty(false);
  }
  function handleCancel() {
    if (origRef.current) {
      setDisplayName(origRef.current.display_name);
      setDescription(origRef.current.description);
      setTags(origRef.current.tags);
    }
    if (item.media_type === 'audio') {
      setAudioArtist(item.audio_artist ?? '');
      setAudioAlbum(item.audio_album ?? '');
      setAudioTitle(item.audio_title ?? '');
      setAudioYear(item.audio_year != null ? String(item.audio_year) : '');
      setAudioTrack(item.audio_track != null ? String(item.audio_track) : '');
    }
    setTagInput('');
    setRemovedAutoTags([]);
    setDirty(false);
  }
  function handleCloseAttempt() {
    if (dirty) {
      setConfirmDiscard(true);
    } else {
      onClose();
    }
  }

  const ext = item.file_name.split('.').pop()?.toUpperCase() ?? '';
  const activeCollection = collections?.find((g) => g.id === item.collection_id);
  const itemFolder = folders?.find((f) => f.id === item.folder_id);
  const visibleAutoTags = (item.auto_tags || []).filter((tag) => !removedAutoTags.includes(tag));

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <span className="detail-title">{dirty ? t('detail.editing') : t('detail.title')}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={`icon-btn star-toggle-btn ${item.starred ? 'starred' : ''}`}
            onClick={() => onStarToggle(item.id)}
            title={item.starred ? t('detail.unstar') : t('detail.star')}
          >
            <Star size={15} />
          </button>
          <button className="icon-btn" onClick={handleCloseAttempt} title={t('viewer.close')}>
            <X size={16} />
          </button>
        </div>
      </div>

      {item.media_type === 'image' && <DetailPreview item={item} freshSrc={freshSrc} />}

      <ScrollArea className="detail-body" innerClassName="detail-body-inner">
        {/* ── Editable fields ── */}
        <div className="field">
          <label>{t('detail.name')}</label>
          <input
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              markDirty();
            }}
            className="input"
            placeholder={t('detail.displayNamePlaceholder')}
            maxLength={NAME_MAX_LEN}
          />
        </div>

        <div className="field">
          <label>
            {t('detail.description')}{' '}
            <span className="field-label-count">
              ({description.length}/{DESCRIPTION_MAX_LEN})
            </span>
          </label>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              markDirty();
            }}
            className="input textarea"
            placeholder={t('detail.descPlaceholder')}
            rows={3}
            maxLength={DESCRIPTION_MAX_LEN}
          />
        </div>

        {activeCollection && (
          <div className="field">
            <label>
              {activeCollection.kind === 'album'
                ? t('detail.albumLabel')
                : activeCollection.kind === 'playlist'
                  ? t('detail.playlistLabel')
                  : t('detail.albumLabel')}
            </label>
            <div className="collection-badge">
              <CollectionAvatar
                group={activeCollection}
                allItems={allItems ?? []}
                size={22}
                radius={5}
                allowAny
              />
              <span>{activeCollection.name}</span>
            </div>
          </div>
        )}

        {itemFolder && (
          <div className="field">
            <label>{t('detail.folder')}</label>
            <div className="collection-badge">
              <FolderInput size={12} className="detail-folder-icon" />
              <span className="detail-folder-path">
                {itemFolder.rel_path.split('/').map((segment, idx, parts) => {
                  const segRelPath = parts.slice(0, idx + 1).join('/');
                  const segFolder = folders?.find((f) => f.rel_path === segRelPath);
                  return (
                    <span key={segRelPath}>
                      {idx > 0 && <span className="detail-folder-sep"> / </span>}
                      {segFolder && onNavigateToFolder ? (
                        <button
                          className="detail-folder-link"
                          onClick={() => {
                            onNavigateToFolder(segFolder.id);
                            onClose();
                          }}
                        >
                          {segment}
                        </button>
                      ) : (
                        <span>{segment}</span>
                      )}
                    </span>
                  );
                })}
              </span>
            </div>
          </div>
        )}

        <div className="field">
          <label>
            {t('detail.tags')}{' '}
            <span className="field-label-count">
              ({tags.length}/{MAX_TAGS})
            </span>
          </label>
          <div className="tags-wrap">
            {tags.map((tag) => (
              <span key={tag} className="tag">
                <Tag size={11} />
                {tag}
                <button className="tag-remove" onClick={() => removeTag(tag)}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="tag-input-row">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              className="input tag-input"
              placeholder={
                tags.length >= MAX_TAGS ? t('detail.maxTagsReached') : t('detail.addTag')
              }
              maxLength={TAG_MAX_LEN}
              disabled={tags.length >= MAX_TAGS}
            />
            <button
              className="icon-btn"
              onClick={addTag}
              title={t('detail.addTagTitle')}
              disabled={tags.length >= MAX_TAGS}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>

        {/* ── AI auto-tags ── */}
        {(item.media_type === 'image' || item.media_type === 'video') && onRetagImage && (
          <div className="meta-section">
            <p
              className="meta-section-title"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 5,
              }}
            >
              <span>{t('detail.aiTags')}</span>
              <button
                className="icon-btn retag-btn"
                disabled={retagging}
                onClick={async () => {
                  setRetagging(true);
                  setRetagError(null);
                  setRetagInfo(null);
                  try {
                    const updated = await onRetagImage(item.id);
                    if (!updated?.auto_tags?.length) {
                      setRetagInfo(t('detail.noConfidentTags'));
                    }
                  } catch (e) {
                    setRetagError(String(e));
                  } finally {
                    setRetagging(false);
                  }
                }}
                title={t('detail.retagHint')}
              >
                <RefreshCw size={12} className={retagging ? 'spin' : ''} />
              </button>
            </p>
            {retagging && <p className="retag-status">{t('detail.retagging')}</p>}
            {visibleAutoTags.length > 0 ? (
              <div className="tags-wrap">
                {visibleAutoTags.map((tag) => (
                  <span key={tag} className="tag ai-tag">
                    {translateTag(tag, t)}
                    {onRemoveAutoTag && (
                      <button
                        className="tag-remove"
                        onClick={() => markAutoTagRemoved(tag)}
                        title={t('detail.removeAiTag')}
                      >
                        <X size={10} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <p className="meta-empty-hint">{t('detail.noAiTags')}</p>
            )}
            {retagInfo && <p className="retag-status">{retagInfo}</p>}
            {retagError && <p className="retag-error">{retagError}</p>}
          </div>
        )}

        {/* ── Text in image (Vision OCR) ── */}
        {item.ocr_text?.trim() && (
          <div className="meta-section">
            <p className="meta-section-title">{t('detail.textInImage')}</p>
            <p className="ocr-text-block">{item.ocr_text}</p>
          </div>
        )}

        {/* ── Audio metadata ── */}
        {item.media_type === 'audio' && (
          <div className="meta-section">
            <p className="meta-section-title">{t('detail.musicInfo')}</p>
            <div className="dp-field-row">
              <label className="dp-field-label">{t('detail.trackTitle')}</label>
              <input
                className="input dp-field-input"
                value={audioTitle}
                placeholder={t('detail.trackTitlePlaceholder')}
                maxLength={AUDIO_FIELD_MAX_LEN}
                onChange={(e) => {
                  setAudioTitle(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
            <div className="dp-field-row">
              <label className="dp-field-label">{t('detail.artist')}</label>
              <input
                className="input dp-field-input"
                value={audioArtist}
                placeholder={t('detail.artistPlaceholder')}
                maxLength={AUDIO_FIELD_MAX_LEN}
                onChange={(e) => {
                  setAudioArtist(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
            <div className="dp-field-row">
              <label className="dp-field-label">{t('detail.album')}</label>
              <input
                className="input dp-field-input"
                value={audioAlbum}
                placeholder={t('detail.albumPlaceholder')}
                maxLength={AUDIO_FIELD_MAX_LEN}
                onChange={(e) => {
                  setAudioAlbum(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
            <div className="dp-field-row" style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label className="dp-field-label">{t('detail.year')}</label>
                <input
                  className="input dp-field-input"
                  value={audioYear}
                  placeholder={t('detail.year')}
                  type="number"
                  min={1}
                  max={9999}
                  onChange={(e) => {
                    setAudioYear(e.target.value.slice(0, 4));
                    setDirty(true);
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="dp-field-label">{t('detail.track')}</label>
                <input
                  className="input dp-field-input"
                  value={audioTrack}
                  placeholder={t('detail.track')}
                  type="number"
                  min={1}
                  max={999}
                  onChange={(e) => {
                    setAudioTrack(e.target.value.slice(0, 3));
                    setDirty(true);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── File info ── */}
        <div className="meta-section">
          <p className="meta-section-title">{t('detail.file')}</p>
          <MetaRow label={t('detail.format')} value={ext} />
          {item.media_type === 'video' && (
            <MetaRow
              label={t('exif.dimensions')}
              value={item.width && item.height ? `${item.width} × ${item.height}` : null}
            />
          )}
          <MetaRow label={t('detail.size')} value={formatBytes(item.file_size)} />
          <MetaRow label={t('detail.added')} value={formatDateTime(item.created_at)} />
          <div className="meta-row path-row">
            <span>{t('detail.path')}</span>
            <span title={item.file_path}>{item.file_path}</span>
          </div>
          {item.source_path?.startsWith('http') && (
            <div className="meta-row path-row">
              <span>{t('detail.sourceUrl')}</span>
              <a
                className="dp-source-url"
                href={item.source_path}
                title={item.source_path}
                onClick={(e) => {
                  e.preventDefault();
                  invoke('open_in_browser', { url: item.source_path }).catch(() => {});
                }}
              >
                {item.source_path}
              </a>
            </div>
          )}
        </div>

        {/* ── Location ── */}
        {(item.media_type === 'image' || item.media_type === 'video') && (
          <LocationSection
            item={item}
            onViewOnMap={() => onViewOnMap?.(item)}
            onOpenPicker={() => setShowLocationPicker(true)}
            t={t}
          />
        )}

        {/* ── EXIF metadata ── */}
        <ExifSection meta={exifMeta} item={item} t={t} />
      </ScrollArea>

      {showLocationPicker && (
        <LocationPickerModal
          item={item}
          onSave={(id, lat, lng) => onSetLocation?.(id, lat, lng)}
          onClose={() => setShowLocationPicker(false)}
        />
      )}

      {(confirmDiscard || dirty) && (
        <div className="detail-footer">
          {confirmDiscard ? (
            <>
              <span className="detail-discard-msg">{t('detail.discardMsg')}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setConfirmDiscard(false)}
                >
                  {t('detail.keep')}
                </button>
                <button
                  className="btn btn-danger-solid"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => {
                    handleCancel();
                    setConfirmDiscard(false);
                    onClose();
                  }}
                >
                  {t('detail.discard')}
                </button>
              </div>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={handleCancel}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                <Check size={14} /> {t('common.save')}
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
