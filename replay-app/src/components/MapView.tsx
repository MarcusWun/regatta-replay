// MapLibre basemap + deck.gl overlay rendering the fleet, trails, course, start line.
//
// GeoJSON is inlined via `?raw` import, parsed at module load, passed directly as
// `data` to avoid Tauri asset-protocol issues in production.
//
// Layout:
//   - MapLibre: offline Natural Earth style — one `land` + one `ocean` fill layer.
//   - deck.gl MapboxOverlay (interleaved mode works with MapLibre):
//       - PathLayer:        rhumb-line course between marks
//       - PathLayer:        start-line perpendicular
//       - TripsLayer:       sliding-window trails (race-time animated)
//       - ScatterplotLayer: marks (start=green pin, finish=red pin, interim=cyan)
//       - ScatterplotLayer: boat positions (interpolated at nowMs)
//       - TextLayer:        boat labels (always visible)
import { useEffect, useMemo, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import 'maplibre-gl/dist/maplibre-gl.css';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import landRaw from '../assets/basemap/ne_10m_land.geojson?raw';
import oceanRaw from '../assets/basemap/ne_10m_ocean.geojson?raw';
import osmUsNeLandRaw from '../assets/basemap/osm_us_ne_land.geojson?raw';

maplibregl.setWorkerUrl(mapLibreWorkerUrl);

const landData       = JSON.parse(landRaw);
const oceanData      = JSON.parse(oceanRaw);
const osmUsNeLandData = JSON.parse(osmUsNeLandRaw);
import { colorForMmsi, OWN_BOAT_COLOR } from '../lib/colors';
import { interpolateCurrent, marksBbox, startLineEndpoints } from '../lib/geo';
import type { PositionRow, RaceMarkRow, VesselRow } from '../lib/types';

export interface MapViewProps {
  vessels: VesselRow[];
  positionsByMmsi: Map<string, PositionRow[]>;
  marks: RaceMarkRow[];
  ownMmsi: string | null;
  startMs: number;
  nowMs: number;
  trailSeconds: number | null;
  hidden: Set<string>;
  /**
   * Called once the MapLibre map is ready; receives the live Map instance.
   * Phase 2c uses this to grab the canvas for PNG export.
   */
  onMapReady?: (map: maplibregl.Map) => void;
}

const BASEMAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'regatta-replay-neutral',
  sources: {
    ocean:       { type: 'geojson', data: oceanData },
    land:        { type: 'geojson', data: landData },
    'land-us-ne': { type: 'geojson', data: osmUsNeLandData },
  },
  layers: [
    { id: 'ocean-fill', type: 'background', paint: { 'background-color': '#b0c7d6' } },
    { id: 'ocean-poly', type: 'fill', source: 'ocean', paint: { 'fill-color': '#b0c7d6' } },
    { id: 'land-poly', type: 'fill', source: 'land', paint: { 'fill-color': '#d9d4c9' } },
    { id: 'land-poly-us-ne', type: 'fill', source: 'land-us-ne', paint: { 'fill-color': '#d9d4c9' } },
  ],
  // No glyphs server — the style has zero text layers, so a loader isn't needed.
};

interface BoatRender {
  mmsi: string;
  lat: number;
  lon: number;
  color: [number, number, number, number];
  label: string;
  isOwn: boolean;
}

function displayLabel(v: VesselRow): string {
  return v.display_name ?? v.sail_number ?? v.ais_name ?? `MMSI: ${v.mmsi}`;
}

