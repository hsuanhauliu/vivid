import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Map as MapIcon, Satellite } from 'lucide-react';
import MapGL, { Marker, NavigationControl, AttributionControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import './WorldMapView.css';

// OpenFreeMap Liberty — free vector tiles, natural terrain colors (forests, water, mountains)
const TERRAIN_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// ESRI World Imagery — satellite raster expressed as a MapLibre style object (no API key)
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'satellite', type: 'raster', source: 'satellite', minzoom: 0, maxzoom: 22 }],
};

const MAP_STYLES = {
  terrain: { labelKey: 'map.mapView', icon: MapIcon, style: TERRAIN_STYLE },
  satellite: { labelKey: 'map.satelliteView', icon: Satellite, style: SATELLITE_STYLE },
};

// Web Mercator projection to pixel space at a given zoom (same projection
// the map tiles themselves use), so "40px apart" means the same thing on
// screen regardless of latitude.
function project(lat, lng, zoom) {
  const scale = 256 * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

// Greedy pixel-distance clustering: a point joins the nearest existing
// cluster within 40px (screen space, via the projection above), else starts
// a new one. Unlike fixed-origin grid binning (the previous approach), this
// has no cell-boundary alignment to trip over — the only thing that decides
// whether two points cluster is their actual on-screen distance, which
// changes smoothly and monotonically with zoom. Grid binning could flip a
// pair in or out of the same cell non-monotonically as the cell size shrank
// past their particular alignment, which is what caused clusters to visibly
// split and re-merge while zooming slowly.
const CLUSTER_PX = 40;
function clusterItems(items, zoom) {
  const clusters = [];
  for (const item of items) {
    const p = project(item.gps_lat, item.gps_lng, zoom);
    let best = null;
    let bestDist = CLUSTER_PX;
    for (const c of clusters) {
      const d = Math.hypot(p.x - c.px, p.y - c.py);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (best) {
      best.items.push(item);
      const n = best.items.length;
      best.px += (p.x - best.px) / n;
      best.py += (p.y - best.py) / n;
      best.lat += (item.gps_lat - best.lat) / n;
      best.lng += (item.gps_lng - best.lng) / n;
    } else {
      clusters.push({ px: p.x, py: p.y, lat: item.gps_lat, lng: item.gps_lng, items: [item] });
    }
  }
  return clusters.map(({ lat, lng, items: clItems }) => ({ lat, lng, items: clItems }));
}

function getTargetZoom(map, geoItems) {
  if (!map || geoItems.length === 0) return map?.getZoom() ?? 2;
  if (geoItems.length === 1) return 10;
  const lngs = geoItems.map((i) => i.gps_lng);
  const lats = geoItems.map((i) => i.gps_lat);
  const camera = map.cameraForBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: 60, maxZoom: 12 },
  );
  return camera?.zoom ?? map.getZoom();
}

function fitGeoItems(map, geoItems, animate = true) {
  if (!map || geoItems.length === 0) return;
  if (geoItems.length === 1) {
    map.flyTo({ center: [geoItems[0].gps_lng, geoItems[0].gps_lat], zoom: 10, animate });
    return;
  }
  const lngs = geoItems.map((i) => i.gps_lng);
  const lats = geoItems.map((i) => i.gps_lat);
  map.fitBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: 60, maxZoom: 12, animate },
  );
}

