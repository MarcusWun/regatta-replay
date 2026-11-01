// Shared row types mirror the race.db schema produced by Aeolus.
// Keep in sync with /home/marcus/.openclaw/workspace-cto/aeolus/electron/race-db.ts.

export interface VesselRow {
  mmsi: string;
  ais_name: string | null;
  display_name: string | null;
  sail_number: string | null;
  class: string | null;
  call_sign: string | null;
  vessel_type: number | null;
  excluded: number | null;
  added_post_race: number | null;
}

export interface PositionRow {
  mmsi: string;
  timestamp_utc: string;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  source: string;
  interpolated: number | null;
}

export interface RaceMarkRow {
  seq: number;
  name: string | null;
  lat: number;
  lon: number;
  is_start: number;
  is_finish: number;
}

export interface RaceMeta {
  [key: string]: string | null;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Aeolus Phase 1.2 own-boat wind row. Written to race.db at ~1 Hz.
 * Historical race.db files from before Phase 1.2 have no `wind` table —
 * callers should handle an empty array (and `hasWindTable` from loadRaceDb)
 * as a graceful-degradation signal, not an error.
 */
export interface WindRow {
  timestamp_utc: string;
  tws: number | null;
  twd: number | null;
  aws: number | null;
  awa: number | null;
  source: string | null;
}
