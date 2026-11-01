import { describe, expect, it } from 'vitest';
import {
  computeSnapshot,
  computeVMC,
  markDisplayName,
  vmcAt,
  vmcWindow,
} from '../hooks/useVMC';
import { computeMarkRoundings } from '../hooks/useMarkRoundings';
import type { PositionRow, RaceMarkRow } from '../lib/types';

// Right-angle course modelled on markRounding.test.ts for geometry we can reason about:
//   M1 start    at (40.60, -74.00) — M1→M2 points NORTH
//   M2 weather  at (40.65, -74.00) — M2→M3 points EAST
//   M3 turning  at (40.65, -73.95) — M3→M4 points SOUTH
//   M4 finish   at (40.60, -73.95)
const M1: RaceMarkRow = { seq: 0, name: 'M1', lat: 40.60, lon: -74.00, is_start: 1, is_finish: 0 };
const M2: RaceMarkRow = { seq: 1, name: 'M2', lat: 40.65, lon: -74.00, is_start: 0, is_finish: 0 };
const M3: RaceMarkRow = { seq: 2, name: 'M3', lat: 40.65, lon: -73.95, is_start: 0, is_finish: 0 };
const M4: RaceMarkRow = { seq: 3, name: 'M4', lat: 40.60, lon: -73.95, is_start: 0, is_finish: 1 };
const COURSE = [M1, M2, M3, M4];

function pos(
  t: string,
  lat: number,
  lon: number,
  sog: number | null,
  cog: number | null,
): PositionRow {
  return {
    mmsi: 'OWN',
    timestamp_utc: t,
    lat,
    lon,
    sog,
    cog,
    heading: null,
    source: 'test',
    interpolated: 0,
  };
}

describe('markDisplayName', () => {
  it('uses the provided name when set', () => {
    expect(markDisplayName(M2)).toBe('M2');
  });

  it('falls back to Mark {seq+1} when name is missing', () => {
    expect(markDisplayName({ ...M2, name: null })).toBe('Mark 2');
    expect(markDisplayName({ ...M2, name: '  ' })).toBe('Mark 2');
  });
});

describe('computeVMC — pre-start', () => {
  it('targets the start pin before own-boat rounds anything', () => {
    // Own-boat idling just south of M1, moving north at 5 kt.
    const positions = [
      pos('2026-10-31T12:00:00Z', 40.590, -74.000, 5, 0),
      pos('2026-10-31T12:00:05Z', 40.591, -74.000, 5, 0),
    ];
    const roundings = computeMarkRoundings(COURSE, positions);
    const ownRow = roundings.rows.find((r) => r.mmsi === 'OWN') ?? null;
    const series = computeVMC(positions, COURSE, ownRow?.roundings ?? null, roundings.seqs);
    expect(series.entries).toHaveLength(2);
    const first = series.entries[0];
    expect(first.targetMarkSeq).toBe(0);
    expect(first.targetMarkName).toBe('M1');
    // Heading due north toward M1 due north → VMC ≈ SOG × cos(0) = +5 kt.
    expect(first.vmc).toBeCloseTo(5, 2);
  });
});

describe('computeVMC — in-race', () => {
  it('advances to the next unrounded mark after rounding the previous one', () => {
    // Boat crosses M1 heading north, then slides east approaching M2 — reads VMC
    // against M2 after the start-line crossing timestamp.
    const positions = [
      pos('2026-10-31T12:00:00Z', 40.595, -74.000, 5, 0), // pre start
      pos('2026-10-31T12:00:30Z', 40.605, -74.000, 5, 0), // post start — rounds M1
      pos('2026-10-31T12:05:00Z', 40.645, -74.005, 5, 0), // SW of M2, heading due north
    ];
    const roundings = computeMarkRoundings(COURSE, positions);
    const ownRow = roundings.rows.find((r) => r.mmsi === 'OWN') ?? null;
    const series = computeVMC(positions, COURSE, ownRow?.roundings ?? null, roundings.seqs);

    const atStart = series.entries[0]; // 12:00:00 — pre-rounding → target M1
    expect(atStart.targetMarkSeq).toBe(0);

    const afterStart = series.entries[1]; // 12:00:30 — rounded M1 → target now M2
    expect(afterStart.targetMarkSeq).toBe(1);
    expect(afterStart.targetMarkName).toBe('M2');

    const nearM2 = series.entries[2]; // 12:05 — still approaching M2
    expect(nearM2.targetMarkSeq).toBe(1);
    expect(nearM2.vmc).not.toBeNull();
    expect(nearM2.vmc!).toBeGreaterThan(0); // sailing toward M2 → positive VMC
  });
});

