// Geo math for Phase 2a replay.
// All angles in degrees; all distances in metres unless noted.
//
// We treat the race area as locally flat (equirectangular projection around
// the course centroid) for perpendicular/crossing math — at sailing-race
// scales (≤10 nm legs, mid-latitudes) the error is <1 m, well below the
// 10-20 m GPS fix noise that already dominates.
import type { LatLon, RaceMarkRow } from './types';

const EARTH_RADIUS_M = 6_371_000;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Haversine great-circle distance in metres. Used only for the start-line
 * length cap (0.1 nm either side) so great-circle vs rhumb divergence is
 * irrelevant at that scale.
 */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const φ1 = toRadians(a.lat);
  const φ2 = toRadians(b.lat);
  const dφ = toRadians(b.lat - a.lat);
  const dλ = toRadians(b.lon - a.lon);
  const sinDφ = Math.sin(dφ / 2);
  const sinDλ = Math.sin(dλ / 2);
  const h = sinDφ * sinDφ + Math.cos(φ1) * Math.cos(φ2) * sinDλ * sinDλ;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rhumb-line course render helper. On a Mercator-projected map, rhumb lines
 * are literally straight line segments between (lon,lat) pairs, so the
 * "course polyline" for deck.gl / MapLibre is just the raw marks in seq
 * order. This function exists for symmetry with the PRD spec and to allow
 * dropping intermediate points on long legs if we later need them.
 */
export function rhumbLineCoords(marks: RaceMarkRow[]): [number, number][] {
  return marks
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((m) => [m.lon, m.lat]);
}

/**
 * Local-tangent-plane projection around an anchor point. Returns metres from
 * the anchor; good to <0.1 % over tens of km. The inverse transform rebuilds
 * (lat,lon) within rounding error.
 */
export function localProject(anchor: LatLon, p: LatLon): { x: number; y: number } {
  const φ0 = toRadians(anchor.lat);
  const x = toRadians(p.lon - anchor.lon) * EARTH_RADIUS_M * Math.cos(φ0);
  const y = toRadians(p.lat - anchor.lat) * EARTH_RADIUS_M;
  return { x, y };
}

export function localUnproject(anchor: LatLon, p: { x: number; y: number }): LatLon {
  const φ0 = toRadians(anchor.lat);
  const lat = anchor.lat + toDegrees(p.y / EARTH_RADIUS_M);
  const lon = anchor.lon + toDegrees(p.x / (EARTH_RADIUS_M * Math.cos(φ0)));
  return { lat, lon };
}

/**
 * Start line per PRD §2.4: a line perpendicular to the vector from waypoint
 * 1 → waypoint 2, passing through waypoint 1, extending `halfLengthMeters`
 * either side. Returned as [endA, endB] in (lon,lat) order.
 */
export function startLineEndpoints(
  startMark: LatLon,
  nextMark: LatLon,
  halfLengthMeters = 185.2, // ~0.1 nm
): { a: LatLon; b: LatLon; bearingToNextDeg: number } {
  const projNext = localProject(startMark, nextMark);
  const bearing = Math.atan2(projNext.x, projNext.y); // radians from north
  // Perpendicular directions: bearing + 90°, bearing - 90°
  const perpA = bearing + Math.PI / 2;
  const perpB = bearing - Math.PI / 2;
  const dxA = Math.sin(perpA) * halfLengthMeters;
  const dyA = Math.cos(perpA) * halfLengthMeters;
  const dxB = Math.sin(perpB) * halfLengthMeters;
  const dyB = Math.cos(perpB) * halfLengthMeters;
  return {
    a: localUnproject(startMark, { x: dxA, y: dyA }),
    b: localUnproject(startMark, { x: dxB, y: dyB }),
    bearingToNextDeg: toDegrees(bearing),
  };
}

/**
 * Sign of a point's position relative to the start line, in the local
 * tangent plane around the start mark. The "course side" is defined as the
 * side containing the next mark (positive dot product with the start→next
 * vector).
 */
function sideSign(startMark: LatLon, nextMark: LatLon, p: LatLon): number {
  const next = localProject(startMark, nextMark);
  const point = localProject(startMark, p);
  // Dot product of (point) with the unit vector (start→next).
  const nextLen = Math.hypot(next.x, next.y);
  if (nextLen < 1e-6) return 0;
  return (point.x * next.x + point.y * next.y) / nextLen;
}

/**
 * Detect the earliest timestamp at which a track crosses the start line
 * going toward the next mark (PRD §2.4).
 *
 * Algorithm:
 *   For each sorted (positions[i], positions[i+1]) pair, if the two points
 *   lie on opposite sides of the start line AND positions[i+1] is on the
 *   course-side (positive dot product), record the crossing at
 *   positions[i+1].timestamp.
 *
 * Returns the ISO timestamp string of the first qualifying crossing, or
 * null if the track never crosses in the course direction.
 */
export function detectFirstCrossing(
  startMark: LatLon,
  nextMark: LatLon,
  positions: { timestamp_utc: string; lat: number; lon: number }[],
): string | null {
  if (positions.length < 2) return null;
  const sorted = positions
    .slice()
    .sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));

  let prevSide = sideSign(startMark, nextMark, sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    const currSide = sideSign(startMark, nextMark, curr);
    // Opposite signs AND moving toward course side.
    if (prevSide < 0 && currSide >= 0) {
      return curr.timestamp_utc;
    }
    prevSide = currSide;
  }
  return null;
}

export interface CurrentFix {
  lat: number;
  lon: number;
  cog: number | null;
  dimmed: boolean;
  /** Milliseconds elapsed since the latest preceding fix. */
  staleMs: number;
}

