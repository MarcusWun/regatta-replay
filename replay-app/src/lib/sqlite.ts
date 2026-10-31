// Thin wrapper around @tauri-apps/plugin-sql for the race.db loader.
// Opens read-only, pulls all tables into memory in one load, closes.
import Database from '@tauri-apps/plugin-sql';
import type {
  PositionRow,
  RaceMarkRow,
  RaceMeta,
  VesselRow,
} from './types';

export interface LoadedRace {
  meta: RaceMeta;
  vessels: VesselRow[];
  positions: PositionRow[];
  marks: RaceMarkRow[];
}

/**
 * Open the race.db at `path`, read the four tables we care about, close.
 * Thrown errors propagate — callers decide how to surface them to the user.
 */
export async function loadRaceDb(path: string): Promise<LoadedRace> {
  const url = `sqlite:${path}`;
  const db = await Database.load(url);
  try {
    const metaRows = (await db.select<{ key: string; value: string | null }[]>(
      'SELECT key, value FROM race_meta',
    )) ?? [];
    const meta: RaceMeta = {};
    for (const r of metaRows) meta[r.key] = r.value;

    const vessels = (await db.select<VesselRow[]>(
      `SELECT mmsi, ais_name, display_name, sail_number, class, call_sign,
              vessel_type, excluded, added_post_race
         FROM vessels
         ORDER BY mmsi`,
    )) ?? [];

    const positions = (await db.select<PositionRow[]>(
      `SELECT mmsi, timestamp_utc, lat, lon, sog, cog, heading, source, interpolated
         FROM positions
         ORDER BY mmsi, timestamp_utc`,
    )) ?? [];

    const marks = (await db.select<RaceMarkRow[]>(
      `SELECT seq, name, lat, lon, is_start, is_finish
         FROM race_marks
         ORDER BY seq`,
    )) ?? [];

    return { meta, vessels, positions, marks };
  } finally {
    try {
      await db.close();
    } catch {
      /* best-effort close */
    }
  }
}
