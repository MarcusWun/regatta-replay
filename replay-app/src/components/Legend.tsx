// Boat legend: color swatch + display name + per-boat show/hide + trail length control.
import { useMemo } from 'react';
import { colorForMmsi, OWN_BOAT_COLOR, rgbToCss } from '../lib/colors';
import type { VesselRow } from '../lib/types';

const TRAIL_PRESETS: { label: string; seconds: number | null }[] = [
  { label: '5 min', seconds: 5 * 60 },
  { label: '15 min', seconds: 15 * 60 },
  { label: '1 h', seconds: 60 * 60 },
  { label: 'Full race', seconds: null },
];

export interface LegendProps {
  vessels: VesselRow[];
  ownMmsi: string | null;
  hidden: Set<string>;
  onToggle: (mmsi: string) => void;
  trailSeconds: number | null;
  onTrailChange: (seconds: number | null) => void;
}

function displayLabel(v: VesselRow): string {
  return (
    v.display_name ??
    v.sail_number ??
    v.ais_name ??
    `MMSI: ${v.mmsi}`
  );
}

export function Legend({ vessels, ownMmsi, hidden, onToggle, trailSeconds, onTrailChange }: LegendProps) {
  const sorted = useMemo(() => {
    return vessels.slice().sort((a, b) => {
      if (a.mmsi === ownMmsi) return -1;
      if (b.mmsi === ownMmsi) return 1;
      return displayLabel(a).localeCompare(displayLabel(b));
    });
  }, [vessels, ownMmsi]);

  return (
    <aside className="flex w-64 flex-col gap-3 overflow-y-auto border-l border-slate-700 bg-slate-900 p-3 text-slate-100">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Trail length</h2>
        <div className="mt-1 flex flex-wrap gap-1">
          {TRAIL_PRESETS.map((p) => {
            const active = trailSeconds === p.seconds;
            return (
              <button
                key={p.label}
                data-testid={`trail-${p.label}`}
                onClick={() => onTrailChange(p.seconds)}
                className={`rounded px-2 py-1 text-xs ${
                  active ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Fleet ({sorted.length})
        </h2>
        <ul className="mt-2 flex flex-col gap-1">
          {sorted.map((v) => {
            const isOwn = v.mmsi === ownMmsi;
            const color = isOwn ? OWN_BOAT_COLOR : colorForMmsi(v.mmsi);
            const isHidden = hidden.has(v.mmsi);
            return (
              <li key={v.mmsi}>
                <button
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-slate-800 ${
                    isHidden ? 'opacity-50' : ''
                  }`}
                  onClick={() => onToggle(v.mmsi)}
                  title={isHidden ? 'Show on map' : 'Hide from map'}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: rgbToCss(color), outline: isOwn ? '1px solid white' : 'none' }}
                  />
                  <span className="truncate">
                    {displayLabel(v)}
                    {isOwn && <span className="ml-1 text-xs text-amber-300">(own)</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
