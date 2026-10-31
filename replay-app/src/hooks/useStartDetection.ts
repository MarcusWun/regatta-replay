// Compute the replay t=0 per PRD §2.4:
//   t=0 = (earliest start-line crossing across all tracked vessels) − 5 min
//   Fallbacks:
//     - no crossing at all → earliest position timestamp
//     - computed t=0 earlier than earliest position → clamp to earliest position
import { useMemo } from 'react';
import { detectFirstCrossing } from '../lib/geo';
import type { PositionRow, RaceMarkRow } from '../lib/types';

export interface StartDetectionResult {
  /** Replay t=0 as a UTC ISO string. */
  t0: string | null;
  /** Earliest position timestamp seen across all vessels. */
  tFirst: string | null;
  /** Last position timestamp seen (= replay end). */
  tLast: string | null;
  /** Earliest crossing timestamp detected (may be null). */
  firstCrossing: string | null;
  /** Which heuristic produced t0, for debug UI. */
  source: 'crossing' | 'first-position' | 'clamped-to-first' | 'empty';
}

export function computeStartDetection(
  marks: RaceMarkRow[],
  positions: PositionRow[],
): StartDetectionResult {
  if (positions.length === 0) {
    return { t0: null, tFirst: null, tLast: null, firstCrossing: null, source: 'empty' };
  }
  const sortedByTime = positions.slice().sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));
  const tFirst = sortedByTime[0].timestamp_utc;
  const tLast = sortedByTime[sortedByTime.length - 1].timestamp_utc;

  // Need start mark + at least one more mark for a direction.
  const sortedMarks = marks.slice().sort((a, b) => a.seq - b.seq);
  const startMark = sortedMarks.find((m) => m.is_start === 1) ?? sortedMarks[0];
  const nextMark = sortedMarks.find((m) => m.seq > (startMark?.seq ?? -Infinity));
  if (!startMark || !nextMark) {
    return { t0: tFirst, tFirst, tLast, firstCrossing: null, source: 'first-position' };
  }

  // Group positions by mmsi and detect crossings per-vessel; keep the earliest.
  const byMmsi = new Map<string, PositionRow[]>();
  for (const p of positions) {
    const arr = byMmsi.get(p.mmsi) ?? [];
    arr.push(p);
    byMmsi.set(p.mmsi, arr);
  }

  let earliestCrossing: string | null = null;
  for (const [, track] of byMmsi) {
    const crossing = detectFirstCrossing(
      { lat: startMark.lat, lon: startMark.lon },
      { lat: nextMark.lat, lon: nextMark.lon },
      track,
    );
    if (crossing != null && (earliestCrossing == null || crossing < earliestCrossing)) {
      earliestCrossing = crossing;
    }
  }

  if (earliestCrossing == null) {
    return { t0: tFirst, tFirst, tLast, firstCrossing: null, source: 'first-position' };
  }

  const crossingMs = Date.parse(earliestCrossing);
  const candidate = new Date(crossingMs - 5 * 60 * 1000).toISOString();
  if (candidate < tFirst) {
    return { t0: tFirst, tFirst, tLast, firstCrossing: earliestCrossing, source: 'clamped-to-first' };
  }
  return { t0: candidate, tFirst, tLast, firstCrossing: earliestCrossing, source: 'crossing' };
}

export function useStartDetection(
  marks: RaceMarkRow[],
  positions: PositionRow[],
): StartDetectionResult {
  return useMemo(() => computeStartDetection(marks, positions), [marks, positions]);
}