describe('computeVMC — negative VMC', () => {
  it('reports a negative VMC when own-boat is heading away from the target', () => {
    // Boat sits just north of M1 heading SOUTH (away from M1 while rounding is
    // still pending — i.e. missed start pin and sailing back).
    const positions = [
      pos('2026-10-31T12:00:00Z', 40.590, -74.000, 5, 180), // south of M1, heading south
    ];
    const roundings = computeMarkRoundings(COURSE, positions);
    const ownRow = roundings.rows.find((r) => r.mmsi === 'OWN') ?? null;
    const series = computeVMC(positions, COURSE, ownRow?.roundings ?? null, roundings.seqs);
    const e = series.entries[0];
    expect(e.targetMarkSeq).toBe(0);
    expect(e.vmc).not.toBeNull();
    expect(e.vmc!).toBeLessThan(0);
    expect(e.vmc!).toBeCloseTo(-5, 2);
  });
});

describe('computeVMC — final leg vs post-finish', () => {
  it('targets the finish mark while own-boat is on the final leg', () => {
    // Boat has rounded M1, M2, M3 (so all three pair-based roundings exist).
    // Now sits between M3 and M4, approaching M4 heading south.
    const positions = [
      // Rounds M1
      pos('2026-10-31T12:00:00Z', 40.595, -74.000, 5, 0),
      pos('2026-10-31T12:00:10Z', 40.605, -74.000, 5, 0),
      // Rounds M2 (crossing perpendicular at M2 going east)
      pos('2026-10-31T12:05:00Z', 40.645, -74.005, 5, 90),
      pos('2026-10-31T12:05:10Z', 40.655, -73.995, 5, 90),
      // Rounds M3 (crossing perpendicular at M3 going south)
      pos('2026-10-31T12:10:00Z', 40.655, -73.955, 5, 180),
      pos('2026-10-31T12:10:10Z', 40.645, -73.945, 5, 180),
      // On final leg between M3 and M4
      pos('2026-10-31T12:12:00Z', 40.620, -73.950, 5, 180),
    ];
    const roundings = computeMarkRoundings(COURSE, positions);
    const ownRow = roundings.rows.find((r) => r.mmsi === 'OWN') ?? null;
    const series = computeVMC(positions, COURSE, ownRow?.roundings ?? null, roundings.seqs);

    const lastEntry = series.entries[series.entries.length - 1];
    expect(lastEntry.targetMarkSeq).toBe(3);
    expect(lastEntry.targetMarkName).toBe('M4');
  });

  it('reports null target after own-boat crosses the finish line', () => {
    // Same as above but with the boat sailing well past M4 (south of it).
    const positions = [
      pos('2026-10-31T12:00:00Z', 40.595, -74.000, 5, 0),
      pos('2026-10-31T12:00:10Z', 40.605, -74.000, 5, 0),
      pos('2026-10-31T12:05:00Z', 40.645, -74.005, 5, 90),
      pos('2026-10-31T12:05:10Z', 40.655, -73.995, 5, 90),
      pos('2026-10-31T12:10:00Z', 40.655, -73.955, 5, 180),
      pos('2026-10-31T12:10:10Z', 40.645, -73.945, 5, 180),
      pos('2026-10-31T12:15:00Z', 40.595, -73.950, 5, 180), // sailed well past M4
    ];
    const roundings = computeMarkRoundings(COURSE, positions);
    const ownRow = roundings.rows.find((r) => r.mmsi === 'OWN') ?? null;
    const series = computeVMC(positions, COURSE, ownRow?.roundings ?? null, roundings.seqs);

    const lastEntry = series.entries[series.entries.length - 1];
    expect(lastEntry.targetMarkSeq).toBeNull();
    expect(lastEntry.vmc).toBeNull();
  });
});

