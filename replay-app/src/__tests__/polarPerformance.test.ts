import { describe, expect, it } from 'vitest';
import {
  computePolarPerformance,
  performanceAt,
  performanceWindow,
} from '../hooks/usePolarPerformance';
import type { PolarTable } from '../lib/polar-engine/polar-engine';
import type { PositionRow, WindRow } from '../lib/types';

const SIMPLE_POLAR: PolarTable = {
  tws: [6, 10, 14],
  twa: [40, 60, 90, 120, 150],
  speeds: [
    [2.0, 3.0, 3.5, 3.0, 2.5],
    [3.5, 5.0, 5.5, 5.0, 4.5],
    [5.0, 7.0, 7.5, 7.0, 6.5],
  ],
};

function pos(t: string, sog: number, cog: number): PositionRow {
  return {
    mmsi: 'OWN',
    timestamp_utc: t,
    lat: 40.6,
    lon: -74.0,
    sog,
    cog,
    heading: null,
    source: 'test',
    interpolated: 0,
  };
}

function wind(t: string, tws: number, twd: number): WindRow {
  return { timestamp_utc: t, tws, twd, aws: null, awa: null, source: 'test' };
}

describe('computePolarPerformance', () => {
  it('computes VMG, target, and percent at each own-boat fix', () => {
    const positions = [
      pos('2026-10-31T12:00:00Z', 5.0, 60), // COG=60
      pos('2026-10-31T12:00:01Z', 5.0, 60),
    ];
    const winds = [
      wind('2026-10-31T12:00:00Z', 10, 0), // TWD=0, so TWA = 60 (close reach)
      wind('2026-10-31T12:00:01Z', 10, 0),
    ];
    const series = computePolarPerformance(positions, winds, SIMPLE_POLAR);
    expect(series.entries).toHaveLength(2);
    const e0 = series.entries[0];
    expect(e0.tws).toBe(10);
    expect(e0.twa).toBe(60);
    // At TWS=10, TWA=60 → target 5.0; sog=5.0 → polar% = 100
    expect(e0.target).toBe(5.0);
    expect(e0.percent).toBe(100);
    // VMG = 5.0 × cos(60°) = 2.5
    expect(e0.vmg).toBeCloseTo(2.5, 2);
  });

  it('returns nulls when wind is missing beyond tolerance', () => {
    const positions = [pos('2026-10-31T12:00:00Z', 5.0, 60)];
    const winds = [wind('2026-10-31T12:00:30Z', 10, 0)]; // 30s off
    const series = computePolarPerformance(positions, winds, SIMPLE_POLAR);
    const e = series.entries[0];
    expect(e.tws).toBeNull();
    expect(e.twa).toBeNull();
    expect(e.vmg).toBeNull();
    expect(e.target).toBeNull();
    expect(e.percent).toBeNull();
  });

  it('returns VMG without polar% when polar is null', () => {
    const positions = [pos('2026-10-31T12:00:00Z', 5.0, 60)];
    const winds = [wind('2026-10-31T12:00:00Z', 10, 0)];
    const series = computePolarPerformance(positions, winds, null);
    const e = series.entries[0];
    expect(e.vmg).toBeCloseTo(2.5, 2);
    expect(e.target).toBeNull();
    expect(e.percent).toBeNull();
  });

  it('normalises TWA into [-180, 180] for signed VMG', () => {
    const positions = [pos('2026-10-31T12:00:00Z', 6.0, 180)]; // directly downwind, TWD=0
    const winds = [wind('2026-10-31T12:00:00Z', 10, 0)];
    const series = computePolarPerformance(positions, winds, SIMPLE_POLAR);
    const e = series.entries[0];
    expect(e.twa).toBe(180);
    expect(e.vmg).toBeCloseTo(-6.0, 2);
  });
});

describe('performanceAt / performanceWindow', () => {
  const positions = [
    pos('2026-10-31T12:00:00Z', 5.0, 60),
    pos('2026-10-31T12:01:00Z', 5.2, 60),
    pos('2026-10-31T12:11:00Z', 5.3, 60),
  ];
  const winds = positions.map((p) => wind(p.timestamp_utc, 10, 0));
  const series = computePolarPerformance(positions, winds, SIMPLE_POLAR);

  it('returns null before the first fix', () => {
    expect(performanceAt(series, Date.parse('2026-10-31T11:59:00Z'))).toBeNull();
  });

  it('finds the latest entry at or before nowMs', () => {
    const e = performanceAt(series, Date.parse('2026-10-31T12:00:30Z'));
    expect(e?.sog).toBe(5.0);
  });

  it('slices the trailing window', () => {
    const slice = performanceWindow(
      series,
      Date.parse('2026-10-31T12:11:00Z'),
      10 * 60 * 1000,
    );
    expect(slice).toHaveLength(2); // 12:01 and 12:11; 12:00 is 11m back
  });
});
