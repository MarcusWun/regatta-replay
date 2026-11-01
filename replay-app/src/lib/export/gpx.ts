// Phase 2c — per-boat GPX export (GPX 1.1 standard, Google-Earth-friendly).
//
// One <trk> per boat, one <trkseg>, one <trkpt> per position sample.
// Each <trkpt> carries lat/lon as attributes, UTC time in <time>, course in
// degrees via <course>, and speed in m/s via <speed>. GPX 1.1 standard puts
// optional dynamics like course + speed inside <trkpt><extensions>, but the
// Garmin "Trackpoint v1" extension (also used by many tools) accepts them as
// plain children; we use the plainer form since consumers like Google Earth
// and the online validator accept it, and Expedition ignores it gracefully.
import type { PositionRow } from '../types';

const KNOTS_TO_MS = 0.5144444;

export interface BoatGPXInput {
  mmsi: string;
  displayName: string | null;
  raceName: string | null;
  positions: PositionRow[];
}

function xmlEscape(input: string | null | undefined): string {
  if (input == null) return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmtLatLon(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(7);
}

function fmtSpeedKtsToMs(sogKts: number | null | undefined): string | null {
  if (sogKts == null || !Number.isFinite(sogKts)) return null;
  return (sogKts * KNOTS_TO_MS).toFixed(3);
}

function fmtCourse(cog: number | null | undefined): string | null {
  if (cog == null || !Number.isFinite(cog)) return null;
  return cog.toFixed(1);
}

/**
 * Produce a complete GPX 1.1 document for one boat.
 * Positions are sorted ascending by timestamp before emission.
 */
export function boatToGPX(input: BoatGPXInput): string {
  const sorted = input.positions
    .slice()
    .sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));

  const trackName = input.displayName ?? `MMSI ${input.mmsi}`;
  const raceName = input.raceName ?? 'regatta';

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<gpx version="1.1" creator="Regatta Replay"' +
      ' xmlns="http://www.topografix.com/GPX/1/1"' +
      ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
      ' xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
  );
  lines.push('  <metadata>');
  lines.push(`    <name>${xmlEscape(raceName)}</name>`);
  lines.push('  </metadata>');
  lines.push('  <trk>');
  lines.push(`    <name>${xmlEscape(trackName)}</name>`);
  lines.push(`    <desc>MMSI ${xmlEscape(input.mmsi)}</desc>`);
  lines.push('    <trkseg>');

  for (const p of sorted) {
    lines.push(`      <trkpt lat="${fmtLatLon(p.lat)}" lon="${fmtLatLon(p.lon)}">`);
    lines.push(`        <time>${xmlEscape(p.timestamp_utc)}</time>`);
    const course = fmtCourse(p.cog);
    if (course != null) lines.push(`        <course>${course}</course>`);
    const speed = fmtSpeedKtsToMs(p.sog);
    if (speed != null) lines.push(`        <speed>${speed}</speed>`);
    lines.push('      </trkpt>');
  }

  lines.push('    </trkseg>');
  lines.push('  </trk>');
  lines.push('</gpx>');
  return lines.join('\n') + '\n';
}
