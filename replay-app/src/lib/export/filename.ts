// Filename + slug helpers for Phase 2c exports.
//
// Produces filesystem-safe filenames in the forms laid out in PRD §2:
//   PNG: <race-slug>_T+MMMMmSSs_map.png
//   CSV: <race-slug>_<mmsi>_<display-slug>.csv
//   GPX: <race-slug>_<mmsi>_<display-slug>.gpx
//
// Slug rule: lowercase, non-alphanumerics collapsed to single `-`, trimmed.

const FALLBACK_SLUG = 'untitled';

export function slug(input: string | null | undefined): string {
  if (!input) return FALLBACK_SLUG;
  const lower = input.toLowerCase();
  const replaced = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return replaced.length > 0 ? replaced : FALLBACK_SLUG;
}

/**
 * Format a replay-elapsed millisecond count as `T+MMMMmSSs` for PNG filenames,
 * matching the PRD §2 example `T+0032m18s`. Negative deltas (pre-start) are
 * rendered as `T-MMMMmSSs`.
 */
export function elapsedForFilename(elapsedMs: number): string {
  const sign = elapsedMs < 0 ? '-' : '+';
  const abs = Math.max(0, Math.floor(Math.abs(elapsedMs) / 1000));
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  const mm = String(minutes).padStart(4, '0');
  const ss = String(seconds).padStart(2, '0');
  return `T${sign}${mm}m${ss}s`;
}

export function pngFilename(raceName: string | null, elapsedMs: number): string {
  return `${slug(raceName)}_${elapsedForFilename(elapsedMs)}_map.png`;
}

export function csvFilename(
  raceName: string | null,
  mmsi: string,
  displayName: string | null,
): string {
  return `${slug(raceName)}_${slug(mmsi)}_${slug(displayName)}.csv`;
}

export function gpxFilename(
  raceName: string | null,
  mmsi: string,
  displayName: string | null,
): string {
  return `${slug(raceName)}_${slug(mmsi)}_${slug(displayName)}.gpx`;
}