export function MapView({
  vessels,
  positionsByMmsi,
  marks,
  ownMmsi,
  startMs,
  nowMs,
  trailSeconds,
  hidden,
  onMapReady,
}: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const didFitRef = useRef(false);

  // Initialize map once.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: BASEMAP_STYLE,
      center: [0, 30],
      zoom: 2,
      attributionControl: false,
      // Required for PNG snapshot export — otherwise WebGL discards the
      // framebuffer between frames and getCanvas().toBlob() returns a blank
      // image. MapLibre 6 forwards this to the underlying WebGL context.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    const overlay = new MapboxOverlay({ layers: [] });
    map.addControl(overlay as unknown as maplibregl.IControl);
    overlayRef.current = overlay;
    onMapReady?.(map);
    return () => {
      overlay.finalize();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, [onMapReady]);

  // Fit to marks on first render that has marks.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || marks.length === 0 || didFitRef.current) return;
    const bbox = marksBbox(marks);
    if (!bbox) return;
    const [minLon, minLat, maxLon, maxLat] = bbox;
    map.fitBounds(
      [[minLon, minLat], [maxLon, maxLat]],
      { padding: 60, duration: 0, maxZoom: 15 },
    );
    didFitRef.current = true;
  }, [marks]);

  // Derived render data — recomputed each `nowMs`.
  const boats = useMemo<BoatRender[]>(() => {
    const out: BoatRender[] = [];
    for (const v of vessels) {
      if (hidden.has(v.mmsi)) continue;
      const track = positionsByMmsi.get(v.mmsi) ?? [];
      const current = interpolateCurrent(track, nowMs);
      if (!current) continue;
      const base = v.mmsi === ownMmsi ? OWN_BOAT_COLOR : colorForMmsi(v.mmsi);
      const alpha = current.dimmed ? 128 : 255;
      out.push({
        mmsi: v.mmsi,
        lat: current.lat,
        lon: current.lon,
        color: [base[0], base[1], base[2], alpha],
        label: displayLabel(v),
        isOwn: v.mmsi === ownMmsi,
      });
    }
    return out;
  }, [vessels, positionsByMmsi, nowMs, hidden, ownMmsi]);

  const tripData = useMemo(() => {
    return vessels
      .filter((v) => !hidden.has(v.mmsi))
      .map((v) => {
        const track = positionsByMmsi.get(v.mmsi) ?? [];
        return {
          mmsi: v.mmsi,
          path: track.map((p): [number, number] => [p.lon, p.lat]),
          timestamps: track.map((p) => Date.parse(p.timestamp_utc) / 1000),
          color: v.mmsi === ownMmsi ? OWN_BOAT_COLOR : colorForMmsi(v.mmsi),
        };
      });
  }, [vessels, positionsByMmsi, hidden, ownMmsi]);

  const sortedMarks = useMemo(() => marks.slice().sort((a, b) => a.seq - b.seq), [marks]);
  const coursePath = useMemo<[number, number][]>(() => sortedMarks.map((m) => [m.lon, m.lat]), [sortedMarks]);

  const startLine = useMemo<[number, number][] | null>(() => {
    if (sortedMarks.length < 2) return null;
    const start = sortedMarks[0];
    const next = sortedMarks[1];
    const line = startLineEndpoints({ lat: start.lat, lon: start.lon }, { lat: next.lat, lon: next.lon });
    return [
      [line.a.lon, line.a.lat],
      [line.b.lon, line.b.lat],
    ];
  }, [sortedMarks]);

  // Push layer updates on nowMs changes.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const trailLength = trailSeconds ?? (nowMs - startMs) / 1000 + 1;
    const currentTime = nowMs / 1000;

    const layers: unknown[] = [];

    if (coursePath.length >= 2) {
      layers.push(
        new PathLayer({
          id: 'course-rhumb',
          data: [{ path: coursePath }],
          getPath: (d: { path: [number, number][] }) => d.path,
          getWidth: 2,
          widthUnits: 'pixels',
          getColor: [40, 40, 40, 180],
          parameters: { depthTest: false },
        }),
      );
    }

    if (startLine) {
      layers.push(
        new PathLayer({
          id: 'start-line',
          data: [{ path: startLine }],
          getPath: (d: { path: [number, number][] }) => d.path,
          getWidth: 3,
          widthUnits: 'pixels',
          getColor: [20, 150, 50, 220],
          parameters: { depthTest: false },
        }),
      );
    }

    if (tripData.length) {
      layers.push(
        new TripsLayer({
          id: 'trails',
          data: tripData,
          getPath: (d: { path: [number, number][] }) => d.path,
          getTimestamps: (d: { timestamps: number[] }) => d.timestamps,
          getColor: (d: { color: readonly [number, number, number] }) =>
            [d.color[0], d.color[1], d.color[2]],
          opacity: 0.9,
          widthUnits: 'pixels',
          getWidth: 2,
          currentTime,
          trailLength,
          jointRounded: true,
          capRounded: true,
          parameters: { depthTest: false },
        }),
      );
    }

    if (sortedMarks.length) {
      layers.push(
        new ScatterplotLayer({
          id: 'marks',
          data: sortedMarks,
          getPosition: (m: RaceMarkRow): [number, number] => [m.lon, m.lat],
          getFillColor: (m: RaceMarkRow): [number, number, number, number] => {
            if (m.is_start === 1) return [20, 150, 50, 240];
            if (m.is_finish === 1) return [200, 30, 30, 240];
            return [60, 180, 220, 240];
          },
          getRadius: 7,
          radiusUnits: 'pixels',
          stroked: true,
          getLineColor: [0, 0, 0, 220],
          lineWidthUnits: 'pixels',
          getLineWidth: 1,
          parameters: { depthTest: false },
        }),
      );
      layers.push(
        new TextLayer({
          id: 'mark-labels',
          data: sortedMarks,
          getPosition: (m: RaceMarkRow): [number, number] => [m.lon, m.lat],
          getText: (m: RaceMarkRow) => m.name ?? String(m.seq),
          getSize: 11,
          sizeUnits: 'pixels',
          getColor: [20, 20, 20, 240],
          getPixelOffset: [0, -14],
          fontFamily: 'system-ui, -apple-system, sans-serif',
          parameters: { depthTest: false },
        }),
      );
    }

    if (boats.length) {
      layers.push(
        new ScatterplotLayer({
          id: 'boats',
          data: boats,
          getPosition: (b: BoatRender): [number, number] => [b.lon, b.lat],
          getFillColor: (b: BoatRender): [number, number, number, number] => b.color,
          getRadius: (b: BoatRender) => (b.isOwn ? 7 : 5),
          radiusUnits: 'pixels',
          stroked: true,
          getLineColor: [0, 0, 0, 220],
          lineWidthUnits: 'pixels',
          getLineWidth: 1,
          parameters: { depthTest: false },
          updateTriggers: {
            getPosition: nowMs,
            getFillColor: nowMs,
          },
        }),
      );
      layers.push(
        new TextLayer({
          id: 'boat-labels',
          data: boats,
          getPosition: (b: BoatRender): [number, number] => [b.lon, b.lat],
          getText: (b: BoatRender) => b.label,
          getSize: 11,
          sizeUnits: 'pixels',
          getColor: (b: BoatRender): [number, number, number, number] => [20, 20, 20, b.color[3]],
          getPixelOffset: [8, -8],
          fontFamily: 'system-ui, -apple-system, sans-serif',
          parameters: { depthTest: false },
          updateTriggers: {
            getPosition: nowMs,
            getColor: nowMs,
          },
        }),
      );
    }

    // deck.gl's typing for setProps accepts Layer[], but we assemble layers
    // from several packages above and cast through unknown[] once here.
    overlay.setProps({ layers: layers as never[] });
  }, [coursePath, startLine, tripData, sortedMarks, boats, nowMs, startMs, trailSeconds]);

  return <div ref={mapContainerRef} className="relative h-full w-full" data-testid="map-container" />;
}
