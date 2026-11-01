// Horizontal bars showing each boat's delta behind the current leader at the
// replay clock timestamp. Off-course boats render in red with an "off course"
// badge instead of a positive distance.
import { useMemo } from 'react';
import { colorForMmsi, OWN_BOAT_COLOR, rgbToCss } from '../../lib/colors';
import type { VesselRow } from '../../lib/types';
import type { DistanceSnapshot } from '../../hooks/useDistanceToLeader';
import { displayLabel } from './BoatSelector';

export interface DistanceToLeaderBarProps {
  snapshot: DistanceSnapshot;
  vessels: VesselRow[];
  ownMmsi: string | null;
  hidden: Set<string>;
}

export function DistanceToLeaderBar({
  snapshot,
  vessels,
  ownMmsi,
  hidden,
}: DistanceToLeaderBarProps) {
  const vesselByMmsi = useMemo(() => {
    const m = new Map<string, VesselRow>();
    for (const v of vessels) m.set(v.mmsi, v);
    return m;
  }, [vessels]);

  const visibleEntries = snapshot.entries.filter((e) => !hidden.has(e.mmsi));

  const maxDelta = Math.max(
    0.1,
    ...visibleEntries.map((e) => (e.deltaBehindLeaderNm ?? 0)),
  );

  if (visibleEntries.length === 0) {
    return (
      <section className="rounded border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-400">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Distance to leader
        </h2>
        No visible boats.
      </section>
    );
  }

  return (
    <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Distance to leader
      </h2>
      <ul className="flex flex-col gap-1.5">
        {visibleEntries.map((e) => {
          const vessel = vesselByMmsi.get(e.mmsi);
          const label = vessel ? displayLabel(vessel) : e.mmsi;
          const isOwn = e.mmsi === ownMmsi;
          const isLeader = e.mmsi === snapshot.leaderMmsi;
          const color = isOwn ? OWN_BOAT_COLOR : colorForMmsi(e.mmsi);
          const delta = e.deltaBehindLeaderNm;

          if (e.offCourse) {
            return (
              <li
                key={e.mmsi}
                className="flex items-center gap-2 text-[11px] text-slate-100"
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: rgbToCss(color) }}
                />
                <span className="min-w-[6rem] max-w-[8rem] truncate text-slate-200">
                  {label}
                </span>
                <span className="flex-1 rounded bg-rose-900/60 px-1.5 py-0.5 text-rose-300">
                  off course
                </span>
              </li>
            );
          }

          const widthPct = delta == null ? 0 : (delta / maxDelta) * 100;
          return (
            <li
              key={e.mmsi}
              className="flex items-center gap-2 text-[11px] text-slate-100"
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: rgbToCss(color),
                  outline: isOwn ? '1px solid white' : 'none',
                }}
              />
              <span className="min-w-[6rem] max-w-[8rem] truncate text-slate-200">
                {label}
                {isLeader && <span className="ml-1 text-emerald-300">★</span>}
              </span>
              <span className="relative flex-1 overflow-hidden rounded bg-slate-800">
                <span
                  className="block h-3"
                  style={{
                    width: `${Math.max(2, widthPct)}%`,
                    background: isLeader
                      ? 'rgba(34, 197, 94, 0.65)'
                      : rgbToCss(color, 0.6),
                  }}
                />
              </span>
              <span className="w-16 text-right tabular-nums text-slate-300">
                {delta == null ? '—' : delta < 0.01 ? '0' : `${delta.toFixed(2)} nm`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
