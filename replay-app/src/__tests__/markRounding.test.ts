import { describe, expect, it } from 'vitest';
import { detectRounding } from '../lib/geo';
import { computeMarkRoundings } from '../hooks/useMarkRoundings';
import type { PositionRow, RaceMarkRow } from '../lib/types';

// Right-angle course for predictable rounding geometry.
//   M1 start     at (40.60, -74.00) — next direction = NORTH
//   M2 weather   at (40.65, -74.00) — next direction = EAST
//   M3 turning   at (40.65, -73.95) — next direction = SOUTH
//   M4 finish    at (40.60, -73.95)
const M1: RaceMarkRow = { seq: 0, name: 'M1', lat: 40.60, lon: -74.00, is_start: 1, is_finish: 0 };
const M2: RaceMarkRow = { seq: 1, name: 'M2', lat: 40.65, lon: -74.00, is_start: 0, is_finish: 0 };
const M3: RaceMarkRow = { seq: 2, name: 'M3', lat: 40.65, lon: -73.95, is_start: 0, is_finish: 0 };
const M4: RaceMarkRow = { seq: 3, name: 'M4', lat: 40.60, lon: -73.95, is_start: 0, is_finish: 1 };

function makePos(mmsi: string, t: string, lat: number, lon: number): PositionRow {
  return {
    mmsi,
    timestamp_utc: t,
    lat,
    lon,
    sog: 5,
    cog: 0,
    heading: null,
    source: 'test',
    interpolated: 0,
  };
}

describe('detectRounding', () => {
  it('returns the first crossing in the course direction', () => {
    // M1 at (40.60, -74.00), next M2 at (40.65, -74.00). M1→M2 direction = NORTH.
    // Pre-rounding (far from M2) = south of M1. Post = north of M1.
    const positions = [
      makePos('X', '2026-10-31T12:00:00Z', 40.595, -74.0),
      makePos('X', '2026-10-31T12:00:30Z', 40.605, -74.0),
    ];
    const t = detectRounding(
      { lat: M1.lat, lon: M1.lon },
      { lat: M2.lat, lon: M2.lon },
      positions,
    );
    expect(t).toBe('2026-10-31T12:00:30Z');
  });

  it('returns null when the boat never crosses', () => {
    const positions = [
      makePos('X', '2026-10-31T12:00:00Z', 40.661, -74.0),
      makePos('X', '2026-10-31T12:00:30Z', 40.670, -74.0),
    ];
    const t = detectRounding(
      { lat: M1.lat, lon: M1.lon },
      { lat: M2.lat, lon: M2.lon },
      positions,
    );
    expect(t).toBeNull();
  });

  it('ignores crossings in the reverse direction', () => {
    const positions = [
      makePos('X', '2026-10-31T12:00:00Z', 40.605, -74.0), // post
      makePos('X', '2026-10-31T12:00:30Z', 40.595, -74.0), // back to pre
    ];
    const t = detectRounding(
      { lat: M1.lat, lon: M1.lon },
      { lat: M2.lat, lon: M2.lon },
      positions,
    );
    expect(t).toBeNull();
  });
});

describe('computeMarkRoundings', () => {
  it('builds a row per boat with cells for every waypoint pair', () => {
    const positions: PositionRow[] = [
      // Boat A — rounds M1 (northward), then M2 (eastward), then M3 (southward).
      makePos('A', '2026-10-31T12:00:00Z', 40.595, -74.000), // pre M1
      makePos('A', '2026-10-31T12:00:10Z', 40.605, -74.000), // post M1
      makePos('A', '2026-10-31T12:05:00Z', 40.645, -74.005), // pre M2 (SW of M2)
      makePos('A', '2026-10-31T12:05:10Z', 40.655, -73.995), // post M2 (NE of M2)
      makePos('A', '2026-10-31T12:08:00Z', 40.655, -73.955), // pre M3 (NE of M3)
      makePos('A', '2026-10-31T12:08:10Z', 40.645, -73.945), // post M3 (SW of M3)
      // Boat B — only rounds M1.
      makePos('B', '2026-10-31T12:00:30Z', 40.595, -74.000),
      makePos('B', '2026-10-31T12:00:40Z', 40.605, -74.000),
    ];

    const table = computeMarkRoundings([M1, M2, M3, M4], positions);
    // Three pairs → three rounding seqs (0, 1, 2); M4 has no "next" so skipped.
    expect(table.seqs).toEqual([0, 1, 2]);

    const a = table.rows.find((r) => r.mmsi === 'A');
    expect(a?.roundings[0].timestampUtc).toBe('2026-10-31T12:00:10Z');
    expect(a?.roundings[1].timestampUtc).toBe('2026-10-31T12:05:10Z');
    expect(a?.roundings[2].timestampUtc).toBe('2026-10-31T12:08:10Z');

    const b = table.rows.find((r) => r.mmsi === 'B');
    expect(b?.roundings[0].timestampUtc).toBe('2026-10-31T12:00:40Z');
    expect(b?.roundings[1].timestampUtc).toBeNull();
    expect(b?.roundings[2].timestampUtc).toBeNull();
  });

  it('returns empty seqs when fewer than two marks', () => {
    const t = computeMarkRoundings([M1], []);
    expect(t.seqs).toEqual([]);
  });
});
