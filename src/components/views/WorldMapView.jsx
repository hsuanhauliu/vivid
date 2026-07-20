import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import {
  Map as MapIcon,
  Satellite,
  MapPin,
  RotateCcw,
  Globe,
  Route,
  SkipBack,
  StepBack,
  StepForward,
  SkipForward,
  BoxSelect,
  EyeOff,
  Eye,
  Focus,
  ExternalLink,
} from 'lucide-react';
import MapGL, { Marker, NavigationControl, AttributionControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import useDismiss from '../../hooks/useDismiss';
import './WorldMapView.css';

// OpenFreeMap Liberty — free vector tiles, natural terrain colors (forests, water, mountains)
const TERRAIN_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// ESRI World Imagery — satellite raster expressed as a MapLibre style object
// (no API key), with ESRI's matching "reference" overlay layered on top: a
// transparent tile set of just place/country/road labels and borders, made
// specifically to sit on top of World_Imagery for a hybrid satellite+labels
// look (the same combo Google/Apple Maps' satellite mode uses).
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
    'satellite-labels': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'satellite', type: 'raster', source: 'satellite', minzoom: 0, maxzoom: 22 },
    { id: 'satellite-labels', type: 'raster', source: 'satellite-labels', minzoom: 0, maxzoom: 22 },
  ],
};

const MAP_STYLES = {
  terrain: { labelKey: 'map.mapView', icon: MapIcon, style: TERRAIN_STYLE },
  satellite: { labelKey: 'map.satelliteView', icon: Satellite, style: SATELLITE_STYLE },
};

// Fallback values used until `get_map_config` resolves (and in any context
// without a Tauri backend). Kept only as a fallback — src-tauri/src/config.rs
// is the actual source of truth; these mirror its defaults so the map still
// behaves reasonably for the one render before the async fetch lands.
const DEFAULT_MAP_CONFIG = {
  cluster_px: 40,
  fit_padding_px: 60,
  fit_max_zoom: 12,
  single_item_zoom: 10,
  focus_zoom: 12,
  world_view_zoom: 1,
  travel_path_reveal_base_ms: 1200,
  travel_path_reveal_per_stop_ms: 250,
  travel_path_reveal_max_ms: 8000,
  travel_path_dash: 2,
  travel_path_gap: 1.5,
};

// Web Mercator projection to pixel space at a given zoom (same projection
// the map tiles themselves use), so "N px apart" means the same thing on
// screen regardless of latitude.
function project(lat, lng, zoom) {
  const scale = 256 * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

// Greedy pixel-distance clustering: a point joins the nearest existing
// cluster within `clusterPx` (screen space, via the projection above), else
// starts a new one. Unlike fixed-origin grid binning (the previous
// approach), this has no cell-boundary alignment to trip over — the only
// thing that decides whether two points cluster is their actual on-screen
// distance, which changes smoothly and monotonically with zoom. Grid
// binning could flip a pair in or out of the same cell non-monotonically as
// the cell size shrank past their particular alignment, which is what
// caused clusters to visibly split and re-merge while zooming slowly.
function clusterItems(items, zoom, clusterPx) {
  const clusters = [];
  for (const item of items) {
    const p = project(item.gps_lat, item.gps_lng, zoom);
    let best = null;
    let bestDist = clusterPx;
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

// Which longitude offsets (multiples of 360°) a point at `lng` needs a
// duplicate marker at to appear in every world copy currently visible
// between `west`/`east` (from map.getBounds(), themselves unwrapped — e.g.
// -540..540 when the view spans one and a half world-widths). MapLibre's GL
// line/fill layers (the travel path) already render in every visible copy
// automatically; DOM-based <Marker>s don't, so without this a pin only ever
// shows up in one copy while its own path line shows up in all of them.
function wrapOffsetsFor(lng, west, east) {
  const kMin = Math.floor((west - lng) / 360);
  const kMax = Math.ceil((east - lng) / 360);
  const offsets = [];
  for (let k = kMin; k <= kMax; k++) offsets.push(k * 360);
  return offsets;
}

function getTargetZoom(map, geoItems, cfg) {
  if (!map || geoItems.length === 0) return map?.getZoom() ?? 2;
  if (geoItems.length === 1) return cfg.single_item_zoom;
  const lngs = geoItems.map((i) => i.gps_lng);
  const lats = geoItems.map((i) => i.gps_lat);
  const camera = map.cameraForBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: cfg.fit_padding_px, maxZoom: cfg.fit_max_zoom },
  );
  return camera?.zoom ?? map.getZoom();
}

// Great-circle distance in km — used only for relative comparisons (picking
// a constant-speed animation fraction along a route), so the exact units
// don't matter, only that segment lengths are proportional to real distance.
function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(a));
}