describe('computeVMC — no-course', () => {
  it('returns an empty series when marks is empty', () => {
    const positions = [pos('2026-10-31T12:00:00Z', 40.59, -74.0, 5, 0)];
    const series = computeVMC(positions, [], null, []);
    expect(series.entries).toEqual([]);
  });

  it('returns null VMC when own-boat has only one mark on the course', () => {
    // One mark + all pair roundings done (vacuously true: there are none) → no
    // virtual-past-finish point → target resolves to null.
    const positions = [pos('2026-10-31T12:00:00Z', 40.59, -74.0, 5, 0)];
    const series = computeVMC(positions, [M1], null, []);
    expect(series.entries[0].targetMarkSeq).toBeNull();
    expect(series.entries[0].vmc).toBeNull();
  });
});

describe('vmcAt / vmcWindow', () => {
  const positions = [
    pos('2026-10-31T12:00:00Z', 40.590, -74.000, 5, 0),
    pos('2026-10-31T12:01:00Z', 40.591, -74.000, 5, 0),
    pos('2026-10-31T12:11:00Z', 40.592, -74.000, 5, 0),
  ];
  const roundings = computeMarkRoundings(COURSE, positions);
  const ownRow = roundings.rows.find((r) => r.mmsi === 'OWN') ?? null;
  const series = computeVMC(positions, COURSE, ownRow?.roundings ?? null, roundings.seqs);

  it('returns null before the first fix', () => {
    expect(vmcAt(series, Date.parse('2026-10-31T11:59:00Z'))).toBeNull();
  });

  it('finds the latest entry at or before nowMs', () => {
    const e = vmcAt(series, Date.parse('2026-10-31T12:00:30Z'));
    expect(e?.timestampMs).toBe(Date.parse('2026-10-31T12:00:00Z'));
  });

  it('slices only entries within the trailing window', () => {
    const slice = vmcWindow(series, Date.parse('2026-10-31T12:11:00Z'), 10 * 60 * 1000);
    // The 12:00 fix is 11 min back → excluded. 12:01 (10 min back) and 12:11 (0) → included.
    expect(slice).toHaveLength(2);
  });
});

