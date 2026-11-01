// VMG, polar %, and VMC-to-next-mark cards for the own boat. Each card shows
// the current snapshot plus a 10-minute Observable Plot sparkline.
import { useEffect, useRef } from 'react';
import * as Plot from '@observablehq/plot';
import type {
  PolarPerformanceEntry,
  PolarPerformanceSeries,
} from '../../hooks/usePolarPerformance';
import { performanceAt, performanceWindow } from '../../hooks/usePolarPerformance';
import type { VMCEntry, VMCSnapshot } from '../../hooks/useVMC';

export interface OwnBoatPerformanceProps {
  series: PolarPerformanceSeries;
  nowMs: number;
  /** True when race.db has no wind table. */
  windMissing: boolean;
  /** True when no polar file is configured. */
  polarMissing: boolean;
  /** Snapshot of own-boat VMC at the current replay tick. */
  vmcSnapshot: VMCSnapshot;
  /** Entries in the trailing 10-min window, for the VMC sparkline. */
  vmcWindow: VMCEntry[];
}

const WINDOW_MS = 10 * 60 * 1000;
const VMC_NOISE_FLOOR = 0.1;

export function OwnBoatPerformance({
  series,
  nowMs,
  windMissing,
  polarMissing,
  vmcSnapshot,
  vmcWindow,
}: OwnBoatPerformanceProps) {
  const vmgRef = useRef<HTMLDivElement | null>(null);
  const polarRef = useRef<HTMLDivElement | null>(null);
  const vmcRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    renderVmcSparkline(vmcRef.current, vmcWindow, nowMs);
    return () => {
      if (vmcRef.current) vmcRef.current.innerHTML = '';
    };
  }, [vmcWindow, nowMs]);

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

  const showVmcCard = vmcSnapshot.hasCourse;
  const vmcValue = vmcSnapshot.smoothed10min;
  const vmcDisplay = formatVmc(vmcValue, vmcSnapshot.postFinish);
  const vmcNegative = vmcValue != null && Math.abs(vmcValue) >= VMC_NOISE_FLOOR && vmcValue < 0;
  const vmcLabel = vmcSnapshot.postFinish
    ? 'VMC — finished'
    : vmcSnapshot.targetMarkName
      ? `VMC to ${vmcSnapshot.targetMarkName}`
      : 'VMC';

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

      {showVmcCard ? (
        <div className="mt-3 border-t border-slate-800 pt-3" data-testid="vmc-card">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            {vmcLabel}
          </div>
          <div
            className={`text-xl font-semibold tabular-nums ${
              vmcNegative ? 'text-rose-300' : ''
            }`}
          >
            {vmcDisplay}
          </div>
          <div
            ref={vmcRef}
            data-testid="vmc-sparkline"
            className="mt-1 h-[48px] w-full"
          />
          {vmcSnapshot.isUnsmoothed && !vmcSnapshot.postFinish && vmcValue != null && (
            <div className="mt-1 text-[10px] text-amber-300/80">unsmoothed</div>
          )}
        </div>
      ) : (
        <div
          className="mt-3 border-t border-slate-800 pt-3 text-[10px] text-slate-500"
          data-testid="vmc-no-course"
        >
          No course loaded — VMC unavailable.
        </div>
      )}
    </section>
  );
}

function formatVmc(value: number | null, postFinish: boolean): string {
  if (postFinish) return '—';
  if (value == null) return '—';
  if (Math.abs(value) < VMC_NOISE_FLOOR) return '— kt';
  return `${value.toFixed(1)} kt`;
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

function renderVmcSparkline(
  el: HTMLDivElement | null,
  entries: VMCEntry[],
  nowMs: number,
): void {
  if (!el) return;
  el.innerHTML = '';

  const data = entries
    .map((e) => ({
      tSec: (e.timestampMs - nowMs) / 1000,
      value: e.vmc,
    }))
    .filter((d) => d.value != null) as Array<{ tSec: number; value: number }>;

  if (data.length < 2) return;

  const ys = data.map((d) => d.value);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(0, ...ys);
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
      Plot.ruleY([0], { stroke: '#334155', strokeWidth: 0.8 }),
      Plot.line(data, {
        x: 'tSec',
        y: 'value',
        stroke: '#34d399',
        strokeWidth: 1.4,
      }),
    ],
  });
  el.append(chart);
}