// Cumulative real-world distance at each point of a [lng, lat] polyline,
// index-aligned with `coords` (cumDist[i] is how far along the route
// coords[i] is). Interpolating by this instead of by segment index is what
// makes the draw-in animation move at a constant speed — segment index alone
// treats a 5km hop and a 500km hop as equally "long", so it would crawl
// through short segments and jump through long ones.
function cumulativeDistances(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    cum.push(cum[i - 1] + haversineDistance(lat1, lng1, lat2, lng2));
  }
  return cum;
}

// The point (and the index of the segment it falls in) at fraction `t`
// (0..1) of the total route distance — used to draw the travel path in below.
function positionAtFraction(coords, cumDist, t) {
  const total = cumDist[cumDist.length - 1];
  if (total === 0) return { index: 0, point: coords[0] };
  const target = Math.max(0, Math.min(total, t * total));
  let index = 0;
  while (index < cumDist.length - 2 && cumDist[index + 1] < target) index++;
  const segLen = cumDist[index + 1] - cumDist[index];
  const frac = segLen === 0 ? 0 : (target - cumDist[index]) / segLen;
  const [lng1, lat1] = coords[index];
  const [lng2, lat2] = coords[index + 1];
  return { index, point: [lng1 + (lng2 - lng1) * frac, lat1 + (lat2 - lat1) * frac] };
}

// Coordinates of the travel path revealed so far, at animation progress `t`
// (0..1 across the whole route's distance): every full segment up to `t`,
// plus the current segment interpolated up to its fractional point — this is
// what makes the line look like it's actively being drawn rather than just
// appearing.
function revealedLineCoords(coords, cumDist, t) {
  if (coords.length < 2) return coords;
  const { index, point } = positionAtFraction(coords, cumDist, t);
  return [...coords.slice(0, index + 1), point];
}

// MapLibre paint properties need a literal color, not a CSS var — read the
// user's chosen accent color (Settings > Appearance) so the path matches
// their theme instead of a hardcoded color.
function getAccentColor() {
  if (typeof document === 'undefined') return '#1d7af0';
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1d7af0'
  );
}

function fitGeoItems(map, geoItems, animate, cfg) {
  if (!map || geoItems.length === 0) return;
  if (geoItems.length === 1) {
    map.flyTo({
      center: [geoItems[0].gps_lng, geoItems[0].gps_lat],
      zoom: cfg.single_item_zoom,
      animate,
    });
    return;
  }
  const lngs = geoItems.map((i) => i.gps_lng);
  const lats = geoItems.map((i) => i.gps_lat);
  map.fitBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: cfg.fit_padding_px, maxZoom: cfg.fit_max_zoom, animate },
  );
}