export default function WorldMapView({
  items,
  onOpen,
  onOpenCluster,
  showStyleToggle = true,
  simplePins = false,
}) {
  const { t } = useTranslation();
  const mapRef = useRef(null);
  const prevGeoRef = useRef(null);

  const [viewState, setViewState] = useState({ longitude: 0, latitude: 20, zoom: 2 });
  const [clusterZoom, setClusterZoom] = useState(2); // only updates when zoom gesture ends
  const [mapStyle, setMapStyle] = useState('terrain');
  const [selected, setSelected] = useState(null);
  const [selectedCluster, setSelectedCluster] = useState([]);

  const geoItems = useMemo(
    () => items.filter((i) => i.gps_lat != null && i.gps_lng != null),
    [items],
  );

  const clusters = useMemo(() => clusterItems(geoItems, clusterZoom), [geoItems, clusterZoom]);

  // Fit bounds when the item set changes (but not on every zoom/pan)
  useEffect(() => {
    if (geoItems === prevGeoRef.current) return;
    prevGeoRef.current = geoItems;
    const map = mapRef.current?.getMap();
    if (map) setClusterZoom(getTargetZoom(map, geoItems));
    fitGeoItems(map, geoItems, true);
  }, [geoItems]);

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    setClusterZoom(getTargetZoom(map, geoItems));
    fitGeoItems(map, geoItems, false);
    prevGeoRef.current = geoItems;

    // MapLibre's compact attribution starts expanded (it only *toggles*
    // between expanded/collapsed on click, it doesn't default to collapsed)
    // — collapse it immediately so the credit text isn't shown until the
    // user actually asks for it.
    const attrib = map
      ?.getContainer()
      .querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show');
    attrib?.querySelector('.maplibregl-ctrl-attrib-button')?.click();
  }, [geoItems]);

  return (
    <div className="world-map-container">
      <MapGL
        ref={mapRef}
        {...viewState}
        onMove={(e) => setViewState(e.viewState)}
        onZoomEnd={(e) => setClusterZoom(e.viewState.zoom)}
        onLoad={handleMapLoad}
        mapStyle={MAP_STYLES[mapStyle].style}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        onClick={() => setSelected(null)}
      >
        <NavigationControl position="bottom-right" showCompass={false} />
        <AttributionControl compact position="bottom-left" />

        {clusters.map(({ lat, lng, items: clItems }) => {
          const first = clItems[0];
          const count = clItems.length;
          if (simplePins) {
            return (
              <Marker key={`${lat},${lng}`} latitude={lat} longitude={lng} anchor="center">
                <div className="map-simple-pin" />
              </Marker>
            );
          }
          return (
            <Marker
              key={`${lat},${lng}`}
              latitude={lat}
              longitude={lng}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setSelected(first);
                setSelectedCluster(clItems);
              }}
            >
              <div className="map-thumb-outer">
                {count > 1 && <div className="map-cluster-badge">{count}</div>}
                <div
                  className={`map-thumb-wrap${first.media_type !== 'image' ? ' map-thumb-generic' : ''}`}
                >
                  {first.media_type === 'image' ? (
                    <img src={convertFileSrc(first.file_path)} alt="" />
                  ) : (
                    <span>{first.media_type === 'video' ? '🎬' : '🎵'}</span>
                  )}
                </div>
              </div>
            </Marker>
          );
        })}
      </MapGL>

      {/* Style toggle */}
      {showStyleToggle && (
        <div className="map-style-toggle">
          {Object.entries(MAP_STYLES).map(([key, { labelKey, icon: Icon }]) => (
            <button
              key={key}
              className={`map-style-btn${mapStyle === key ? ' active' : ''}`}
              onClick={() => setMapStyle(key)}
            >
              <Icon size={11} />
              {t(labelKey)}
            </button>
          ))}
        </div>
      )}

      {geoItems.length === 0 && (
        <div className="world-map-empty">
          <span>📍</span>
          <p>{t('map.empty')}</p>
          <p className="world-map-empty-sub">{t('map.emptyHint')}</p>
        </div>
      )}

      {selected && (
        <div
          className="map-item-card"
          onClick={() =>
            selectedCluster.length > 1 ? onOpenCluster?.(selectedCluster) : onOpen(selected)
          }
          onMouseDown={(e) => e.stopPropagation()}
        >
          {selected.media_type === 'image' && (
            <img src={convertFileSrc(selected.file_path)} className="map-item-thumb" alt="" />
          )}
          <div className="map-item-info">
            <p className="map-item-name">{selected.display_name}</p>
            <p className="map-item-coords">
              {selected.gps_lat.toFixed(4)}°, {selected.gps_lng.toFixed(4)}°
            </p>
            <p className="map-item-hint">
              {selectedCluster.length > 1
                ? t('map.clusterHint', { count: selectedCluster.length })
                : t('map.clickToOpen')}
            </p>
          </div>
          <button
            className="map-item-close"
            onClick={(e) => {
              e.stopPropagation();
              setSelected(null);
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
