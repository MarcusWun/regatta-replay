// VMG + polar % card for the own boat. Shows the current snapshot plus a
// 10-minute Observable Plot sparkline for each metric.
import { useEffect, useRef } from 'react';
import * as Plot from '@observablehq/plot';
import type {
  PolarPerformanceEntry,
  PolarPerformanceSeries,
} from '../../hooks/usePolarPerformance';
import { performanceAt, performanceWindow } from '../../hooks/usePolarPerformance';

export interface OwnBoatPerformanceProps {
  series: PolarPerformanceSeries;
  nowMs: number;
  /** True when race.db has no wind table. */
  windMissing: boolean;
  /** True when no polar file is configured. */
  polarMissing: boolean;
}

const WINDOW_MS = 10 * 60 * 1000;

export function OwnBoatPerformance({
  series,
  nowMs,
  windMissing,
  polarMissing,
}: OwnBoatPerformanceProps) {
  const vmgRef = useRef<HTMLDivElement | null>(null);
  const polarRef = useRef<HTMLDivElement | null>(null);

  const current = performanceAt(series, nowMs);
  const window = performanceWindow(series, nowMs, WINDOW_MS);

  useEffect(() => {
    renderSparkline(vmgRef.current, window, nowMs, 'vmg');
    return () => {
      if (vmgRef.current) vmgRef.current.innerHTML = '';
    };
  }, [window, nowMs]);

  useEffect(() => {
    renderSparkline(polarRef.current, window, nowMs, 'percent');
    return () => {
      if (polarRef.current) polarRef.current.innerHTML = '';
    };
  }, [window, nowMs]);

  if (windMissing) {
    return (
      <section className="rounded border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-400">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Own-boat performance
        </h2>
        No wind data in this race file.
      </section>
    );
  }

  const polarPercentNull = current?.percent == null;
  const polarTint =
    current?.percent != null && (current.percent < 85 || current.percent > 115);

  return (
    <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Own-boat performance
      </h2>

      <div className="grid grid-cols-2 gap-3 text-slate-200">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            VMG
          </div>
          <div className="text-xl font-semibold tabular-nums">
            {current?.vmg == null ? '—' : `${current.vmg.toFixed(2)} kt`}
          </div>
          <div
            ref={vmgRef}
            data-testid="vmg-sparkline"
            className="mt-1 h-[48px] w-full"
          />
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            Polar %
          </div>
          <div
            className={`text-xl font-semibold tabular-nums ${
              polarTint ? 'text-rose-300' : ''
            }`}
          >
            {polarMissing && polarPercentNull
              ? '—'
              : current?.percent == null
                ? '—'
                : `${current.percent.toFixed(1)}%`}
          </div>
          <div
            ref={polarRef}
            data-testid="polar-sparkline"
            className="mt-1 h-[48px] w-full"
          />
          {polarMissing && (
            <div className="mt-1 text-[10px] text-amber-300/80">
              Pick a polar file in Settings to enable.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function renderSparkline(
  el: HTMLDivElement | null,
  entries: PolarPerformanceEntry[],
  nowMs: number,
  field: 'vmg' | 'percent',
): void {
  if (!el) return;
  el.innerHTML = '';

  const data = entries
    .map((e) => ({
      tSec: (e.timestampMs - nowMs) / 1000, // negative; most recent = 0
      value: field === 'vmg' ? e.vmg : e.percent,
    }))
    .filter((d) => d.value != null) as Array<{ tSec: number; value: number }>;

  if (data.length < 2) {
    return;
  }

  const ys = data.map((d) => d.value);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yPad = Math.max(0.1, (yMax - yMin) * 0.1);

  const chart = Plot.plot({
    width: el.clientWidth || 160,
    height: 48,
    marginLeft: 2,
    marginBottom: 2,
    marginTop: 2,
    marginRight: 2,
    style: { background: 'transparent' },
    x: { axis: null, domain: [-600, 0] },
    y: { axis: null, domain: [yMin - yPad, yMax + yPad] },
    marks: [
      Plot.line(data, {
        x: 'tSec',
        y: 'value',
        stroke: field === 'vmg' ? '#38bdf8' : '#f0abfc',
        strokeWidth: 1.4,
      }),
    ],
  });
  el.append(chart);
}
