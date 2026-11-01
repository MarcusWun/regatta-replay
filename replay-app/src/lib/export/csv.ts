// Phase 2c — per-boat CSV export.
//
// Pure function: produces the UTF-8 BOM-prefixed string for one boat's track.
// Own-boat gets the full column set (wind + VMG + polar% + VMC); competitors
// get those columns blank so the sheet shape is identical across all boats
// in a single export batch — makes it trivial to concat for post-race analysis.
//
// Column schema is frozen in PRD §2. See exportCSV.test.ts for golden rows.
import type { PositionRow } from '../types';

export const CSV_BOM = '﻿';

export const CSV_COLUMNS = [
  'timestamp_utc',
  'timestamp_relative',
  'lat',
  'lon',
  'sog_kts',
  'cog_deg',
  'heading_deg',
  'source',
  'interpolated',
  // Own-boat only — competitors leave these blank.
  'tws_kts',
  'twd_deg',
  'aws_kts',
  'awa_deg',
  'twa_deg',
  'vmg_kts',
  'polar_pct',
  'vmc_kts',
] as const;

export interface OwnBoatMetricsEntry {
  tws: number | null;
  twd: number | null;
  aws: number | null;
  awa: number | null;
  twa: number | null;
  vmg: number | null;
  polarPct: number | null;
  vmc: number | null;
}

export interface BoatCSVInput {
  positions: PositionRow[];
  /** Milliseconds at replay t=0 (race start). Used for `timestamp_relative`. */
  startMs: number;
  /**
   * Own-boat metrics keyed by position timestamp. Present only for the
   * own-boat row — undefined/absent means the boat is a competitor and the
   * wind/VMG/polar/VMC cells are blank.
   */
  ownBoatMetrics?: Map<string, OwnBoatMetricsEntry>;
}

/**
 * Format a signed elapsed-ms delta as `+HH:MM:SS` / `-HH:MM:SS`.
 * Pre-start samples render with a leading `-`; this makes it unambiguous when
 * concatenating boat CSVs for a cross-fleet alignment analysis.
 */
export function formatRelativeTimestamp(deltaMs: number): string {
  const sign = deltaMs < 0 ? '-' : '+';
  const abs = Math.max(0, Math.floor(Math.abs(deltaMs) / 1000));
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  const ss = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}:${ss}`;
}

/** Minimal RFC 4180 cell escape: quote iff cell contains comma, quote, CR, or LF. */
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function num(value: number | null | undefined, digits: number): string {
  if (value == null || !Number.isFinite(value)) return '';
  return value.toFixed(digits);
}

/**
 * Produce the full CSV string (with UTF-8 BOM) for one boat's positions.
 * Rows are sorted ascending by timestamp.
 */
export function boatToCSV(input: BoatCSVInput): string {
  const sorted = input.positions
    .slice()
    .sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));

  const lines: string[] = [];
  lines.push(CSV_COLUMNS.join(','));

  for (const p of sorted) {
    const tMs = Date.parse(p.timestamp_utc);
    const relative = Number.isFinite(tMs)
      ? formatRelativeTimestamp(tMs - input.startMs)
      : '';
    const metrics = input.ownBoatMetrics?.get(p.timestamp_utc);
    const row = [
      csvCell(p.timestamp_utc),
      csvCell(relative),
      num(p.lat, 7),
      num(p.lon, 7),
      num(p.sog, 2),
      num(p.cog, 1),
      num(p.heading, 1),
      csvCell(p.source),
      p.interpolated === 1 ? '1' : '0',
      num(metrics?.tws, 2),
      num(metrics?.twd, 1),
      num(metrics?.aws, 2),
      num(metrics?.awa, 1),
      num(metrics?.twa, 1),
      num(metrics?.vmg, 2),
      num(metrics?.polarPct, 1),
      num(metrics?.vmc, 2),
    ];
    lines.push(row.join(','));
  }

  return CSV_BOM + lines.join('\r\n') + '\r\n';
}