describe('computeSnapshot — smoothing window', () => {
  it('averages instantaneous VMC across the 10-min window', () => {
    // Build a synthetic series where the own-boat points due north at a steady
    // 5 kt toward M1 — VMC should be ~+5 kt at every fix, and the smoothed
    // 10-min value should also sit at ~+5.
    const positions = Array.from({ length: 6 }, (_, i) =>
      pos(
        `2026-10-31T12:0${i}:00Z`,
        40.590 - 0.0001 * (5 - i), // creeping north toward M1
        -74.000,
        5,
        0,
      ),
    );
    const roundings = computeMarkRoundings(COURSE, positions);
    const ownRow = roundings.rows.find((r) => r.mmsi === 'OWN') ?? null;
    const series = computeVMC(positions, COURSE, ownRow?.roundings ?? null, roundings.seqs);
    const { snapshot, window } = computeSnapshot(
      series,
      Date.parse('2026-10-31T12:05:00Z'),
      COURSE,
    );
    expect(window.length).toBe(6);
    expect(snapshot.smoothed10min).toBeCloseTo(5, 1);
    expect(snapshot.isUnsmoothed).toBe(false);
    expect(snapshot.hasCourse).toBe(true);
    expect(snapshot.postFinish).toBe(false);
  });

  it('falls back to raw instantaneous VMC with isUnsmoothed when window has <2 samples', () => {
    const positions = [pos('2026-10-31T12:00:00Z', 40.590, -74.000, 5, 0)];
    const roundings = computeMarkRoundings(COURSE, positions);
    const ownRow = roundings.rows.find((r) => r.mmsi === 'OWN') ?? null;
    const series = computeVMC(positions, COURSE, ownRow?.roundings ?? null, roundings.seqs);
    const { snapshot } = computeSnapshot(
      series,
      Date.parse('2026-10-31T12:00:00Z'),
      COURSE,
    );
    expect(snapshot.isUnsmoothed).toBe(true);
    expect(snapshot.smoothed10min).toBeCloseTo(5, 1);
  });

  it('reports postFinish=true after own-boat sails past the finish', () => {
    const positions = [
      pos('2026-10-31T12:00:00Z', 40.595, -74.000, 5, 0),
      pos('2026-10-31T12:00:10Z', 40.605, -74.000, 5, 0),
      pos('2026-10-31T12:05:00Z', 40.645, -74.005, 5, 90),
      pos('2026-10-31T12:05:10Z', 40.655, -73.995, 5, 90),
      pos('2026-10-31T12:10:00Z', 40.655, -73.955, 5, 180),
      pos('2026-10-31T12:10:10Z', 40.645, -73.945, 5, 180),
      pos('2026-10-31T12:15:00Z', 40.595, -73.950, 5, 180),
    ];
    const roundings = computeMarkRoundings(COURSE, positions);
    const ownRow = roundings.rows.find((r) => r.mmsi === 'OWN') ?? null;
    const series = computeVMC(positions, COURSE, ownRow?.roundings ?? null, roundings.seqs);
    const { snapshot } = computeSnapshot(
      series,
      Date.parse('2026-10-31T12:15:00Z'),
      COURSE,
    );
    expect(snapshot.postFinish).toBe(true);
    expect(snapshot.targetMarkSeq).toBeNull();
    expect(snapshot.targetMarkName).toBeNull();
    expect(snapshot.smoothed10min).toBeNull();
  });

  it('hasCourse=false when the race has no marks', () => {
    const series = computeVMC(
      [pos('2026-10-31T12:00:00Z', 40.59, -74.0, 5, 0)],
      [],
      null,
      [],
    );
    const { snapshot } = computeSnapshot(series, Date.parse('2026-10-31T12:00:00Z'), []);
    expect(snapshot.hasCourse).toBe(false);
  });
});

describe('initialBearing (via geo.ts)', () => {
  it('produces expected VMC when boat heads directly at the target', () => {
    // Boat due south of M1, SOG 6 kt, COG 0° (due north). Target = M1.
    const positions = [pos('2026-10-31T12:00:00Z', 40.58, -74.000, 6, 0)];
    const roundings = computeMarkRoundings(COURSE, positions);
    const ownRow = roundings.rows.find((r) => r.mmsi === 'OWN') ?? null;
    const series = computeVMC(positions, COURSE, ownRow?.roundings ?? null, roundings.seqs);
    expect(series.entries[0].vmc).toBeCloseTo(6, 2);
  });

  it('produces 0 VMC when boat heads perpendicular to the target bearing', () => {
    // Boat due south of M1, COG 90° (due east) — perpendicular to north.
    const positions = [pos('2026-10-31T12:00:00Z', 40.58, -74.000, 6, 90)];
    const roundings = computeMarkRoundings(COURSE, positions);
    const ownRow = roundings.rows.find((r) => r.mmsi === 'OWN') ?? null;
    const series = computeVMC(positions, COURSE, ownRow?.roundings ?? null, roundings.seqs);
    expect(series.entries[0].vmc).toBeCloseTo(0, 2);
  });
});
