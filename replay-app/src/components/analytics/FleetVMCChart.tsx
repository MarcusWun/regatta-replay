// Fleet VMC time-series chart via Observable Plot. One smoothed VMC line per
// visible boat on a replay-relative X axis (seconds since t=0) and a Y axis
// auto-scaled to span negative-and-positive VMC. The zero rule is emphasised
// so "going the wrong way" is instantly visible as area below the line.
//
// Dashed stretches flag low-sample windows (<5 samples); those use the raw
// instantaneous VMC rather than the trailing average. See useFleetVMC.
import { useEffect, useRef } from 'react';
import * as Plot from '@observablehq/plot';
import { colorForMmsi, OWN_BOAT_COLOR, rgbToCss } from '../../lib/colors';
import type { VesselRow } from '../../lib/types';
import type { FleetVMC, FleetVMCSample } from '../../hooks/useFleetVMC';
import { displayLabel } from './BoatSelector';

export interface FleetVMCChartProps {
  fleetVmc: FleetVMC;
  vessels: VesselRow[];
  ownMmsi: string | null;
  hidden: Set<string>;
  startMs: number;
  endMs: number;
  nowMs: number;
}

interface Datum {
  mmsi: string;
  runId: string;
  label: string;
  color: string;
  tSec: number;
  vmc: number;
  targetMarkName: string;
}

interface Run {
  mmsi: string;
  runId: string;
  dashed: boolean;
  data: Datum[];
}

/**
 * Split a boat's samples into contiguous runs grouped by `dashed`. The boundary
 * sample is duplicated into the next run so the solid↔dashed transition on the
 * chart has no visual gap.
 */
export function splitRuns(
  mmsi: string,
  label: string,
  color: string,
  samples: FleetVMCSample[],
  startMs: number,
  endMs: number,
): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  let runSeq = 0;
  for (const s of samples) {
    if (s.timestampMs < startMs || s.timestampMs > endMs) continue;
    const datum: Datum = {
      mmsi,
      runId: '',
      label,
      color,
      tSec: (s.timestampMs - startMs) / 1000,
      vmc: s.value,
      targetMarkName: s.targetMarkName,
    };
    if (!current || current.dashed !== s.dashed) {
      // Close prior run with duplicated boundary sample for visual continuity.
      if (current) {
        const boundary = { ...datum, runId: current.runId };
        current.data.push(boundary);
      }
      runSeq++;
      current = {
        mmsi,
        runId: `${mmsi}-${runSeq}`,
        dashed: s.dashed,
        data: [],
      };
      runs.push(current);
    }
    datum.runId = current.runId;
    current.data.push(datum);
  }
  return runs;
}

export function FleetVMCChart({
  fleetVmc,
  vessels,
  ownMmsi,
  hidden,
  startMs,
  endMs,
  nowMs,
}: FleetVMCChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!fleetVmc.hasCourse) return;

    const vesselByMmsi = new Map(vessels.map((v) => [v.mmsi, v]));
    const allRuns: Run[] = [];
    let yMin = -1;
    let yMax = 1;

    for (const [mmsi, boat] of fleetVmc.byMmsi) {
      if (hidden.has(mmsi)) continue;
      const vessel = vesselByMmsi.get(mmsi);
      const label = vessel ? displayLabel(vessel) : mmsi;
      const color = rgbToCss(mmsi === ownMmsi ? OWN_BOAT_COLOR : colorForMmsi(mmsi));
      const runs = splitRuns(mmsi, label, color, boat.samples, startMs, endMs);
      for (const r of runs) {
        for (const d of r.data) {
          if (d.vmc < yMin) yMin = d.vmc;
          if (d.vmc > yMax) yMax = d.vmc;
        }
        if (r.data.length > 0) allRuns.push(r);
      }
    }

    const cursorSec = Math.max(0, (nowMs - startMs) / 1000);
    const spanSec = Math.max(1, (endMs - startMs) / 1000);

    const lineMarks = allRuns.map((r) =>
      Plot.line(r.data, {
        x: 'tSec',
        y: 'vmc',
        stroke: 'color',
        strokeWidth: 1.2,
        strokeDasharray: r.dashed ? '3,2' : undefined,
        z: 'runId',
        tip: {
          format: {
            x: (v: number) => `T+${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`,
            y: (v: number) => `${v.toFixed(2)} kt`,
            color: null,
          },
        },
        title: (d: Datum) =>
          `${d.label} — ${d.vmc.toFixed(2)} kt → ${d.targetMarkName}`,
      }),
    );

    const chart = Plot.plot({
      width: el.clientWidth || 320,
      height: 180,
      marginLeft: 36,
      marginBottom: 28,
      marginTop: 8,
      marginRight: 8,
      style: { background: 'transparent', color: '#cbd5e1', fontSize: '10px' },
      x: {
        domain: [0, spanSec],
        label: 'min since start',
        tickFormat: (v: number) => `${Math.round(v / 60)}`,
      },
      y: {
        domain: [Math.floor(yMin - 0.5), Math.ceil(yMax + 0.5)],
        label: 'VMC (kt)',
        grid: true,
      },
      color: { legend: false },
      marks: [
        Plot.ruleY([0], {
          stroke: '#94a3b8',
          strokeOpacity: 0.9,
          strokeWidth: 1,
        }),
        ...lineMarks,
        Plot.ruleX([cursorSec], {
          stroke: '#f0abfc',
          strokeOpacity: 0.65,
          strokeWidth: 1.2,
        }),
      ],
    });

    el.innerHTML = '';
    el.append(chart);
    return () => {
      chart.remove();
    };
  }, [fleetVmc, vessels, hidden, ownMmsi, startMs, endMs, nowMs]);

  return (
    <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        VMC — fleet
      </h2>
      {fleetVmc.hasCourse ? (
        <div
          ref={containerRef}
          data-testid="fleet-vmc-chart"
          className="h-[180px] w-full"
        />
      ) : (
        <div
          data-testid="fleet-vmc-chart-empty"
          className="flex h-[180px] w-full items-center justify-center text-xs text-slate-500"
        >
          No course loaded — VMC unavailable
        </div>
      )}
    </section>
  );
}
