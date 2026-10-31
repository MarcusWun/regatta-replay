// Minimal GPX parser — ported from Aeolus Phase 1 (electron/gpx-parser.ts).
// Deliberately regex-based: Expedition exports flat <wpt lat lon>...<name>...</wpt>
// sequences and we only need those in document order.
//
// PRD §2.3 / §3.7:
//   - first waypoint → is_start=1
//   - last waypoint → is_finish=1
//   - exactly one waypoint → both flags set
//   - zero waypoints → { ok: false, error: 'no waypoints' }
import type { RaceMarkRow } from './types';

export type GpxParseResult =
  | { ok: true; marks: RaceMarkRow[] }
  | { ok: false; error: string };

function parseWptAttributes(openTag: string): { lat: number; lon: number } | null {
  const latMatch = openTag.match(/\blat\s*=\s*(['"])(-?[\d.]+)\1/);
  const lonMatch = openTag.match(/\blon\s*=\s*(['"])(-?[\d.]+)\1/);
  if (!latMatch || !lonMatch) return null;
  const lat = Number(latMatch[2]);
  const lon = Number(lonMatch[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function extractName(body: string): string | null {
  const match = body.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i);
  if (!match) return null;
  let inner = match[1].trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) inner = cdata[1].trim();
  inner = inner.replace(/\s+/g, ' ');
  return inner.length === 0 ? null : inner;
}

export function parseGpxString(gpx: string): GpxParseResult {
  const marks: RaceMarkRow[] = [];
  const wptRegex = /<wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/wpt\s*>)/gi;
  let match: RegExpExecArray | null;
  let seq = 1;
  while ((match = wptRegex.exec(gpx)) !== null) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const coords = parseWptAttributes(attrs);
    if (!coords) continue;
    const name = extractName(body);
    marks.push({
      seq,
      name,
      lat: coords.lat,
      lon: coords.lon,
      is_start: 0,
      is_finish: 0,
    });
    seq++;
  }

  if (marks.length === 0) {
    return { ok: false, error: 'no waypoints' };
  }

  if (marks.length === 1) {
    marks[0].is_start = 1;
    marks[0].is_finish = 1;
  } else {
    marks[0].is_start = 1;
    marks[marks.length - 1].is_finish = 1;
  }

  return { ok: true, marks };
}
