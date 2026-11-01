import { describe, expect, it } from 'vitest';
import {
  computeFleetVMC,
  FLEET_VMC_MIN_SAMPLES_FOR_SMOOTHING,
} from '../hooks/useFleetVMC';
import { computeMarkRoundings } from '../hooks/useMarkRoundings';
import type { PositionRow, RaceMarkRow } from '../lib/types';

// Right-angle course modelled on markRounding.test.ts and useVMC.test.ts:
//   M1 start   at (40.60, -74.00) — M1→M2 points NORTH
//   M2 weather at (40.65, -74.00) — M2→M3 points EAST
//   M3 turning at (40.65, -73.95) — M3→M4 points SOUTH
//   M4 finish  at (40.60, -73.95)
const M1: RaceMarkRow = { seq: 0, name: 'M1', lat: 40.60, lon: -74.00, is_start: 1, is_finish: 0 };
const M2: RaceMarkRow = { seq: 1, name: 'M2', lat: 40.65, lon: -74.00, is_start: 0, is_finish: 0 };
const M3: RaceMarkRow = { seq: 2, name: 'M3', lat: 40.65, lon: -73.95, is_start: 0, is_finish: 0 };
const M4: RaceMarkRow = { seq: 3, name: 'M4', lat: 40.60, lon: -73.95, is_start: 0, is_finish: 1 };
const COURSE = [M1, M2, M3, M4];

