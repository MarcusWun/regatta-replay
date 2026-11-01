// Boat × waypoint rounding-times table. Rows are vessels (sorted by first
// crossing time to approximate racing order), columns are waypoint seqs.
import { useMemo } from 'react';
import { colorForMmsi, OWN_BOAT_COLOR, rgbToCss } from '../../lib/colors';
import type { VesselRow } from '../../lib/types';
import type { MarkRoundingTable } from '../../hooks/useMarkRoundings';
import { displayLabel } from './BoatSelector';

export interface MarkRoundingTableProps {
  table: MarkRoundingTable;
  vessels: VesselRow[];
  ownMmsi: string | null;
  /** Replay t=0 as epoch-ms; rounding times are rendered as T+MM:SS relative to it. */
  startMs: number;
  hidden: Set<string>;
}

function formatRelative(ts: string, startMs: number): string {
  const deltaMs = Date.parse(ts) - startMs;
  const sign = deltaMs < 0 ? '-' : '';
  const abs = Math.abs(deltaMs);
  const totalSec = Math.round(abs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${sign}${m}:${String(s).padStart(2, '0')}`;
}

function formatUtc(ts: string): string {
  const d = new Date(ts);
  return d.toISOString().slice(11, 19) + 'Z';
}

export function MarkRoundingTableCard({
  table,
  vessels,
  ownMmsi,
  startMs,
  hidden,
}: MarkRoundingTableProps) {
  const vesselByMmsi = useMemo(() => {
    const m = new Map<string, VesselRow>();
    for (const v of vessels) m.set(v.mmsi, v);
    return m;
  }, [vessels]);

  const sortedRows = useMemo(() => {
    return table.rows
      .filter((r) => !hidden.has(r.mmsi))
      .slice()
      .sort((a, b) => {
        if (a.mmsi === ownMmsi) return -1;
        if (b.mmsi === ownMmsi) return 1;
        // Rank by earliest first-mark rounding; "not yet" sorts last.
        const firstSeq = table.seqs[0];
        const aT = a.roundings[firstSeq]?.timestampUtc;
        const bT = b.roundings[firstSeq]?.timestampUtc;
        if (aT && !bT) return -1;
        if (!aT && bT) return 1;
        if (aT && bT) return aT.localeCompare(bT);
        return a.mmsi.localeCompare(b.mmsi);
      });
  }, [table, hidden, ownMmsi]);

  if (table.seqs.length === 0) {
    return (
      <section className="rounded border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-400">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Mark rounding
        </h2>
        Not enough course marks to detect rounding.
      </section>
    );
  }

  return (
    <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Mark rounding
      </h2>
      <div className="max-h-64 overflow-auto">
        <table className="w-full border-collapse text-left text-[11px]">
          <thead className="sticky top-0 bg-slate-900">
            <tr>
              <th className="pr-2 font-medium text-slate-500">Boat</th>
              {table.seqs.map((seq) => (
                <th key={seq} className="px-1 font-medium text-slate-500">
                  M{seq}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const isOwn = row.mmsi === ownMmsi;
              const color = isOwn ? OWN_BOAT_COLOR : colorForMmsi(row.mmsi);
              const vessel = vesselByMmsi.get(row.mmsi);
              const label = vessel ? displayLabel(vessel) : row.mmsi;
              return (
                <tr key={row.mmsi} className="border-b border-slate-800/40">
                  <td className="py-1 pr-2 text-slate-200">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          background: rgbToCss(color),
                          outline: isOwn ? '1px solid white' : 'none',
                        }}
                      />
                      <span className="max-w-[8rem] truncate" title={label}>
                        {label}
                      </span>
                    </span>
                  </td>
                  {table.seqs.map((seq) => {
                    const cell = row.roundings[seq];
                    if (!cell?.timestampUtc) {
                      return (
                        <td
                          key={seq}
                          className="px-1 py-1 text-slate-600"
                          title="Not yet rounded in the recorded window"
                        >
                          –
                        </td>
                      );
                    }
                    return (
                      <td
                        key={seq}
                        className="px-1 py-1 text-slate-200"
                        title={formatUtc(cell.timestampUtc)}
                      >
                        {formatRelative(cell.timestampUtc, startMs)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