/**
 * Interpolate a vessel's position at `currentMs`. Positions MUST be sorted
 * by timestamp_utc ascending.
 *
 * Rules (PRD §2.7):
 *   - before vessel's first fix → hold at first fix, dimmed=true
 *   - between two fixes within `dimAfterMs` → linear interpolate
 *   - gap > dimAfterMs → hold at previous fix, dimmed=true
 *   - after last fix → hold at last fix, dimmed when gap > dimAfterMs
 */
export function interpolateCurrent(
  positions: { timestamp_utc: string; lat: number; lon: number; cog: number | null }[],
  currentMs: number,
  dimAfterMs = 60_000,
): CurrentFix | null {
  if (positions.length === 0) return null;
  const times = positions.map((p) => Date.parse(p.timestamp_utc));

  if (currentMs < times[0]) {
    return {
      lat: positions[0].lat,
      lon: positions[0].lon,
      cog: positions[0].cog,
      dimmed: true,
      staleMs: times[0] - currentMs,
    };
  }

  // Last index where time <= currentMs. Linear scan is fine; the caller
  // runs per-vessel and vessels rarely exceed a few thousand points.
  let idx = 0;
  for (let i = 1; i < times.length; i++) {
    if (times[i] <= currentMs) idx = i;
    else break;
  }

  const prev = positions[idx];
  const prevMs = times[idx];
  const next = positions[idx + 1];

  if (!next) {
    const stale = currentMs - prevMs;
    return {
      lat: prev.lat,
      lon: prev.lon,
      cog: prev.cog,
      dimmed: stale > dimAfterMs,
      staleMs: stale,
    };
  }

  const nextMs = times[idx + 1];
  const sinceLast = currentMs - prevMs;
  if (sinceLast > dimAfterMs) {
    return {
      lat: prev.lat,
      lon: prev.lon,
      cog: prev.cog,
      dimmed: true,
      staleMs: sinceLast,
    };
  }

  const t = (currentMs - prevMs) / (nextMs - prevMs);
  return {
    lat: prev.lat + (next.lat - prev.lat) * t,
    lon: prev.lon + (next.lon - prev.lon) * t,
    cog: prev.cog,
    dimmed: false,
    staleMs: sinceLast,
  };
}

/**
 * Phase 2b — generalised rounding detection for any waypoint pair (N, N+1).
 *
 * A "rounding" at waypoint N is a crossing of the perpendicular through
 * waypoint N (perpendicular to the N→N+1 direction) where the boat goes
 * from the pre-rounding side (negative dot product with the N→N+1 vector)
 * to the post-rounding side (positive). Returns the FIRST crossing per
 * boat per waypoint — a boat that doubles back and re-crosses later only
 * registers the first time, matching the way race officials score marks.
 *
 * Positions MUST be sorted by timestamp_utc ascending. The returned
 * timestamp is the later of the bracketing pair (the post-crossing fix).
 */
export function detectRounding(
  waypointN: LatLon,
  waypointNext: LatLon,
  positions: { timestamp_utc: string; lat: number; lon: number }[],
): string | null {
  if (positions.length < 2) return null;

  let prevSide = sideSign(waypointN, waypointNext, positions[0]);
  for (let i = 1; i < positions.length; i++) {
    const curr = positions[i];
    const currSide = sideSign(waypointN, waypointNext, curr);
    if (prevSide < 0 && currSide >= 0) {
      return curr.timestamp_utc;
    }
    prevSide = currSide;
  }
  return null;
}

/**
 * Along-course distance (metres) from a boat position to the next
 * unrounded waypoint, projected onto the N→N+1 line.
 *
 * The projection is the dot product of the boat→N vector with the unit
 * (N→N+1) vector. Positive distance = boat is still short of waypoint N;
 * negative = boat has passed through the perpendicular (treated as 0 by
 * callers once rounding is detected).
 *
 * Near-mark snap: if the raw perpendicular distance from boat to waypoint
 * N is under `snapRadiusM` (default 50 m per PRD §6), returns 0.
 */
export function alongCourseDistance(
  boat: LatLon,
  waypointN: LatLon,
  waypointNext: LatLon,
  snapRadiusM = 50,
): number {
  const nextProj = localProject(waypointN, waypointNext);
  const nextLen = Math.hypot(nextProj.x, nextProj.y);
  if (nextLen < 1e-6) return 0;

  const boatProj = localProject(waypointN, boat);
  const boatDist = Math.hypot(boatProj.x, boatProj.y);
  if (boatDist < snapRadiusM) return 0;

  // Signed distance along N→N+1, measured from the boat toward N.
  // (boat is at origin − N; project onto unit (N→N+1) and flip sign so
  // "approaching N" is positive.)
  const nx = nextProj.x / nextLen;
  const ny = nextProj.y / nextLen;
  return -(boatProj.x * nx + boatProj.y * ny);
}

/**
 * Bounding box of a set of marks with a padding ratio (0.10 = +10 %).
 * Returns [minLon, minLat, maxLon, maxLat] for MapLibre fitBounds.
 */
export function marksBbox(
  marks: RaceMarkRow[],
  padRatio = 0.1,
): [number, number, number, number] | null {
  if (marks.length === 0) return null;
  let minLat = marks[0].lat;
  let maxLat = marks[0].lat;
  let minLon = marks[0].lon;
  let maxLon = marks[0].lon;
  for (const m of marks) {
    if (m.lat < minLat) minLat = m.lat;
    if (m.lat > maxLat) maxLat = m.lat;
    if (m.lon < minLon) minLon = m.lon;
    if (m.lon > maxLon) maxLon = m.lon;
  }
  const latPad = Math.max((maxLat - minLat) * padRatio, 0.0005);
  const lonPad = Math.max((maxLon - minLon) * padRatio, 0.0005);
  return [minLon - lonPad, minLat - latPad, maxLon + lonPad, maxLat + latPad];
}
