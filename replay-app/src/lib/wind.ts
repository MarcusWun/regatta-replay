// Wind-row lookup helper for Phase 2b analytics.
//
// Aeolus Phase 1.2 writes a `wind` table into race.db at ~1 Hz with columns
//   timestamp_utc TEXT PRIMARY KEY, tws REAL, twd REAL, aws REAL, awa REAL, source TEXT
// Older race.db files (anything captured this week before Phase 1.2 ships)
// have no `wind` table — all helpers here operate on the row array and
// return null when the array is empty, which is the Replay app's graceful-
// degradation path.
import type { WindRow } from './types';

const DEFAULT_TOLERANCE_MS = 2_000;

/**
 * Find the wind row whose timestamp is closest to `atMs`, provided it is
 * within `toleranceMs` of the request. Returns null when no row is in range
 * or when the table is empty.
 *
 * Expects `rows` sorted ascending by timestamp (as race.db returns them).
 */
export function nearestWind(
  rows: WindRow[],
  atMs: number,
  toleranceMs = DEFAULT_TOLERANCE_MS,
): WindRow | null {
  if (rows.length === 0) return null;

  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const midMs = Date.parse(rows[mid].timestamp_utc);
    if (midMs < atMs) lo = mid + 1;
    else hi = mid;
  }

  const candidates: WindRow[] = [];
  if (lo > 0) candidates.push(rows[lo - 1]);
  candidates.push(rows[lo]);
  if (lo + 1 < rows.length) candidates.push(rows[lo + 1]);

  let best: { row: WindRow; delta: number } | null = null;
  for (const r of candidates) {
    const delta = Math.abs(Date.parse(r.timestamp_utc) - atMs);
    if (best == null || delta < best.delta) best = { row: r, delta };
  }
  if (!best) return null;
  if (best.delta > toleranceMs) return null;
  return best.row;
}

/**
 * Normalise an angular delta into the (-180, 180] range so VMG can be
 * signed (upwind positive, downwind negative).
 */
export function normaliseAngle180(deg: number): number {
  let x = deg;
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x;
}