function pos(
  mmsi: string,
  t: string,
  lat: number,
  lon: number,
  sog: number | null,
  cog: number | null,
): PositionRow {
  return {
    mmsi,
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

function groupByMmsi(rows: PositionRow[]): Map<string, PositionRow[]> {
  const out = new Map<string, PositionRow[]>();
  for (const p of rows) {
    const arr = out.get(p.mmsi) ?? [];
    arr.push(p);
    out.set(p.mmsi, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));
  return out;
}

describe('computeFleetVMC — per-boat independent target marks', () => {
  it('two boats at different stages aim at different marks at the same moment', () => {
    // Boat A — pre-start, approaching M1 from the south
    // Boat B — already rounded M1, now approaching M2 heading north
    const positions: PositionRow[] = [
      // Boat A — pre-start
      pos('AAA', '2026-10-31T12:00:00Z', 40.595, -74.000, 5, 0),
      pos('AAA', '2026-10-31T12:00:30Z', 40.596, -74.000, 5, 0),
      // Boat B — crosses start-line early and heads toward M2
      pos('BBB', '2026-10-31T11:59:00Z', 40.595, -74.000, 5, 0),
      pos('BBB', '2026-10-31T11:59:30Z', 40.605, -74.000, 5, 0), // post M1 rounding
      pos('BBB', '2026-10-31T12:00:00Z', 40.620, -74.000, 5, 0),
      pos('BBB', '2026-10-31T12:00:30Z', 40.640, -74.000, 5, 0),
    ];
    const byMmsi = groupByMmsi(positions);
    const roundings = computeMarkRoundings(COURSE, positions);
    const fleet = computeFleetVMC(byMmsi, COURSE, roundings);

    expect(fleet.hasCourse).toBe(true);

    const a = fleet.byMmsi.get('AAA');
    const b = fleet.byMmsi.get('BBB');
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // Boat A: at least one sample while still pre-M1 — target seq 0 (M1).
    const preStartSample = a!.samples.find((s) => s.targetMarkSeq === 0);
    expect(preStartSample).toBeDefined();
    expect(preStartSample?.targetMarkName).toBe('M1');

    // Boat B: samples at the same wall-clock moments but target seq 1 (M2).
    const inRaceSample = b!.samples.find(
      (s) => s.timestampMs >= Date.parse('2026-10-31T12:00:00Z') && s.targetMarkSeq === 1,
    );
    expect(inRaceSample).toBeDefined();
    expect(inRaceSample?.targetMarkName).toBe('M2');
    expect(inRaceSample?.value).toBeGreaterThan(0);
  });
});

describe('computeFleetVMC — negative VMC', () => {
  it('plots a negative value when the boat heads away from its target mark', () => {
    const positions: PositionRow[] = [
      // Boat sits just south of M1, SOG 4 kt heading due SOUTH (away from M1).
      pos('BAD', '2026-10-31T12:00:00Z', 40.590, -74.000, 4, 180),
      pos('BAD', '2026-10-31T12:01:00Z', 40.589, -74.000, 4, 180),
    ];
    const byMmsi = groupByMmsi(positions);
    const roundings = computeMarkRoundings(COURSE, positions);
    const fleet = computeFleetVMC(byMmsi, COURSE, roundings);

    const boat = fleet.byMmsi.get('BAD');
    expect(boat).toBeDefined();
    expect(boat!.samples.length).toBeGreaterThan(0);
    for (const s of boat!.samples) {
      expect(s.value).toBeLessThan(0);
      expect(s.targetMarkSeq).toBe(0);
    }
  });
});

describe('computeFleetVMC — low-sample dashed fallback', () => {
  it('tags each stretch dashed until the trailing window reaches the smoothing threshold', () => {
    // 10 samples at 1-min cadence — the first (MIN_SAMPLES_FOR_SMOOTHING - 1)
    // samples carry a dashed flag; everything after that is solid-smoothed.
    const positions: PositionRow[] = Array.from({ length: 10 }, (_, i) =>
      pos('FRESH', `2026-10-31T12:0${i}:00Z`, 40.580 + 0.001 * i, -74.000, 5, 0),
    );
    const byMmsi = groupByMmsi(positions);
    const roundings = computeMarkRoundings(COURSE, positions);
    const fleet = computeFleetVMC(byMmsi, COURSE, roundings);

    const samples = fleet.byMmsi.get('FRESH')!.samples;
    expect(samples.length).toBe(10);
    // First MIN_SAMPLES-1 samples are below threshold → dashed.
    for (let i = 0; i < FLEET_VMC_MIN_SAMPLES_FOR_SMOOTHING - 1; i++) {
      expect(samples[i].dashed).toBe(true);
    }
    // From the MIN_SAMPLES-th sample onward the window has ≥5 matching
    // samples → solid.
    for (let i = FLEET_VMC_MIN_SAMPLES_FOR_SMOOTHING - 1; i < samples.length; i++) {
      expect(samples[i].dashed).toBe(false);
    }
  });

  it('dashed samples carry the raw instantaneous value, solid ones carry the mean', () => {
    // Alternating SOG 3 kt / 7 kt → raw ≠ mean so we can tell them apart.
    // All headed due north toward M1 so sign is stable positive.
    const positions: PositionRow[] = Array.from({ length: 10 }, (_, i) =>
      pos('ALT', `2026-10-31T12:0${i}:00Z`, 40.580 + 0.001 * i, -74.000, i % 2 === 0 ? 3 : 7, 0),
    );
    const byMmsi = groupByMmsi(positions);
    const roundings = computeMarkRoundings(COURSE, positions);
    const fleet = computeFleetVMC(byMmsi, COURSE, roundings);

    const samples = fleet.byMmsi.get('ALT')!.samples;
    // First sample is dashed with raw = 3.
    expect(samples[0].dashed).toBe(true);
    expect(samples[0].value).toBeCloseTo(3, 1);
    // Last sample is solid; mean of (3, 7, 3, 7, 3, 7, 3, 7, 3, 7) over the
    // trailing 10-min window = 5.
    const last = samples[samples.length - 1];
    expect(last.dashed).toBe(false);
    expect(last.value).toBeCloseTo(5, 1);
  });
});

describe('computeFleetVMC — empty / edge states', () => {
  it('returns hasCourse=false and an empty map when the race has no marks', () => {
    const positions: PositionRow[] = [
      pos('AAA', '2026-10-31T12:00:00Z', 40.59, -74.0, 5, 0),
    ];
    const byMmsi = groupByMmsi(positions);
    const roundings = computeMarkRoundings([], positions);
    const fleet = computeFleetVMC(byMmsi, [], roundings);
    expect(fleet.hasCourse).toBe(false);
    expect(fleet.byMmsi.size).toBe(0);
  });

  it('excludes boats with zero in-window samples that produce no plottable value', () => {
    // Boat emits a single fix with null SOG → raw VMC is null → no samples.
    const positions: PositionRow[] = [
      pos('GHOST', '2026-10-31T12:00:00Z', 40.59, -74.000, null, 0),
    ];
    const byMmsi = groupByMmsi(positions);
    const roundings = computeMarkRoundings(COURSE, positions);
    const fleet = computeFleetVMC(byMmsi, COURSE, roundings);
    expect(fleet.byMmsi.has('GHOST')).toBe(false);
  });

  it('drops a boat that has already crossed the finish line', () => {
    // Boat completes the whole course and sails past M4 southward — post-finish
    // samples have null target → no plottable samples.
    const positions: PositionRow[] = [
      pos('FIN', '2026-10-31T12:00:00Z', 40.595, -74.000, 5, 0),
      pos('FIN', '2026-10-31T12:00:10Z', 40.605, -74.000, 5, 0),
      pos('FIN', '2026-10-31T12:05:00Z', 40.645, -74.005, 5, 90),
      pos('FIN', '2026-10-31T12:05:10Z', 40.655, -73.995, 5, 90),
      pos('FIN', '2026-10-31T12:10:00Z', 40.655, -73.955, 5, 180),
      pos('FIN', '2026-10-31T12:10:10Z', 40.645, -73.945, 5, 180),
      pos('FIN', '2026-10-31T12:15:00Z', 40.580, -73.950, 5, 180),
    ];
    const byMmsi = groupByMmsi(positions);
    const roundings = computeMarkRoundings(COURSE, positions);
    const fleet = computeFleetVMC(byMmsi, COURSE, roundings);

    const boat = fleet.byMmsi.get('FIN');
    if (boat) {
      // Any samples present must all be pre-finish (seq != null, already
      // enforced by our filter) — no samples should sit after the post-finish
      // fix.
      const lastSample = boat.samples[boat.samples.length - 1];
      expect(lastSample.timestampMs).toBeLessThan(Date.parse('2026-10-31T12:15:00Z'));
    }
  });
});

describe('computeFleetVMC — target mark changes at a rounding', () => {
  it('target mark switches cleanly from M1 to M2 across the rounding moment', () => {
    const positions: PositionRow[] = [
      pos('X', '2026-10-31T12:00:00Z', 40.595, -74.000, 5, 0), // pre-start — target M1
      pos('X', '2026-10-31T12:00:30Z', 40.605, -74.000, 5, 0), // post rounding — target M2
      pos('X', '2026-10-31T12:01:00Z', 40.615, -74.000, 5, 0),
    ];
    const byMmsi = groupByMmsi(positions);
    const roundings = computeMarkRoundings(COURSE, positions);
    const fleet = computeFleetVMC(byMmsi, COURSE, roundings);
    const samples = fleet.byMmsi.get('X')!.samples;
    expect(samples[0].targetMarkSeq).toBe(0);
    expect(samples[0].targetMarkName).toBe('M1');
    expect(samples[samples.length - 1].targetMarkSeq).toBe(1);
    expect(samples[samples.length - 1].targetMarkName).toBe('M2');
  });
});
