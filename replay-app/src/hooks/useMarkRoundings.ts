// Per-boat rounding times for every waypoint pair.
//
// Mark rounding is time-invariant for a loaded race.db — detection runs
// once at load time by scanning each boat's track forward and emitting the
// first perpendicular crossing for each waypoint. The result is memoised
// against the (marks, positions) reference pair so a replay scrub never
// recomputes.
import { useMemo } from 'react';
import { detectRounding } from '../lib/geo';
import type { PositionRow, RaceMarkRow } from '../lib/types';

export interface MarkRoundingCell {
  /** ISO UTC timestamp of the first crossing, or null if the boat never rounded this mark in the recorded window. */
  timestampUtc: string | null;
}

export interface MarkRoundingRow {
  mmsi: string;
  /** Indexed by waypoint seq (sorted); value is the rounding cell. */
  roundings: Record<number, MarkRoundingCell>;
}

export interface MarkRoundingTable {
  /** Waypoint seq numbers in sorted order (ignoring the final mark — nothing to "round" past the last). */
  seqs: number[];
  rows: MarkRoundingRow[];
}

export function computeMarkRoundings(
  marks: RaceMarkRow[],
  positions: PositionRow[],
): MarkRoundingTable {
  const sortedMarks = marks.slice().sort((a, b) => a.seq - b.seq);
  // Each (seq, next) pair defines one rounding perpendicular.
  const pairs: Array<{ n: RaceMarkRow; next: RaceMarkRow }> = [];
  for (let i = 0; i < sortedMarks.length - 1; i++) {
    pairs.push({ n: sortedMarks[i], next: sortedMarks[i + 1] });
  }

  const byMmsi = new Map<string, PositionRow[]>();
  for (const p of positions) {
    const arr = byMmsi.get(p.mmsi) ?? [];
    arr.push(p);
    byMmsi.set(p.mmsi, arr);
  }
  for (const arr of byMmsi.values()) {
    arr.sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));
  }

  const rows: MarkRoundingRow[] = [];
  for (const [mmsi, track] of byMmsi) {
    const cells: Record<number, MarkRoundingCell> = {};
    for (const { n, next } of pairs) {
      cells[n.seq] = {
        timestampUtc: detectRounding(
          { lat: n.lat, lon: n.lon },
          { lat: next.lat, lon: next.lon },
          track,
        ),
      };
    }
    rows.push({ mmsi, roundings: cells });
  }
  rows.sort((a, b) => a.mmsi.localeCompare(b.mmsi));

  return { seqs: pairs.map((p) => p.n.seq), rows };
}

export function useMarkRoundings(
  marks: RaceMarkRow[],
  positions: PositionRow[],
): MarkRoundingTable {
  return useMemo(() => computeMarkRoundings(marks, positions), [marks, positions]);
}
