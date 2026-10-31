import { describe, expect, it } from 'vitest';
import {
  detectFirstCrossing,
  haversineMeters,
  interpolateCurrent,
  marksBbox,
  rhumbLineCoords,
  startLineEndpoints,
} from '../lib/geo';

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters({ lat: 41.5, lon: -70.6 }, { lat: 41.5, lon: -70.6 })).toBeCloseTo(0, 3);
  });

  it('matches ~111 km per degree of latitude at the equator', () => {
    const d = haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('rhumbLineCoords', () => {
  it('returns marks sorted by seq as [lon, lat] pairs', () => {
    const coords = rhumbLineCoords([
      { seq: 2, name: 'W', lat: 41.6, lon: -70.5, is_start: 0, is_finish: 0 },
      { seq: 1, name: 'S', lat: 41.5, lon: -70.6, is_start: 1, is_finish: 0 },
    ]);
    expect(coords).toEqual([
      [-70.6, 41.5],
      [-70.5, 41.6],
    ]);
  });
});

describe('startLineEndpoints', () => {
  it('produces two endpoints equidistant from the start mark and perpendicular to the course leg', () => {
    const start = { lat: 41.5, lon: -70.6 };
    const next = { lat: 41.6, lon: -70.6 }; // Due north
    const { a, b } = startLineEndpoints(start, next, 185.2);

    // Both endpoints should be ~185.2 m from the start mark.
    expect(haversineMeters(start, a)).toBeGreaterThan(180);
    expect(haversineMeters(start, a)).toBeLessThan(195);
    expect(haversineMeters(start, b)).toBeGreaterThan(180);
    expect(haversineMeters(start, b)).toBeLessThan(195);

    // Due-north course leg → start line runs east-west: endpoints share lat with start,
    // and differ in lon.
    expect(a.lat).toBeCloseTo(start.lat, 4);
    expect(b.lat).toBeCloseTo(start.lat, 4);
    expect(a.lon).not.toBeCloseTo(b.lon, 4);
  });
});

describe('detectFirstCrossing', () => {
  const start = { lat: 41.5, lon: -70.6 };
  const next = { lat: 41.6, lon: -70.6 }; // Course points due north from start.

  it('returns null when there are no positions', () => {
    expect(detectFirstCrossing(start, next, [])).toBeNull();
  });

  it('detects a south-to-north crossing of the east-west start line', () => {
    const positions = [
      { timestamp_utc: '2026-10-30T12:00:00Z', lat: 41.49, lon: -70.6 }, // south of line
      { timestamp_utc: '2026-10-30T12:00:10Z', lat: 41.51, lon: -70.6 }, // north → crossed
    ];
    expect(detectFirstCrossing(start, next, positions)).toBe('2026-10-30T12:00:10Z');
  });

  it('ignores a wrong-way crossing (north-to-south)', () => {
    const positions = [
      { timestamp_utc: '2026-10-30T12:00:00Z', lat: 41.51, lon: -70.6 },
      { timestamp_utc: '2026-10-30T12:00:10Z', lat: 41.49, lon: -70.6 },
    ];
    expect(detectFirstCrossing(start, next, positions)).toBeNull();
  });

  it('returns the earliest crossing when a track oscillates', () => {
    const positions = [
      { timestamp_utc: '2026-10-30T12:00:00Z', lat: 41.49, lon: -70.6 },
      { timestamp_utc: '2026-10-30T12:00:05Z', lat: 41.51, lon: -70.6 }, // first good crossing
      { timestamp_utc: '2026-10-30T12:00:10Z', lat: 41.49, lon: -70.6 },
      { timestamp_utc: '2026-10-30T12:00:20Z', lat: 41.52, lon: -70.6 },
    ];
    expect(detectFirstCrossing(start, next, positions)).toBe('2026-10-30T12:00:05Z');
  });
});

describe('interpolateCurrent', () => {
  const positions = [
    { timestamp_utc: '2026-10-30T12:00:00Z', lat: 41.5, lon: -70.6, cog: 180 },
    { timestamp_utc: '2026-10-30T12:00:10Z', lat: 41.6, lon: -70.5, cog: 90 },
  ];

  it('returns null for empty positions', () => {
    expect(interpolateCurrent([], Date.now())).toBeNull();
  });

  it('holds at first position (dimmed) when currentMs is before any fix', () => {
    const result = interpolateCurrent(positions, Date.parse('2026-10-29T00:00:00Z'));
    expect(result).not.toBeNull();
    expect(result!.dimmed).toBe(true);
    expect(result!.lat).toBeCloseTo(41.5);
  });

  it('linearly interpolates between two bracketing fixes', () => {
    const mid = Date.parse('2026-10-30T12:00:05Z');
    const result = interpolateCurrent(positions, mid);
    expect(result).not.toBeNull();
    expect(result!.dimmed).toBe(false);
    expect(result!.lat).toBeCloseTo(41.55, 4);
    expect(result!.lon).toBeCloseTo(-70.55, 4);
  });

  it('dims and holds at last fix when gap exceeds dim threshold', () => {
    const past = Date.parse('2026-10-30T13:00:00Z');
    const result = interpolateCurrent(positions, past);
    expect(result).not.toBeNull();
    expect(result!.dimmed).toBe(true);
    expect(result!.lat).toBeCloseTo(41.6);
  });

  it('dims when a long gap sits between two fixes', () => {
    const sparse = [
      { timestamp_utc: '2026-10-30T12:00:00Z', lat: 41.5, lon: -70.6, cog: 0 },
      { timestamp_utc: '2026-10-30T12:05:00Z', lat: 41.6, lon: -70.5, cog: 0 }, // 5 min gap
    ];
    const result = interpolateCurrent(sparse, Date.parse('2026-10-30T12:02:00Z'));
    expect(result).not.toBeNull();
    expect(result!.dimmed).toBe(true);
    expect(result!.lat).toBeCloseTo(41.5); // held at previous
  });
});

describe('marksBbox', () => {
  it('returns null for empty marks', () => {
    expect(marksBbox([])).toBeNull();
  });

  it('pads the bounding box by the given ratio', () => {
    const marks = [
      { seq: 1, name: 'A', lat: 41.0, lon: -71.0, is_start: 1, is_finish: 0 },
      { seq: 2, name: 'B', lat: 42.0, lon: -70.0, is_start: 0, is_finish: 1 },
    ];
    const bbox = marksBbox(marks, 0.1);
    expect(bbox).not.toBeNull();
    const [minLon, minLat, maxLon, maxLat] = bbox!;
    expect(minLon).toBeCloseTo(-71.1, 2);
    expect(maxLon).toBeCloseTo(-69.9, 2);
    expect(minLat).toBeCloseTo(40.9, 2);
    expect(maxLat).toBeCloseTo(42.1, 2);
  });
});
