import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import Modal from '../common/Modal';
import WorldMapView from '../views/WorldMapView';
import './LocationPickerModal.css';

export default function LocationPickerModal({ item, onSave, onClose }) {
  const { t } = useTranslation();
  const hasInitial = item.gps_lat != null && item.gps_lng != null;
  const [picked, setPicked] = useState(
    hasInitial ? { lat: item.gps_lat, lng: item.gps_lng } : null,
  );

  function handleSave() {
    onSave(item.id, picked ? picked.lat : null, picked ? picked.lng : null);
    onClose();
  }

  return (
    <Modal
      wide
      onClose={onClose}
      icon={<MapPin size={20} />}
      title={t('detail.setLocationTitle')}
    >
      <p className="location-picker-hint">{t('detail.setLocationHint')}</p>

      <div className="map-view location-picker-map">
        <WorldMapView
          items={[]}
          onOpen={() => {}}
          pickable
          showMapTools={false}
          pickedLocation={picked}
          onPick={(lat, lng) => setPicked({ lat, lng })}
          initialCenter={hasInitial ? { lat: item.gps_lat, lng: item.gps_lng } : null}
        />
      </div>

      <div className="location-picker-coords">
        {picked ? (
          <span className="location-picker-coords-value">
            <MapPin size={12} />
            {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)}
          </span>
        ) : (
          <span className="location-picker-coords-empty">{t('detail.noLocationPicked')}</span>
        )}
        {picked && (
          <button className="btn btn-secondary btn-sm" onClick={() => setPicked(null)}>
            {t('detail.clearLocation')}
          </button>
        )}
      </div>

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary" onClick={handleSave}>
          {t('common.save')}
        </button>
      </div>
    </Modal>
  );
}
