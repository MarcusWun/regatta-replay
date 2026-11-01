// VMC (velocity made good toward the next mark) for the own-boat.
//
// VMC = SOG × cos(COG − bearing_to_next_mark), where the "next mark" is the
// first waypoint own-boat hasn't yet rounded at the current replay time:
//   • pre-start → marks[0] (the start pin)
//   • in-race   → the first mark in useMarkRoundings whose rounding
//                 timestamp is either null or still in the future
//   • final leg → the last mark (not covered by useMarkRoundings' pair-based
//                 crossings), kept until own-boat visibly passes it
//   • post-finish → null → the UI card renders "—"
//
// The whole series is pre-computed per own-boat fix (not per animation frame)
// and memoised against (positions, marks, roundings, ownMmsi). The replay-clock
// consumer then does an O(log n) lookup for the current entry and an O(window)
// slice for the 10-min sparkline + smoothed value.
import { useMemo } from 'react';
import { alongCourseDistance, initialBearing } from '../lib/geo';
import { normaliseAngle180 } from '../lib/wind';
import type { LatLon, PositionRow, RaceMarkRow } from '../lib/types';
import type { MarkRoundingTable } from './useMarkRoundings';

export interface VMCEntry {
  timestampMs: number;
  /** Instantaneous VMC in knots. Null when SOG/COG missing or no target mark. */
  vmc: number | null;
  /** Seq of the target mark at this fix, or null when post-finish / no course. */
  targetMarkSeq: number | null;
  /** Display name of the target mark, falls back to `Mark {seq+1}`. */
  targetMarkName: string | null;
}

export interface VMCSeries {
  entries: VMCEntry[];
}

export interface VMCSnapshot {
  /** Raw VMC at the current replay tick in knots, pre-smoothing. */
  instantaneous: number | null;
  /** 10-min moving average of instantaneous VMC, race-time windowed. */
  smoothed10min: number | null;
  /** Display name of the target mark (or null when post-finish / no course). */
  targetMarkName: string | null;
  targetMarkSeq: number | null;
  /** True when the smoothing window has <2 valid samples (fallback to raw). */
  isUnsmoothed: boolean;
  /** True when the race has at least one mark. */
  hasCourse: boolean;
  /** True when own-boat has rounded all marks and sailed past the finish. */
  postFinish: boolean;
}

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

export function computeVMC(
  ownPositions: PositionRow[],
  marks: RaceMarkRow[],
  ownRoundings: Record<number, { timestampUtc: string | null }> | null,
  pairSeqs: number[],
): VMCSeries {
  const sortedMarks = marks.slice().sort((a, b) => a.seq - b.seq);
  const sortedPositions = ownPositions
    .slice()
    .sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));

  if (sortedMarks.length === 0 || sortedPositions.length === 0) {
    return { entries: [] };
  }

  // Pre-parse rounding timestamps as ms for fast per-fix lookup.
  const roundingMs = new Map<number, number | null>();
  if (ownRoundings) {
    for (const seq of pairSeqs) {
      const ts = ownRoundings[seq]?.timestampUtc ?? null;
      roundingMs.set(seq, ts != null ? Date.parse(ts) : null);
    }
  }

  const lastIdx = sortedMarks.length - 1;
  const finishMark = sortedMarks[lastIdx];
  const penultimateMark = lastIdx >= 1 ? sortedMarks[lastIdx - 1] : null;
  // Virtual point extrapolating the final leg past the finish mark, used to
  // tell "approaching finish" from "already past the finish line".
  const virtualPastFinish: LatLon | null = penultimateMark
    ? {
        lat: finishMark.lat + (finishMark.lat - penultimateMark.lat),
        lon: finishMark.lon + (finishMark.lon - penultimateMark.lon),
      }
    : null;

  const entries: VMCEntry[] = sortedPositions.map((p) => {
    const tMs = Date.parse(p.timestamp_utc);
    const boat: LatLon = { lat: p.lat, lon: p.lon };
    const target = resolveTargetMark(
      sortedMarks,
      roundingMs,
      pairSeqs,
      boat,
      tMs,
      finishMark,
      virtualPastFinish,
    );

    if (!target) {
      return { timestampMs: tMs, vmc: null, targetMarkSeq: null, targetMarkName: null };
    }

    const sog = p.sog;
    const cog = p.cog;
    let vmc: number | null = null;
    if (sog != null && cog != null) {
      const bearing = initialBearing(boat, { lat: target.lat, lon: target.lon });
      const delta = normaliseAngle180(cog - bearing);
      vmc = sog * Math.cos((delta * Math.PI) / 180);
    }

    return {
      timestampMs: tMs,
      vmc,
      targetMarkSeq: target.seq,
      targetMarkName: markDisplayName(target),
    };
  });

  return { entries };
}

