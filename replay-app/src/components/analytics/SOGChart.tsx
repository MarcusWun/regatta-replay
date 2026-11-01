// SOG time-series chart via Observable Plot. One line per visible boat on
// a replay-relative X axis (seconds since t=0) and a 0..maxSOG+1 Y axis.
// A vertical cursor tracks the current replay clock.
import { useEffect, useRef } from 'react';
import * as Plot from '@observablehq/plot';
import { colorForMmsi, OWN_BOAT_COLOR, rgbToCss } from '../../lib/colors';
import type { PositionRow, VesselRow } from '../../lib/types';
import { displayLabel } from './BoatSelector';

export interface SOGChartProps {
  positionsByMmsi: Map<string, PositionRow[]>;
  vessels: VesselRow[];
  ownMmsi: string | null;
  hidden: Set<string>;
  startMs: number;
  endMs: number;
  nowMs: number;
}

interface Datum {
  mmsi: string;
  label: string;
  color: string;
  tSec: number;
  sog: number;
}

export function SOGChart({
  positionsByMmsi,
  vessels,
  ownMmsi,
  hidden,
  startMs,
  endMs,
  nowMs,
}: SOGChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const vesselByMmsi = new Map(vessels.map((v) => [v.mmsi, v]));
    const data: Datum[] = [];
    let maxSog = 1;
    for (const [mmsi, track] of positionsByMmsi) {
      if (hidden.has(mmsi)) continue;
      const vessel = vesselByMmsi.get(mmsi);
      const label = vessel ? displayLabel(vessel) : mmsi;
      const color = rgbToCss(
        mmsi === ownMmsi ? OWN_BOAT_COLOR : colorForMmsi(mmsi),
      );
      for (const p of track) {
        if (p.sog == null) continue;
        const tMs = Date.parse(p.timestamp_utc);
        if (tMs < startMs || tMs > endMs) continue;
        const tSec = (tMs - startMs) / 1000;
        data.push({ mmsi, label, color, tSec, sog: p.sog });
        if (p.sog > maxSog) maxSog = p.sog;
      }
    }

    const cursorSec = Math.max(0, (nowMs - startMs) / 1000);
    const spanSec = Math.max(1, (endMs - startMs) / 1000);

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
        domain: [0, Math.ceil(maxSog + 1)],
        label: 'SOG (kt)',
        grid: true,
      },
      color: { legend: false },
      marks: [
        Plot.line(data, {
          x: 'tSec',
          y: 'sog',
          stroke: 'color',
          strokeWidth: 1.2,
          z: 'mmsi',
          tip: {
            format: {
              x: (v: number) => `T+${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`,
              y: (v: number) => `${v.toFixed(1)} kt`,
              color: null,
            },
          },
          title: (d: Datum) => `${d.label} — ${d.sog.toFixed(1)} kt`,
        }),
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
  }, [positionsByMmsi, vessels, hidden, ownMmsi, startMs, endMs, nowMs]);

  return (
    <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        SOG — fleet
      </h2>
      <div
        ref={containerRef}
        data-testid="sog-chart"
        className="h-[180px] w-full"
      />
    </section>
  );
}
