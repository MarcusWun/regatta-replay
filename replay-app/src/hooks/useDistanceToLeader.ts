// Live distance-to-leader bars at the current replay timestamp.
//
// For each visible boat we determine the next unrounded waypoint from its
// rounding table (precomputed by useMarkRoundings) and project the boat's
// current position onto the current→next course leg. The leader is the
// boat with the shortest remaining distance to the finish; everyone else
// is displayed as nm behind the leader.
//
// Boats projecting AWAY from the next mark (negative dot product) are
// flagged as `offCourse` — the UI renders them with a red "off course" bar
// to make bad tactical calls obvious during review.
import { useMemo } from 'react';
import {
  haversineMeters,
  interpolateCurrent,
  localProject,
} from '../lib/geo';
import type { PositionRow, RaceMarkRow } from '../lib/types';
import type { MarkRoundingTable } from './useMarkRoundings';

const METERS_PER_NM = 1852;

export interface DistanceEntry {
  mmsi: string;
  /** Along-course distance (metres) remaining to the finish, counting all unrounded legs. */
  distanceToFinishM: number | null;
  /** Delta vs the leader in nm; 0 for the leader, >0 for everyone else. Null if boat has no track. */
  deltaBehindLeaderNm: number | null;
  /** True when the boat is projecting away from the next mark. */
  offCourse: boolean;
  /** Seq of the mark the boat is currently sailing toward (or null if finished / no track). */
  nextMarkSeq: number | null;
}

export interface DistanceSnapshot {
  entries: DistanceEntry[];
  leaderMmsi: string | null;
}

export function computeDistanceSnapshot(
  marks: RaceMarkRow[],
  positionsByMmsi: Map<string, PositionRow[]>,
  roundings: MarkRoundingTable,
  nowMs: number,
): DistanceSnapshot {
  const sortedMarks = marks.slice().sort((a, b) => a.seq - b.seq);
  if (sortedMarks.length < 2) {
    return { entries: [], leaderMmsi: null };
  }

  const seqIndex = new Map<number, number>();
  sortedMarks.forEach((m, i) => seqIndex.set(m.seq, i));

  // Precompute cumulative leg lengths from each waypoint to the finish so
  // along-course distances compose across unrounded legs.
  const remainingAfter: number[] = new Array(sortedMarks.length).fill(0);
  for (let i = sortedMarks.length - 2; i >= 0; i--) {
    const legLen = haversineMeters(
      { lat: sortedMarks[i].lat, lon: sortedMarks[i].lon },
      { lat: sortedMarks[i + 1].lat, lon: sortedMarks[i + 1].lon },
    );
    remainingAfter[i] = remainingAfter[i + 1] + legLen;
  }

  const roundingByMmsi = new Map(roundings.rows.map((r) => [r.mmsi, r.roundings]));

  const entries: DistanceEntry[] = [];
  for (const [mmsi, track] of positionsByMmsi) {
    const fix = interpolateCurrent(track, nowMs);
    if (!fix) {
      entries.push({
        mmsi,
        distanceToFinishM: null,
        deltaBehindLeaderNm: null,
        offCourse: false,
        nextMarkSeq: null,
      });
      continue;
    }

    const roundingTimes = roundingByMmsi.get(mmsi) ?? {};
    let nextIdx = -1;
    for (let i = 0; i < sortedMarks.length - 1; i++) {
      const seq = sortedMarks[i].seq;
      const r = roundingTimes[seq];
      const roundedByNow =
        r?.timestampUtc != null && Date.parse(r.timestampUtc) <= nowMs;
      if (!roundedByNow) {
        nextIdx = i;
        break;
      }
    }
    if (nextIdx === -1) {
      // Boat has rounded every waypoint — treat as finished.
      entries.push({
        mmsi,
        distanceToFinishM: 0,
        deltaBehindLeaderNm: 0,
        offCourse: false,
        nextMarkSeq: null,
      });
      continue;
    }

    const nextMark = sortedMarks[nextIdx];
    const prevMark = nextIdx > 0 ? sortedMarks[nextIdx - 1] : null;
    const boat = { lat: fix.lat, lon: fix.lon };
    const toNextM = haversineMeters(boat, { lat: nextMark.lat, lon: nextMark.lon });
    const totalRemainingM = toNextM + remainingAfter[nextIdx];

    // Off-course heuristic: project (boat → nextMark) onto (prevMark → nextMark).
    // When the projection is negative the boat has drifted past nextMark on
    // the course axis without rounding — the Phase 2a "upwind" case the PRD
    // calls out. Falls back to false when the boat hasn't rounded anything
    // yet (there's no prevMark reference line to compare against).
    let offCourse = false;
    if (prevMark) {
      const legDir = localProject(
        { lat: prevMark.lat, lon: prevMark.lon },
        { lat: nextMark.lat, lon: nextMark.lon },
      );
      const legLen = Math.hypot(legDir.x, legDir.y);
      if (legLen > 1e-6) {
        const boatOffPrev = localProject({ lat: prevMark.lat, lon: prevMark.lon }, boat);
        const projection = (boatOffPrev.x * legDir.x + boatOffPrev.y * legDir.y) / legLen;
        offCourse = projection > legLen; // past nextMark without rounding
      }
    }

    entries.push({
      mmsi,
      distanceToFinishM: totalRemainingM,
      deltaBehindLeaderNm: null, // filled below
      offCourse,
      nextMarkSeq: nextMark.seq,
    });
  }

  // Leader = smallest non-null distance. Off-course boats still ranked by
  // their raw distance so the UI can show "off course + N nm behind".
  let leaderMmsi: string | null = null;
  let leaderDist = Infinity;
  for (const e of entries) {
    if (e.distanceToFinishM == null) continue;
    if (e.distanceToFinishM < leaderDist) {
      leaderDist = e.distanceToFinishM;
      leaderMmsi = e.mmsi;
    }
  }

  for (const e of entries) {
    if (e.distanceToFinishM == null) continue;
    e.deltaBehindLeaderNm = (e.distanceToFinishM - leaderDist) / METERS_PER_NM;
  }

  entries.sort((a, b) => {
    if (a.deltaBehindLeaderNm == null) return 1;
    if (b.deltaBehindLeaderNm == null) return -1;
    return a.deltaBehindLeaderNm - b.deltaBehindLeaderNm;
  });

  return { entries, leaderMmsi };
}

export function useDistanceToLeader(
  marks: RaceMarkRow[],
  positionsByMmsi: Map<string, PositionRow[]>,
  roundings: MarkRoundingTable,
  nowMs: number,
): DistanceSnapshot {
  return useMemo(
    () => computeDistanceSnapshot(marks, positionsByMmsi, roundings, nowMs),
    [marks, positionsByMmsi, roundings, nowMs],
  );
}
