// Replay controls — scrubber, play/pause, speed, jump-to-ends, time readout.
import type { ReplayClock } from '../hooks/useReplayClock';

const SPEED_PRESETS = [1, 10, 60, 180, 300, 1000] as const;

function formatUtc(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}Z`;
}

function formatRelative(ms: number, startMs: number): string {
  const dt = Math.round((ms - startMs) / 1000);
  const sign = dt < 0 ? '-' : '+';
  const abs = Math.abs(dt);
  const mm = Math.floor(abs / 60);
  const ss = abs % 60;
  return `T${sign}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export interface TimelineProps {
  clock: ReplayClock;
  startMs: number;
  endMs: number;
}

export function Timeline({ clock, startMs, endMs }: TimelineProps) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-700 bg-slate-900 px-4 py-3 text-slate-100">
      <div className="flex items-center gap-3">
        <button
          data-testid="play-pause-btn"
          className="rounded bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-500"
          onClick={clock.toggle}
        >
          {clock.playing ? 'Pause' : 'Play'}
        </button>
        <button
          className="rounded bg-slate-700 px-2 py-1.5 text-sm hover:bg-slate-600"
          onClick={clock.jumpToStart}
          title="Jump to replay start (t=0)"
        >
          ⏮ Start
        </button>
        <button
          className="rounded bg-slate-700 px-2 py-1.5 text-sm hover:bg-slate-600"
          onClick={clock.jumpToEnd}
          title="Jump to replay end"
        >
          ⏭ End
        </button>

        <div className="flex items-center gap-2 pl-2">
          <span className="text-xs uppercase tracking-wider text-slate-400">Speed</span>
          <select
            data-testid="speed-select"
            className="rounded bg-slate-800 px-2 py-1 text-sm"
            value={clock.speed}
            onChange={(e) => clock.setSpeed(Number(e.target.value))}
          >
            {SPEED_PRESETS.map((s) => (
              <option key={s} value={s}>{s}×</option>
            ))}
          </select>
          <input
            data-testid="speed-slider"
            type="range"
            min={1}
            max={1000}
            step={1}
            value={clock.speed}
            onChange={(e) => clock.setSpeed(Number(e.target.value))}
            className="w-32"
            aria-label="Speed slider"
          />
          <span className="w-12 text-sm text-slate-300">{clock.speed}×</span>
        </div>

        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="text-slate-400">
            {formatUtc(clock.nowMs)} <span className="text-slate-500">·</span> {formatRelative(clock.nowMs, startMs)}
          </span>
        </div>
      </div>

      <input
        data-testid="scrubber"
        type="range"
        min={0}
        max={10_000}
        step={1}
        value={Math.round(clock.progress * 10_000)}
        onChange={(e) => clock.seekProgress(Number(e.target.value) / 10_000)}
        className="w-full accent-sky-500"
        aria-label="Timeline scrubber"
      />
      <div className="flex justify-between text-xs text-slate-500">
        <span>{formatUtc(startMs)}</span>
        <span>{formatUtc(endMs)}</span>
      </div>
    </div>
  );
}
