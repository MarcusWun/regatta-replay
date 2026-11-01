// VMG + polar % for the own-boat track, resolved against the race.db wind
// table and a user-selected polar.
//
// Each entry is pre-computed at every own-boat position fix (not per
// animation frame) and cached — the UI panel then just looks up the entry
// whose timestamp is <= nowMs. This keeps per-frame cost O(log n) rather
// than O(n) and makes the 10-minute sparkline cheap to slice.
import { useMemo } from 'react';
import { normaliseAngle180, nearestWind } from '../lib/wind';
import { interpolateSpeed } from '../lib/polar-engine/polar-engine';
import type { PolarTable } from '../lib/polar-engine/polar-engine';
import type { PositionRow, WindRow } from '../lib/types';

export interface PolarPerformanceEntry {
  timestampMs: number;
  sog: number | null;
  tws: number | null;
  twa: number | null; // in [-180,180], derived from COG - TWD
  /** VMG in knots; positive = upwind, negative = downwind. Null when sog/tws/twa missing. */
  vmg: number | null;
  /** Target polar speed in knots at (tws, |twa|). Null when polar lookup fails. */
  target: number | null;
  /** Percent of polar (sog / target × 100). Null when either input is null. */
  percent: number | null;
}

export interface PolarPerformanceSeries {
  entries: PolarPerformanceEntry[];
}

export function computePolarPerformance(
  ownPositions: PositionRow[],
  wind: WindRow[],
  polar: PolarTable | null,
): PolarPerformanceSeries {
  const sortedPositions = ownPositions
    .slice()
    .sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));

  const entries: PolarPerformanceEntry[] = sortedPositions.map((p) => {
    const timestampMs = Date.parse(p.timestamp_utc);
    const wrow = nearestWind(wind, timestampMs);
    const tws = wrow?.tws ?? null;
    const twd = wrow?.twd ?? null;
    const cog = p.cog;
    const sog = p.sog;
    const twa = cog != null && twd != null ? normaliseAngle180(cog - twd) : null;

    let vmg: number | null = null;
    if (sog != null && twa != null) {
      vmg = sog * Math.cos((twa * Math.PI) / 180);
    }

    let target: number | null = null;
    let percent: number | null = null;
    if (polar && tws != null && twa != null && sog != null) {
      target = interpolateSpeed(polar, tws, Math.abs(twa));
      if (target != null && target > 0) {
        percent = Math.round((sog / target) * 1000) / 10; // 0.1 % resolution
      }
    }

    return {
      timestampMs,
      sog,
      tws,
      twa,
      vmg,
      target,
      percent,
    };
  });

  return { entries };
}

/**
 * Binary-search the entry whose timestamp is <= nowMs. Returns null before
 * the first fix.
 */
export function performanceAt(
  series: PolarPerformanceSeries,
  nowMs: number,
): PolarPerformanceEntry | null {
  const { entries } = series;
  if (entries.length === 0) return null;
  if (nowMs < entries[0].timestampMs) return null;

  let lo = 0;
  let hi = entries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (entries[mid].timestampMs <= nowMs) lo = mid;
    else hi = mid - 1;
  }
  return entries[lo];
}

/**
 * Slice of entries covering the trailing `windowMs` of the current replay
 * clock — used by the 10-min sparkline cards.
 */
export function performanceWindow(
  series: PolarPerformanceSeries,
  nowMs: number,
  windowMs: number,
): PolarPerformanceEntry[] {
  const start = nowMs - windowMs;
  const slice: PolarPerformanceEntry[] = [];
  for (const e of series.entries) {
    if (e.timestampMs > nowMs) break;
    if (e.timestampMs >= start) slice.push(e);
  }
  return slice;
}

export function usePolarPerformance(
  ownPositions: PositionRow[],
  wind: WindRow[],
  polar: PolarTable | null,
): PolarPerformanceSeries {
  return useMemo(
    () => computePolarPerformance(ownPositions, wind, polar),
    [ownPositions, wind, polar],
  );
}