function resolveTargetMark(
  sortedMarks: RaceMarkRow[],
  roundingMs: Map<number, number | null>,
  pairSeqs: number[],
  boat: LatLon,
  tMs: number,
  finishMark: RaceMarkRow,
  virtualPastFinish: LatLon | null,
): RaceMarkRow | null {
  for (const seq of pairSeqs) {
    const ts = roundingMs.get(seq);
    const pending = ts == null || ts > tMs;
    if (pending) {
      const mark = sortedMarks.find((m) => m.seq === seq);
      return mark ?? null;
    }
  }
  // All tracked pair-based roundings done → own-boat is on the final leg
  // or past the finish line. Only one mark on the course? Nothing to aim at.
  if (virtualPastFinish == null) return null;
  const distAlong = alongCourseDistance(boat, finishMark, virtualPastFinish, 0);
  if (distAlong > 0) return finishMark;
  return null;
}

export function markDisplayName(mark: RaceMarkRow): string {
  const trimmed = mark.name?.trim();
  if (trimmed) return trimmed;
  return `Mark ${mark.seq + 1}`;
}

/** Binary-search the entry whose timestamp is <= nowMs. Null before first fix. */
export function vmcAt(series: VMCSeries, nowMs: number): VMCEntry | null {
  const { entries } = series;
  if (entries.length === 0 || nowMs < entries[0].timestampMs) return null;
  let lo = 0;
  let hi = entries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (entries[mid].timestampMs <= nowMs) lo = mid;
    else hi = mid - 1;
  }
  return entries[lo];
}

/** Trailing-window slice; both endpoints inclusive, upper capped at nowMs. */
export function vmcWindow(series: VMCSeries, nowMs: number, windowMs: number): VMCEntry[] {
  const start = nowMs - windowMs;
  const slice: VMCEntry[] = [];
  for (const e of series.entries) {
    if (e.timestampMs > nowMs) break;
    if (e.timestampMs >= start) slice.push(e);
  }
  return slice;
}

export function computeSnapshot(
  series: VMCSeries,
  nowMs: number,
  marks: RaceMarkRow[],
  windowMs = DEFAULT_WINDOW_MS,
): { snapshot: VMCSnapshot; window: VMCEntry[] } {
  const current = vmcAt(series, nowMs);
  const window = vmcWindow(series, nowMs, windowMs);
  const postFinish =
    marks.length >= 1 &&
    series.entries.length > 0 &&
    current != null &&
    current.targetMarkSeq == null;

  // When the current fix has no target (post-finish / no course), there is
  // nothing meaningful to average — even if the trailing window still holds
  // entries that targeted a now-stale mark.
  let smoothed: number | null = null;
  let isUnsmoothed = false;
  if (!postFinish && current?.targetMarkSeq != null) {
    // Only entries whose target matches the current one are averaged — mixing
    // different mark targets in one average would be meaningless.
    const matching = window.filter(
      (e) => e.vmc != null && e.targetMarkSeq === current.targetMarkSeq,
    ) as Array<VMCEntry & { vmc: number }>;
    if (matching.length >= 2) {
      const sum = matching.reduce((s, e) => s + e.vmc, 0);
      smoothed = sum / matching.length;
    } else if (current.vmc != null) {
      smoothed = current.vmc;
      isUnsmoothed = true;
    }
  }

  const snapshot: VMCSnapshot = {
    instantaneous: current?.vmc ?? null,
    smoothed10min: smoothed,
    targetMarkName: current?.targetMarkName ?? null,
    targetMarkSeq: current?.targetMarkSeq ?? null,
    isUnsmoothed,
    hasCourse: marks.length >= 1,
    postFinish,
  };
  return { snapshot, window };
}

export interface UseVMCResult {
  series: VMCSeries;
  snapshot: VMCSnapshot;
  window: VMCEntry[];
}

export function useVMC(
  ownPositions: PositionRow[],
  marks: RaceMarkRow[],
  roundingTable: MarkRoundingTable,
  ownMmsi: string | null,
  nowMs: number,
): UseVMCResult {
  const series = useMemo(() => {
    const ownRow = ownMmsi
      ? (roundingTable.rows.find((r) => r.mmsi === ownMmsi) ?? null)
      : null;
    return computeVMC(ownPositions, marks, ownRow?.roundings ?? null, roundingTable.seqs);
  }, [ownPositions, marks, roundingTable, ownMmsi]);

  const { snapshot, window } = computeSnapshot(series, nowMs, marks);
  return { series, snapshot, window };
}