export default function WorldMapView({
  items,
  onOpen,
  onOpenCluster,
  showStyleToggle = true,
  showMapTools = true,
  simplePins = false,
  focusItemId = null,
  pickable = false,
  pickedLocation = null,
  onPick = null,
  initialCenter = null,
  persistedViewState = null,
  onViewStateChange = null,
  persistedSelectedId = null,
  onSelectedChange = null,
}) {
  const { t } = useTranslation();
  const mapRef = useRef(null);
  // Fit the camera to the data only once, ever, per mount — see the effect
  // below. Not re-checked on every geoItems change: geoItems gets a new
  // array whenever a filter narrows the set (or any unrelated background
  // update touches the library), and re-fitting the camera every time that
  // happens was yanking the view around while the user was just filtering,
  // not asking to be recentered.
  const hasFitRef = useRef(false);

  const [mapConfig, setMapConfig] = useState(DEFAULT_MAP_CONFIG);
  useEffect(() => {
    invoke('get_map_config')
      .then(setMapConfig)
      .catch(() => {}); // no Tauri backend (e.g. plain browser preview) — keep defaults
  }, []);

  const [viewState, setViewState] = useState(() =>
    initialCenter
      ? {
          longitude: initialCenter.lng,
          latitude: initialCenter.lat,
          zoom: DEFAULT_MAP_CONFIG.focus_zoom,
        }
      : (persistedViewState ?? { longitude: 0, latitude: 20, zoom: 2 }),
  );
  const [clusterZoom, setClusterZoom] = useState(() => persistedViewState?.zoom ?? 2); // only updates when zoom gesture ends
  const [mapStyle, setMapStyle] = useState('terrain');
  const [selected, setSelected] = useState(null);
  const [selectedCluster, setSelectedCluster] = useState([]);
  const [travelPath, setTravelPath] = useState(false);
  const [stepIndex, setStepIndex] = useState(null);

  // ── Multi-select (marquee-drag / ctrl-click) to show/hide pins from the
  // current view — client-side only, never persisted or sent to the
  // backend. `hiddenIds` removes items from geoItems (and therefore from
  // clustering) entirely; `selectedIds` is just the highlight ring shown
  // while picking what to hide next.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  const [dragBox, setDragBox] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);

  const toggleSelectMode = useCallback(() => {
    setSelectMode((v) => {
      const next = !v;
      if (!next) {
        setSelectedIds(new Set());
        setContextMenu(null);
      }
      return next;
    });
  }, []);

  const showAllHidden = useCallback(() => setHiddenIds(new Set()), []);

  const geoItems = useMemo(
    () => items.filter((i) => i.gps_lat != null && i.gps_lng != null && !hiddenIds.has(i.id)),
    [items, hiddenIds],
  );

  const clusters = useMemo(
    () => clusterItems(geoItems, clusterZoom, mapConfig.cluster_px),
    [geoItems, clusterZoom, mapConfig.cluster_px],
  );
  // Read by the marquee-drag mouseup handler below via ref, not as an effect
  // dependency — clusters gets a new array on every pan/zoom and the drag
  // effect only needs to (re)attach when selectMode toggles, not on that.
  const clustersRef = useRef(clusters);
  useEffect(() => {
    clustersRef.current = clusters;
  }, [clusters]);

  // Visible longitude range (unwrapped — e.g. -540..540 when zoomed out far
  // enough to see more than one world copy), recomputed on every pan/zoom.
  // Feeds wrapOffsetsFor() below to duplicate pins into every visible copy,
  // matching how the travel path's line layer already renders in all of
  // them automatically.
  const worldBounds = useMemo(() => {
    const map = mapRef.current?.getMap();
    if (!map) return null;
    const b = map.getBounds();
    return { west: b.getWest(), east: b.getEast() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewState]);

  // Restore the marker selected before navigating away (e.g. into
  // FileViewer), once, on mount — skipped when a specific item is being
  // focused instead (see handleMapLoad's focusTarget branch, which owns
  // selection in that case).
  useEffect(() => {
    if (focusItemId || !persistedSelectedId) return;
    const cluster = clusters.find((c) => c.items.some((i) => i.id === persistedSelectedId));
    if (cluster) {
      setSelected(cluster.items.find((i) => i.id === persistedSelectedId) ?? cluster.items[0]);
      setSelectedCluster(cluster.items);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectMarker = useCallback(
    (item, clItems) => {
      setSelected(item);
      setSelectedCluster(clItems);
      onSelectedChange?.(item.id);
    },
    [onSelectedChange],
  );

  const deselect = useCallback(() => {
    setSelected(null);
    onSelectedChange?.(null);
  }, [onSelectedChange]);

  // Fit bounds once, the first time real geo data is available — whether
  // that's right away or, if items are still loading, whenever they arrive.
  // Never again automatically after that (see hasFitRef above). Skipped
  // when a specific item is being focused, a persisted view is being
  // restored, or an initialCenter was given — those own the camera instead,
  // but still count as "handled" so this doesn't try to fit later too.
  useEffect(() => {
    if (hasFitRef.current || geoItems.length === 0) return;
    if (focusItemId) return; // handleMapLoad owns this (or a later run once unfocused)
    if (persistedViewState || initialCenter) {
      hasFitRef.current = true;
      return;
    }
    hasFitRef.current = true;
    const map = mapRef.current?.getMap();
    if (map) setClusterZoom(getTargetZoom(map, geoItems, mapConfig));
    fitGeoItems(map, geoItems, true, mapConfig);
  }, [geoItems, focusItemId, persistedViewState, initialCenter, mapConfig]);

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    const focusTarget = focusItemId ? geoItems.find((i) => i.id === focusItemId) : null;
    if (focusTarget) {
      map?.jumpTo({
        center: [focusTarget.gps_lng, focusTarget.gps_lat],
        zoom: mapConfig.focus_zoom,
      });
      setClusterZoom(mapConfig.focus_zoom);
      selectMarker(focusTarget, [focusTarget]);
      hasFitRef.current = true;
    } else if (persistedViewState) {
      setClusterZoom(persistedViewState.zoom);
      hasFitRef.current = true;
    } else if (initialCenter) {
      hasFitRef.current = true;
    } else if (geoItems.length > 0) {
      setClusterZoom(getTargetZoom(map, geoItems, mapConfig));
      fitGeoItems(map, geoItems, false, mapConfig);
      hasFitRef.current = true;
    }

    // MapLibre's compact attribution starts expanded (it only *toggles*
    // between expanded/collapsed on click, it doesn't default to collapsed)
    // — collapse it immediately so the credit text isn't shown until the
    // user actually asks for it.
    const attrib = map
      ?.getContainer()
      .querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show');
    attrib?.querySelector('.maplibregl-ctrl-attrib-button')?.click();
  }, [geoItems, focusItemId, initialCenter, persistedViewState, selectMarker, mapConfig]);

  // ── Feature menu: reset / world view / travel path ──────────────────────
  const handleResetView = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) setClusterZoom(getTargetZoom(map, geoItems, mapConfig));
    fitGeoItems(map, geoItems, true, mapConfig);
  }, [geoItems, mapConfig]);

  const handleWorldView = useCallback(() => {
    mapRef.current
      ?.getMap()
      ?.flyTo({ center: [0, 20], zoom: mapConfig.world_view_zoom, animate: true });
    setClusterZoom(mapConfig.world_view_zoom);
  }, [mapConfig]);

  // Travel path stops = the same clusters shown as pins, oldest first (each
  // stop's "when" is the earliest taken-date among its items). Deriving the
  // line from `clusters` rather than raw geoItems is what keeps it visually
  // consistent with the pins — clusters group nearby points at the current
  // zoom, so a line drawn through raw un-clustered coordinates would often
  // cut through the middle of a pin instead of terminating exactly on it.
  const pathStops = useMemo(() => {
    return clusters
      .map((c) => {
        const dated = c.items.filter((i) => i.date_taken || i.created_at);
        if (dated.length === 0) return null;
        const earliest = dated.reduce(
          (min, i) => Math.min(min, new Date(i.date_taken || i.created_at).getTime()),
          Infinity,
        );
        return { gps_lat: c.lat, gps_lng: c.lng, items: c.items, date: earliest };
      })
      .filter(Boolean)
      .sort((a, b) => a.date - b.date);
  }, [clusters]);
  const pathCoords = useMemo(() => pathStops.map((s) => [s.gps_lng, s.gps_lat]), [pathStops]);
  const pathCumDist = useMemo(() => cumulativeDistances(pathCoords), [pathCoords]);
  // Read by the animation loop below via ref rather than as an effect
  // dependency — `items` (and everything derived from it: geoItems,
  // clusters, pathStops, pathCoords) gets a new array reference on every
  // background event (thumbnail/OCR/AI-tag completion, etc.) even when
  // nothing relevant to the map changed, and putting pathCoords in that
  // effect's deps meant it tore down and rebuilt the whole maplibre
  // layer — visible as constant flashing — on every one of those unrelated
  // updates.
  const pathCoordsRef = useRef(pathCoords);
  const pathCumDistRef = useRef(pathCumDist);
  useEffect(() => {
    pathCoordsRef.current = pathCoords;
    pathCumDistRef.current = pathCumDist;
  }, [pathCoords, pathCumDist]);

  const toggleTravelPath = useCallback(() => {
    setTravelPath((v) => {
      setStepIndex(null);
      return !v;
    });
  }, []);

  // Draw the travel path in from the first stop to the last — the line
  // itself moving toward each next destination is what shows the direction
  // of travel. Redraws (with a fresh draw-in) whenever the stops actually
  // change, e.g. a cluster splitting into two on zoom, not just when
  // toggled on.
  //
  // Manages its own maplibre source/layer entirely imperatively (addSource/
  // addLayer/setData) instead of via react-map-gl's declarative <Source>/
  // <Layer> components, which subscribe to the map's 'styledata' event
  // internally and force their own re-render/reconciliation pass whenever it
  // fires — and setData fires 'styledata' itself, so driving it through
  // those components at animation-frame rate fed back into their own
  // reconciliation and raced with it. The only listener left on 'styledata'
  // here is a cheap recovery check (re-adds the layer if a base-style switch
  // wiped it), which doesn't touch React state and so can't cause that.
  //
  // Deliberately depends only on [travelPath, mapConfig] — NOT on
  // pathCoords/pathCumDist, which are read fresh via the refs above instead.
  // Restarting this whole effect (tear down + rebuild the maplibre layer)
  // every time those change reference was the other half of the original
  // flashing bug: they get a new array on every unrelated background update
  // (thumbnail/OCR/AI-tag completion, etc.), not just when the path itself
  // actually changes.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !travelPath) return undefined;

    const SOURCE_ID = 'travel-path';
    const LAYER_ID = 'travel-path-line';
    const { travel_path_dash: dash, travel_path_gap: gap } = mapConfig;

    const ensureLayer = () => {
      const coords = pathCoordsRef.current;
      if (coords.length < 2 || map.getSource(SOURCE_ID) || !map.isStyleLoaded()) return;
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [coords[0], coords[0]] },
        },
      });
      map.addLayer({
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': getAccentColor(),
          'line-width': 2.5,
          'line-opacity': 0.85,
          'line-dasharray': [dash, gap],
        },
      });
    };
    ensureLayer();
    map.on('styledata', ensureLayer); // re-add after a base-style switch wipes it

    let raf;
    let start = null; // (re)set whenever the stops actually change — see below
    let lastCoordsKey = null; // value snapshot of the stops last drawn
    const tick = (now) => {
      const coords = pathCoordsRef.current;
      const cumDist = pathCumDistRef.current;
      if (coords.length < 2) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (!map.getSource(SOURCE_ID)) ensureLayer();

      // pathCoords gets a new array *reference* on every background update
      // (thumbnail/OCR/AI-tag completion, etc.) even when the stops
      // themselves haven't changed — comparing by value is what tells a real
      // change (e.g. a cluster splitting into two on zoom) apart from that
      // noise, so the line only redraws when it actually needs to.
      const coordsKey = JSON.stringify(coords);
      const changed = coordsKey !== lastCoordsKey;
      if (changed) {
        start = now;
        lastCoordsKey = coordsKey;
      }

      const revealDuration = Math.min(
        mapConfig.travel_path_reveal_base_ms +
          coords.length * mapConfig.travel_path_reveal_per_stop_ms,
        mapConfig.travel_path_reveal_max_ms,
      );
      const t = Math.min(1, (now - start) / revealDuration);
      if (changed || t < 1) {
        const source = map.getSource(SOURCE_ID);
        if (source) {
          source.setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: revealedLineCoords(coords, cumDist, t) },
          });
        }
      }
      // Keep the loop alive even once fully drawn — cheap when idle (just the
      // coordsKey check above), and it's what lets a later re-cluster (or a
      // brand new trip after toggling off and back on) redraw the line
      // without needing to tear down and rebuild the whole layer.
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      map.off('styledata', ensureLayer);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [travelPath, mapConfig]);

  // Step through the trip's stops one at a time, in the same taken-date order
  // the path itself is drawn in — flies to each stop and selects it so the
  // existing item card shows its thumbnail/name and "Click to open".
  const stepTo = useCallback(
    (idx) => {
      if (idx < 0 || idx >= pathStops.length) return;
      const stop = pathStops[idx];
      setStepIndex(idx);
      selectMarker(stop.items[0], stop.items);
      // Pan only — don't change zoom. pathStops are clusters at the current
      // zoom level; zooming in here would immediately split the very
      // cluster just stepped to into several separate pins, since
      // clustering is pixel-distance-based and re-forms at every zoom.
      // Staying at the same zoom keeps what's stepped through consistent
      // with what's drawn on screen.
      mapRef.current?.getMap()?.flyTo({ center: [stop.gps_lng, stop.gps_lat], animate: true });
    },
    [pathStops, selectMarker],
  );
  const stepFirst = useCallback(() => stepTo(0), [stepTo]);
  const stepLast = useCallback(() => stepTo(pathStops.length - 1), [stepTo, pathStops.length]);
  const stepBack = useCallback(
    () => stepTo((stepIndex ?? pathStops.length) - 1),
    [stepIndex, pathStops.length, stepTo],
  );
  const stepForward = useCallback(() => stepTo((stepIndex ?? -1) + 1), [stepIndex, stepTo]);

  // While a selection is highlighted, Escape clears it first; pressed again
  // (nothing left highlighted) it drops out of select mode entirely.
  useEffect(() => {
    if (!selectMode) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setSelectedIds((prev) => {
        if (prev.size > 0) return new Set();
        setSelectMode(false);
        return prev;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMode]);

  // OS-folder-style marquee select: click-drag on empty map background draws
  // a rectangle, and on release every pin whose projected screen position
  // falls inside it gets selected. Implemented on the raw maplibre map
  // instance (not React DOM handlers) so hit-testing can use map.project(),
  // and gated to only attach while select mode is on — dragPan/dragRotate
  // are disabled for that duration so a drag reliably means "select", not
  // "pan the camera". Holding ctrl/cmd at drag-start adds to the existing
  // selection instead of replacing it, matching ctrl-click below.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !selectMode) return undefined;
    map.dragPan.disable();
    map.dragRotate.disable();

    let dragging = false;
    let start = null;
    let additive = false;

    const onDown = (e) => {
      if (e.originalEvent.button !== 0) return; // left button only
      dragging = true;
      additive = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
      start = e.point;
      setDragBox({ x0: e.point.x, y0: e.point.y, x1: e.point.x, y1: e.point.y });
    };
    const onMoveMap = (e) => {
      if (!dragging) return;
      setDragBox((prev) => (prev ? { ...prev, x1: e.point.x, y1: e.point.y } : prev));
    };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      const { x: ex, y: ey } = e.point;
      const minX = Math.min(start.x, ex);
      const maxX = Math.max(start.x, ex);
      const minY = Math.min(start.y, ey);
      const maxY = Math.max(start.y, ey);
      setDragBox(null);
      if (maxX - minX < 4 && maxY - minY < 4) {
        // Negligible movement — treat as a plain click on empty space
        // (Finder-style: clears the current selection).
        if (!additive) setSelectedIds(new Set());
        return;
      }
      const hitIds = new Set();
      for (const c of clustersRef.current) {
        const p = map.project([c.lng, c.lat]);
        if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
          for (const it of c.items) hitIds.add(it.id);
        }
      }
      setSelectedIds((prev) => {
        if (!additive) return hitIds;
        const next = new Set(prev);
        hitIds.forEach((id) => next.add(id));
        return next;
      });
    };

    map.on('mousedown', onDown);
    map.on('mousemove', onMoveMap);
    map.on('mouseup', onUp);
    return () => {
      map.dragPan.enable();
      map.dragRotate.enable();
      map.off('mousedown', onDown);
      map.off('mousemove', onMoveMap);
      map.off('mouseup', onUp);
    };
  }, [selectMode]);

  useDismiss(contextMenuRef, () => setContextMenu(null), { enabled: !!contextMenu });

  return (
    <div
      className={`world-map-container${pickable ? ' world-map-pickable' : ''}${selectMode ? ' world-map-selecting' : ''}`}
    >
      <MapGL
        ref={mapRef}
        {...viewState}
        onMove={(e) => {
          setViewState(e.viewState);
          onViewStateChange?.(e.viewState);
        }}
        onZoomEnd={(e) => setClusterZoom(e.viewState.zoom)}
        onLoad={handleMapLoad}
        mapStyle={MAP_STYLES[mapStyle].style}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        onClick={(e) => {
          if (pickable) onPick?.(e.lngLat.lat, e.lngLat.lng);
          else deselect();
        }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />
        <AttributionControl compact position="bottom-left" />

        {clusters.flatMap(({ lat, lng, items: clItems }) => {
          const first = clItems[0];
          const count = clItems.length;
          const offsets = worldBounds
            ? wrapOffsetsFor(lng, worldBounds.west, worldBounds.east)
            : [0];
          return offsets.map((offset) => {
            const wrappedLng = lng + offset;
            if (simplePins) {
              return (
                <Marker
                  key={`${lat},${lng},${offset}`}
                  latitude={lat}
                  longitude={wrappedLng}
                  anchor="center"
                >
                  <div className="map-simple-pin" />
                </Marker>
              );
            }
            const clusterIds = clItems.map((i) => i.id);
            const isSelected = selectMode && clusterIds.some((id) => selectedIds.has(id));
            return (
              <Marker
                key={`${lat},${lng},${offset}`}
                latitude={lat}
                longitude={wrappedLng}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  if (!selectMode) {
                    selectMarker(first, clItems);
                    return;
                  }
                  if (e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
                    setSelectedIds((prev) => {
                      const allIn = clusterIds.every((id) => prev.has(id));
                      const next = new Set(prev);
                      clusterIds.forEach((id) => (allIn ? next.delete(id) : next.add(id)));
                      return next;
                    });
                  } else {
                    setSelectedIds(new Set(clusterIds));
                  }
                }}
              >
                <div
                  className={`map-thumb-outer${isSelected ? ' selected' : ''}`}
                  onContextMenu={(e) => {
                    if (!selectMode) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const alreadyIncluded = clusterIds.some((id) => selectedIds.has(id));
                    const effective = alreadyIncluded ? Array.from(selectedIds) : clusterIds;
                    setSelectedIds(new Set(effective));
                    setContextMenu({ x: e.clientX, y: e.clientY, ids: effective });
                  }}
                >
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
          });
        })}

        {pickable && pickedLocation && (
          <Marker
            latitude={pickedLocation.lat}
            longitude={pickedLocation.lng}
            anchor="bottom"
            draggable
            onDragEnd={(e) => onPick?.(e.lngLat.lat, e.lngLat.lng)}
          >
            <MapPin size={30} className="map-pick-marker" fill="currentColor" />
          </Marker>
        )}
      </MapGL>

      {dragBox && (
        <div
          className="map-marquee"
          style={{
            left: Math.min(dragBox.x0, dragBox.x1),
            top: Math.min(dragBox.y0, dragBox.y1),
            width: Math.abs(dragBox.x1 - dragBox.x0),
            height: Math.abs(dragBox.y1 - dragBox.y0),
          }}
        />
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="map-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              const keep = new Set(contextMenu.ids);
              setHiddenIds(
                new Set(
                  items
                    .filter((i) => i.gps_lat != null && i.gps_lng != null && !keep.has(i.id))
                    .map((i) => i.id),
                ),
              );
              setSelectedIds(new Set());
              setContextMenu(null);
            }}
          >
            <Focus size={13} />
            {t('map.isolateSelected', { count: contextMenu.ids.length })}
          </button>
          <button
            type="button"
            onClick={() => {
              setHiddenIds((prev) => {
                const next = new Set(prev);
                contextMenu.ids.forEach((id) => next.add(id));
                return next;
              });
              setSelectedIds(new Set());
              setContextMenu(null);
            }}
          >
            <EyeOff size={13} />
            {t('map.hideSelected', { count: contextMenu.ids.length })}
          </button>
        </div>
      )}

      {!pickable && hiddenIds.size > 0 && (
        <div className="map-hidden-banner">
          <span>{t('map.hiddenCount', { count: hiddenIds.size })}</span>
          <button type="button" onClick={showAllHidden}>
            <Eye size={12} />
            {t('map.showAll')}
          </button>
        </div>
      )}

      {/* Feature menu + travel path controls — left */}
      {showMapTools && (
        <div className="map-left-menus">
          <div className="map-feature-menu">
            <button
              className="map-feature-btn"
              onClick={handleResetView}
              title={t('map.resetView')}
            >
              <RotateCcw size={14} />
            </button>
            <button
              className="map-feature-btn"
              onClick={handleWorldView}
              title={t('map.worldView')}
            >
              <Globe size={14} />
            </button>
            <button
              className={`map-feature-btn${travelPath ? ' active' : ''}`}
              onClick={toggleTravelPath}
              title={t('map.travelPath')}
            >
              <Route size={14} />
            </button>
            <button
              className={`map-feature-btn${selectMode ? ' active' : ''}`}
              onClick={toggleSelectMode}
              title={t('map.selectMode')}
            >
              <BoxSelect size={14} />
            </button>
          </div>

          {/* Travel path step controls — only meaningful while a path is
              showing, so the whole menu is hidden until it's toggled on. */}
          {travelPath && (
            <div className="map-feature-menu">
              <button
                className="map-feature-btn"
                onClick={stepFirst}
                disabled={pathStops.length < 2 || stepIndex === 0}
                title={t('map.stepFirst')}
              >
                <SkipBack size={14} />
              </button>
              <button
                className="map-feature-btn"
                onClick={stepBack}
                disabled={pathStops.length < 2 || stepIndex === 0}
                title={t('map.stepBack')}
              >
                <StepBack size={14} />
              </button>
              <button
                className="map-feature-btn"
                onClick={stepForward}
                disabled={pathStops.length < 2 || stepIndex === pathStops.length - 1}
                title={t('map.stepForward')}
              >
                <StepForward size={14} />
              </button>
              <button
                className="map-feature-btn"
                onClick={stepLast}
                disabled={pathStops.length < 2 || stepIndex === pathStops.length - 1}
                title={t('map.stepLast')}
              >
                <SkipForward size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Style toggle — right */}
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

      {!pickable && geoItems.length === 0 && (
        <div className="world-map-empty">
          <span>📍</span>
          <p>{t('map.empty')}</p>
          <p className="world-map-empty-sub">{t('map.emptyHint')}</p>
        </div>
      )}

      {!pickable && selected && (
        <div className="map-item-card" onMouseDown={(e) => e.stopPropagation()}>
          {selected.media_type === 'image' && (
            <img src={convertFileSrc(selected.file_path)} className="map-item-thumb" alt="" />
          )}
          <div className="map-item-info">
            <p className="map-item-name">{selected.display_name}</p>
            <p className="map-item-coords">
              {selected.gps_lat.toFixed(4)}°, {selected.gps_lng.toFixed(4)}°
            </p>
            {selectedCluster.length > 1 && (
              <p className="map-item-count">
                {t('map.clusterCount', { count: selectedCluster.length })}
              </p>
            )}
            <div className="map-item-actions">
              <button
                className="map-item-open"
                onClick={() =>
                  selectedCluster.length > 1 ? onOpenCluster?.(selectedCluster) : onOpen(selected)
                }
              >
                {t('map.clickToOpen')}
              </button>
              <button
                type="button"
                className="map-item-gmaps"
                title={t('map.googleMaps')}
                onClick={() =>
                  invoke('open_in_browser', {
                    url: `https://www.google.com/maps?q=${selected.gps_lat.toFixed(6)},${selected.gps_lng.toFixed(6)}`,
                  }).catch(() => {})
                }
              >
                {t('map.googleMaps')}
                <ExternalLink size={10} />
              </button>
            </div>
          </div>
          <button
            className="map-item-close"
            onClick={(e) => {
              e.stopPropagation();
              deselect();
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
