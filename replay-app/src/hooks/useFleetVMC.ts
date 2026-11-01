// Fleet VMC: velocity made good toward each boat's own next unrounded mark.
//
// Generalisation of useVMC from own-boat (Phase 2b.1) to every tracked boat.
// Each boat has an independent target mark derived from its own row in
// useMarkRoundings — competitors at different stages of the race aim at
// different marks at the same wall-clock moment.
//
// For every boat position fix we compute:
//   • raw instantaneous VMC = SOG × cos(COG − bearing-to-that-boat's-next-mark)
//   • a 10-min trailing moving average over samples that share the current
//     target mark (mixing targets across a leg boundary would blur the
//     rounding step)
//   • a dashed flag that is true when the window holds <5 matching samples
//     (freshly-appeared competitors or just-rounded transitions). In those
//     stretches the chart plots the raw value — honest about uncertainty.
//
// The whole dataset is time-invariant once positions + marks are known, so
// everything is precomputed and memoised against (positions, marks,
// roundings). The replay clock drives only the chart cursor, not recompute.
import { useMemo } from 'react';
import { computeVMC, type VMCSeries } from './useVMC';
import type { PositionRow, RaceMarkRow } from '../lib/types';
import type { MarkRoundingTable } from './useMarkRoundings';

export const FLEET_VMC_WINDOW_MS = 10 * 60 * 1000;
export const FLEET_VMC_MIN_SAMPLES_FOR_SMOOTHING = 5;

export interface FleetVMCSample {
  timestampMs: number;
  /** Plotted value in knots. Smoothed when `dashed=false`, raw when `dashed=true`. */
  value: number;
  /** True when the trailing 10-min window has <5 matching-target samples. */
  dashed: boolean;
  targetMarkSeq: number;
  targetMarkName: string;
}

export interface FleetVMCBoat {
  mmsi: string;
  samples: FleetVMCSample[];
}

export interface FleetVMC {
  byMmsi: Map<string, FleetVMCBoat>;
  /** False when the race has no marks — the UI renders a placeholder. */
  hasCourse: boolean;
}

export function computeFleetVMC(
  positionsByMmsi: Map<string, PositionRow[]>,
  marks: RaceMarkRow[],
  roundingTable: MarkRoundingTable,
  windowMs = FLEET_VMC_WINDOW_MS,
): FleetVMC {
  const hasCourse = marks.length >= 1;
  const byMmsi = new Map<string, FleetVMCBoat>();
  if (!hasCourse) return { byMmsi, hasCourse: false };

  const rowByMmsi = new Map(roundingTable.rows.map((r) => [r.mmsi, r]));

  for (const [mmsi, track] of positionsByMmsi) {
    if (track.length === 0) continue;
    const row = rowByMmsi.get(mmsi) ?? null;
    const series = computeVMC(track, marks, row?.roundings ?? null, roundingTable.seqs);
    const samples = computeBoatSamples(series, windowMs);
    if (samples.length > 0) byMmsi.set(mmsi, { mmsi, samples });
  }

  return { byMmsi, hasCourse: true };
}

function computeBoatSamples(series: VMCSeries, windowMs: number): FleetVMCSample[] {
  const entries = series.entries;
  const samples: FleetVMCSample[] = [];
  if (entries.length === 0) return samples;

  // Two-pointer trailing window — entries are already sorted by timestamp.
  let left = 0;
  for (let i = 0; i < entries.length; i++) {
    const curr = entries[i];
    if (curr.vmc == null || curr.targetMarkSeq == null || curr.targetMarkName == null) continue;

    const windowStart = curr.timestampMs - windowMs;
    while (left < i && entries[left].timestampMs < windowStart) left++;

    let sum = 0;
    let count = 0;
    for (let j = left; j <= i; j++) {
      const e = entries[j];
      if (e.vmc != null && e.targetMarkSeq === curr.targetMarkSeq) {
        sum += e.vmc;
        count++;
      }
    }
    const dashed = count < FLEET_VMC_MIN_SAMPLES_FOR_SMOOTHING;
    const value = dashed ? curr.vmc : sum / count;
    samples.push({
      timestampMs: curr.timestampMs,
      value,
      dashed,
      targetMarkSeq: curr.targetMarkSeq,
      targetMarkName: curr.targetMarkName,
    });
  }

  return samples;
}

export function useFleetVMC(
  positionsByMmsi: Map<string, PositionRow[]>,
  marks: RaceMarkRow[],
  roundingTable: MarkRoundingTable,
): FleetVMC {
  return useMemo(
    () => computeFleetVMC(positionsByMmsi, marks, roundingTable),
    [positionsByMmsi, marks, roundingTable],
  );
}
