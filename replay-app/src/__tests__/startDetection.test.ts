import { describe, expect, it } from 'vitest';
import { computeStartDetection } from '../hooks/useStartDetection';
import type { PositionRow, RaceMarkRow } from '../lib/types';

const marks: RaceMarkRow[] = [
  { seq: 1, name: 'Start', lat: 41.5, lon: -70.6, is_start: 1, is_finish: 0 },
  { seq: 2, name: 'W1', lat: 41.6, lon: -70.6, is_start: 0, is_finish: 1 },
];

function pos(mmsi: string, iso: string, lat: number, lon: number): PositionRow {
  return {
    mmsi,
    timestamp_utc: iso,
    lat,
    lon,
    sog: null,
    cog: null,
    heading: null,
    source: 'ais',
    interpolated: 0,
  };
}

describe('computeStartDetection', () => {
  it('returns source=empty when there are no positions', () => {
    const r = computeStartDetection(marks, []);
    expect(r.source).toBe('empty');
    expect(r.t0).toBeNull();
  });

  it('falls back to the first-position timestamp when no vessel crosses', () => {
    const positions = [
      pos('AAA', '2026-10-30T12:00:00Z', 41.49, -70.6),
      pos('AAA', '2026-10-30T12:00:10Z', 41.489, -70.6), // never crosses
    ];
    const r = computeStartDetection(marks, positions);
    expect(r.source).toBe('first-position');
    expect(r.t0).toBe('2026-10-30T12:00:00Z');
  });

  it('sets t0 to 5 min before the earliest crossing', () => {
    const positions = [
      pos('AAA', '2026-10-30T11:50:00Z', 41.49, -70.6),
      pos('AAA', '2026-10-30T12:00:00Z', 41.51, -70.6), // crossing
      pos('BBB', '2026-10-30T11:50:00Z', 41.49, -70.6),
      pos('BBB', '2026-10-30T12:05:00Z', 41.51, -70.6), // later crossing
    ];
    const r = computeStartDetection(marks, positions);
    expect(r.source).toBe('crossing');
    expect(r.firstCrossing).toBe('2026-10-30T12:00:00Z');
    expect(r.t0).toBe('2026-10-30T11:55:00.000Z');
  });

  it('clamps to the first position when the 5-min-before anchor would precede the log', () => {
    const positions = [
      pos('AAA', '2026-10-30T11:58:00Z', 41.49, -70.6), // log starts here
      pos('AAA', '2026-10-30T12:00:00Z', 41.51, -70.6), // crossing (only 2 min after)
    ];
    const r = computeStartDetection(marks, positions);
    expect(r.source).toBe('clamped-to-first');
    expect(r.t0).toBe('2026-10-30T11:58:00Z');
  });
});
