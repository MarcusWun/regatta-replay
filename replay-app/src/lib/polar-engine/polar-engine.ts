import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pchip, akima } from './spline';

/**
 * Interpolation method for the TWA dimension of polar lookups.
 * TWS dimension always uses linear interpolation.
 * Default is 'pchip' (selected as QA Gate 1 winner on 2026-08-03; use 'linear' for exact backward-compatible behavior).
 */
export type InterpolationMethod = 'linear' | 'pchip' | 'akima';

/**
 * TWS column index × TWA row index → boat speed in knots.
 */
export interface PolarTable {
  tws: number[];       // wind speeds (columns)
  twa: number[];       // wind angles (rows)
  speeds: number[][];  // speeds[twsIndex][twaIndex]
  /**
   * Per-TWS upwind VMG ("beat") angle in degrees, parallel to `tws`.
   * Rendering metadata only — see `src/lib/polar-curve.ts`. Never consulted
   * by `interpolateSpeed` or any performance calculation.
   */
  beatAngles?: number[];
}

export interface PolarPerformanceResult {
  percentPolar: number | null;
  targetSpeed: number | null;
  actualSpeed: number | null;
}

export interface BoatProfile {
  id: number;
  name: string;
  hullType: string;
  polarData: PolarTable;
  createdAt: string;
}

/**
 * Pre-seeded Sun Fast 3300 polar data.
 * Approximate VPP for a 33ft performance cruiser-racer.
 * TWS: 6, 8, 10, 12, 16, 20 knots
 * TWA: 40° to 180° in steps
 */
const SUN_FAST_3300_POLAR: PolarTable = {
  tws: [6, 8, 10, 12, 16, 20],
  twa: [40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180],
  speeds: [
    // TWS=6
    [2.1, 2.8, 3.2, 3.4, 3.5, 3.4, 3.2, 3.0, 2.8, 2.6, 2.4, 2.2, 2.0, 1.8, 1.6, 1.4, 1.2],
    // TWS=8
    [3.0, 3.9, 4.5, 4.8, 5.0, 4.9, 4.7, 4.4, 4.1, 3.8, 3.5, 3.2, 2.9, 2.6, 2.3, 2.0, 1.7],
    // TWS=10
    [4.0, 5.2, 6.0, 6.4, 6.7, 6.5, 6.2, 5.9, 5.5, 5.1, 4.7, 4.3, 3.9, 3.5, 3.1, 2.7, 2.3],
    // TWS=12
    [5.0, 6.5, 7.5, 8.0, 8.4, 8.1, 7.8, 7.4, 7.0, 6.5, 6.0, 5.5, 5.0, 4.5, 4.0, 3.5, 3.0],
    // TWS=16
    [6.5, 8.5, 9.8, 10.5, 11.0, 10.7, 10.3, 9.8, 9.3, 8.7, 8.1, 7.4, 6.7, 6.0, 5.3, 4.6, 3.9],
    // TWS=20
    [7.5, 10.0, 11.5, 12.5, 13.2, 12.8, 12.3, 11.7, 11.0, 10.3, 9.5, 8.7, 7.8, 7.0, 6.1, 5.2, 4.3],
  ],
};

// ---------------------------------------------------------------------------
// Spline cache for polar TWA interpolation (memoised per table × row × method)
// ---------------------------------------------------------------------------

/** Key: `${method}:${rowIndex}` */
type SplineKey = string;
const _splineCache = new WeakMap<PolarTable, Map<SplineKey, (x: number) => number>>();

/**
 * Assert that a PolarTable's speeds matrix has shape [tws.length][twa.length].
 * Throws a clear error message if the shape is wrong, so callers get an
 * actionable diagnostic rather than an opaque crash deep inside the spline builder.
 */
export function assertPolarShape(table: PolarTable): void {
  if (table.speeds.length !== table.tws.length) {
    throw new Error(
      `Polar shape mismatch: speeds has ${table.speeds.length} rows but tws has ${table.tws.length} entries`,
    );
  }
  if (table.speeds[0]?.length !== table.twa.length) {
    throw new Error(
      `Polar shape mismatch: speeds[0] has ${table.speeds[0]?.length} cols but twa has ${table.twa.length} entries`,
    );
  }
}

/**
 * Return a cached spline for a single TWS row of the polar table.
 * Builds it on first access, then reuses on subsequent calls for the same
 * (table, rowIndex, method) combination.
 */
function getOrBuildSpline(
  table: PolarTable,
  rowIdx: number,
  method: 'pchip' | 'akima',
): (x: number) => number {
  assertPolarShape(table);
  if (!_splineCache.has(table)) {
    _splineCache.set(table, new Map());
  }
  const cache = _splineCache.get(table)!;
  const key: SplineKey = `${method}:${rowIdx}`;
  if (!cache.has(key)) {
    const xs = table.twa;
    const ys = table.speeds[rowIdx];
    cache.set(key, method === 'pchip' ? pchip(xs, ys) : akima(xs, ys));
  }
  return cache.get(key)!;
}

// ---------------------------------------------------------------------------
// Free-function polar interpolation — Phase 1.6 R2a.
//
// The former `PolarEngine.interpolateSpeed` used no instance state; the
// analysis engine kept its own drift-prone copy that returned 0 instead of
// null for missing matrix cells.  This is the single canonical implementation.
// TWS dimension: always linear.  TWA dimension: controlled by `method`.
// Returns null if interpolation is not possible (out of range or bad input).
// ---------------------------------------------------------------------------

export function interpolateSpeed(
  table: PolarTable,
  tws: number,
  twa: number,
  method: InterpolationMethod = 'pchip',
): number | null {
  if (isNaN(tws) || isNaN(twa)) return null;
  if (tws <= 0 || twa < 0) return null;

  assertPolarShape(table);

  const minTWS = table.tws[0];
  const maxTWS = table.tws[table.tws.length - 1];
  if (tws < minTWS || tws > maxTWS) return null;

  const minTWA = table.twa[0];
  const maxTWA = table.twa[table.twa.length - 1];
  if (twa < minTWA || twa > maxTWA) return null;

  let twsLow = 0;
  while (twsLow < table.tws.length - 1 && table.tws[twsLow + 1] <= tws) {
    twsLow++;
  }
  const twsHigh = Math.min(twsLow + 1, table.tws.length - 1);

  if (twsLow >= table.tws.length || twsHigh >= table.tws.length) return null;
  if (!table.speeds[twsLow] || !table.speeds[twsHigh]) return null;

  // --- Spline path (PCHIP or Akima in TWA dimension) ---
  if (method !== 'linear') {
    const splineFn = getOrBuildSpline(table, twsLow, method);
    const speed0 = splineFn(twa);

    if (twsLow === twsHigh) {
      return Math.round(speed0 * 100) / 100;
    }

    const splineFn1 = getOrBuildSpline(table, twsHigh, method);
    const speed1 = splineFn1(twa);

    const tws0 = table.tws[twsLow];
    const tws1 = table.tws[twsHigh];
    const tTWS = (tws - tws0) / (tws1 - tws0);
    const result = speed0 * (1 - tTWS) + speed1 * tTWS;
    return Math.round(result * 100) / 100;
  }

  // --- Linear path (bilinear interpolation) ---
  let twaLow = 0;
  while (twaLow < table.twa.length - 1 && table.twa[twaLow + 1] <= twa) {
    twaLow++;
  }
  const twaHigh = Math.min(twaLow + 1, table.twa.length - 1);

  if (twaLow >= table.twa.length || twaHigh >= table.twa.length) return null;

  if (
    table.speeds[twsLow].length <= twaLow ||
    table.speeds[twsLow].length <= twaHigh
  ) {
    return null;
  }

  const tws0 = table.tws[twsLow];
  const tws1 = table.tws[twsHigh];
  const twa0 = table.twa[twaLow];
  const twa1 = table.twa[twaHigh];

  const v00 = table.speeds[twsLow][twaLow];
  const v01 = table.speeds[twsLow][twaHigh];
  const v10 = table.speeds[twsHigh][twaLow];
  const v11 = table.speeds[twsHigh][twaHigh];

  if (twsLow === twsHigh) {
    if (twaLow === twaHigh) return v00;
    const tTWA = (twa - twa0) / (twa1 - twa0);
    const result = v00 * (1 - tTWA) + v01 * tTWA;
    return Math.round(result * 100) / 100;
  }

  if (twaLow === twaHigh) {
    const tTWS = (tws - tws0) / (tws1 - tws0);
    const result = v00 * (1 - tTWS) + v10 * tTWS;
    return Math.round(result * 100) / 100;
  }

  const tTWS = (tws - tws0) / (tws1 - tws0);
  const tTWA = (twa - twa0) / (twa1 - twa0);

  const edge0 = v00 * (1 - tTWA) + v01 * tTWA;
  const edge1 = v10 * (1 - tTWA) + v11 * tTWA;
  const result = edge0 * (1 - tTWS) + edge1 * tTWS;

  return Math.round(result * 100) / 100;
}

// ---------------------------------------------------------------------------
// F1 (Phase 1.4) — module-level singleton so cross-cutting queries (e.g.
// performance-queries.compareConfigs) can look up a polar profile without
// having to plumb a PolarEngine instance through unrelated call sites.
//
// Registered by ipc-handlers.registerIPCHandlers() at startup.  Callers that
// only need a specific polar profile use `resolvePolarProfile(id)`; callers
// that need the whole engine use `getPolarEngineSingleton()`.
// ---------------------------------------------------------------------------

let _polarEngineSingleton: PolarEngine | null = null;

/** Register the process-wide PolarEngine instance.  Called once at startup. */
export function setPolarEngineSingleton(engine: PolarEngine | null): void {
  _polarEngineSingleton = engine;
}

/** Access the process-wide PolarEngine instance, or null if not yet registered. */
export function getPolarEngineSingleton(): PolarEngine | null {
  return _polarEngineSingleton;
}

/**
 * Convenience: resolve a polar profile by id (string or number).  Returns null
 * when no singleton is registered, when the id is not a valid number, or when
 * the profile does not exist.
 */
export function resolvePolarProfile(id: string | number | null): BoatProfile | null {
  if (id == null) return null;
  const engine = _polarEngineSingleton;
  if (!engine) return null;
  const numeric = typeof id === 'number' ? id : Number(id);
  if (!Number.isFinite(numeric)) return null;
  return engine.getProfile(numeric) ?? null;
}

export class PolarEngine {
  private profiles: Map<number, BoatProfile> = new Map();
  private nextId = 1;
  private polarDirectory: string;
  private profilesPath: string;
  /** Non-null when loadProfiles() caught an error — mirrors the settings-store _loadError pattern. */
  private _profileLoadError: string | null = null;

  constructor() {
    // F6 (Phase 1.4) — all runtime data now lives under ~/aeolus/.
    this.polarDirectory = path.join(os.homedir(), 'aeolus', 'polars');
    this.profilesPath = path.join(
      process.env.APPDATA || path.join(os.homedir(), '.config'),
      'aeolus',
      'boat-profiles.json',
    );
    this.initialize();
  }

  /**
   * Initialize: create directories and pre-seed Sun Fast 3300 if no profiles exist.
   *
   * Phase 1.5 D7 — distinguish "no file yet" from "unreadable file".  If the
   * load reported `failed`, do NOT seed and do NOT save; otherwise the demo
   * Sun Fast 3300 would overwrite the user's imported polars the next time
   * the app started with a corrupt file on disk.  The corrupt file itself
   * is renamed to `boat-profiles.json.corrupt-<ts>` by `loadProfiles` so
   * the data is recoverable.
   */
  private initialize(): void {
    if (!fs.existsSync(this.polarDirectory)) {
      fs.mkdirSync(this.polarDirectory, { recursive: true });
    }
    const { profiles: loaded, failed } = this.loadProfiles();
    if (failed) {
      // Load failed — refuse to seed or persist anything to disk.
      return;
    }
    if (loaded.length === 0) {
      this.addProfile({
        name: 'Sun Fast 3300',
        hullType: 'monohull',
        polarData: SUN_FAST_3300_POLAR,
      });
    }
  }

  /**
   * Load profiles from the boat-profiles.json file.
   *
   * Phase 1.5 D7 — returns a discriminated result so callers can distinguish
   * "no file / empty file" (`failed: false, profiles: []`) from "unreadable /
   * corrupt file" (`failed: true`).  When the parse fails, the corrupt file
   * is renamed to `boat-profiles.json.corrupt-<ISO>` before the error is
   * reported so the user's data is never silently overwritten by a later
   * `saveProfiles()`.
   */
  private loadProfiles(): { profiles: BoatProfile[]; failed: boolean } {
    try {
      const configDir = path.dirname(this.profilesPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      if (fs.existsSync(this.profilesPath)) {
        const raw = fs.readFileSync(this.profilesPath, 'utf-8');
        const parsed = JSON.parse(raw) as BoatProfile[];
        for (const p of parsed) {
          this.profiles.set(p.id, p);
          if (p.id >= this.nextId) {
            this.nextId = p.id + 1;
          }
        }
        return { profiles: parsed, failed: false };
      }
    } catch (err: any) {
      // Surface the error instead of silently discarding it — mirrors settings-store _loadError pattern.
      this._profileLoadError = err?.message ?? String(err);
      // Rename the bad file so the next save() cannot clobber the user's data.
      try {
        if (fs.existsSync(this.profilesPath)) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const bak = `${this.profilesPath}.corrupt-${stamp}`;
          fs.renameSync(this.profilesPath, bak);
          console.error(`[PolarEngine] Corrupt boat-profiles.json renamed to ${bak}`);
        }
      } catch (renameErr) {
        console.error('[PolarEngine] Failed to rename corrupt boat-profiles.json:', renameErr);
      }
      return { profiles: [], failed: true };
    }
    return { profiles: [], failed: false };
  }

  /**
   * Return the most recent load error message from loadProfiles(), or null if the last load succeeded.
   * Used by the IPC handler to surface corrupt-profile errors to the renderer.
   */
  getProfileLoadError(): string | null {
    return this._profileLoadError;
  }

  /**
   * Save all profiles to disk.
   */
  private saveProfiles(): void {
    try {
      const configDir = path.dirname(this.profilesPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      const profiles = Array.from(this.profiles.values());
      fs.writeFileSync(this.profilesPath, JSON.stringify(profiles, null, 2), 'utf-8');
    } catch (err) {
      console.error('[PolarEngine] Failed to save profiles:', err);
    }
  }

  /**
   * Add a new boat profile.
   */
  addProfile(profile: { name: string; hullType: string; polarData: PolarTable }): BoatProfile {
    const newProfile: BoatProfile = {
      id: this.nextId++,
      name: profile.name,
      hullType: profile.hullType,
      polarData: profile.polarData,
      createdAt: new Date().toISOString(),
    };
    this.profiles.set(newProfile.id, newProfile);
    this.saveProfiles();
    return newProfile;
  }

  /**
   * Remove a profile by ID.
   */
  removeProfile(id: number): boolean {
    if (this.profiles.has(id)) {
      this.profiles.delete(id);
      this.saveProfiles();
      return true;
    }
    return false;
  }

  /**
   * List all profiles.
   */
  listProfiles(): BoatProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get a profile by ID.
   */
  getProfile(id: number): BoatProfile | undefined {
    return this.profiles.get(id);
  }

  /**
   * Import a .pol file.
   * Standard .pol format: first line is TWS values, subsequent lines are TWA + speed values.
   */
  importPolFile(filePath: string, name: string, hullType = 'monohull'): BoatProfile | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const table = this.parsePolContent(content);
      if (!table) return null;

      // Copy file to polar directory
      const ext = path.extname(filePath) || '.pol';
      const destPath = path.join(this.polarDirectory, `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`);
      fs.copyFileSync(filePath, destPath);

      return this.addProfile({ name, hullType, polarData: table });
    } catch (err) {
      console.error('[PolarEngine] Failed to import .pol file:', err);
      return null;
    }
  }

  /**
   * Import a .csv file.
   * CSV format: header row = TWS values, first column = TWA, rest = speeds.
   */
  importCsvFile(filePath: string, name: string, hullType = 'monohull'): BoatProfile | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const table = this.parseCsvContent(content);
      if (!table) return null;

      // Copy file to polar directory
      const ext = path.extname(filePath) || '.csv';
      const destPath = path.join(this.polarDirectory, `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`);
      fs.copyFileSync(filePath, destPath);

      return this.addProfile({ name, hullType, polarData: table });
    } catch (err) {
      console.error('[PolarEngine] Failed to import CSV file:', err);
      return null;
    }
  }

  /**
   * Import an Expedition .txt polar file.
   * Expedition format: comment lines start with '!'; each data line has
   * TWS as the first token, followed by interleaved [TWA, BSP] pairs.
   */
  importExpeditionFile(filePath: string, name: string, hullType = 'monohull'): BoatProfile | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const table = this.parseExpeditionContent(content);
      if (!table) return null;

      // Copy file to polar directory
      const ext = path.extname(filePath) || '.txt';
      const destPath = path.join(this.polarDirectory, `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`);
      fs.copyFileSync(filePath, destPath);

      return this.addProfile({ name, hullType, polarData: table });
    } catch (err) {
      console.error('[PolarEngine] Failed to import Expedition file:', err);
      return null;
    }
  }

  /**
   * Parse .pol file content into a PolarTable.
   * Format: First line: TWS values separated by whitespace.
   * Subsequent lines: TWA value followed by speed values.
   */
  parsePolContent(content: string): PolarTable | null {
    const lines = content.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return null;

    // First line: TWS values
    const twsValues = lines[0]
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => !isNaN(n));

    if (twsValues.length === 0) return null;

    const twaValues: number[] = [];
    // speeds[twsIdx][twaIdx] — fix #1: outer index is TWS (column), inner is TWA (row)
    const speeds: number[][] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i]
        .trim()
        .split(/\s+/)
        .map(Number);

      if (cols.length < 2) continue;

      const twaIdx = twaValues.length;
      twaValues.push(cols[0]);
      // Each data column j (1-based) corresponds to twsValues[j-1]
      for (let j = 1; j < cols.length; j++) {
        const twsIdx = j - 1;
        if (!speeds[twsIdx]) speeds[twsIdx] = [];
        speeds[twsIdx][twaIdx] = isNaN(cols[j]) ? 0 : cols[j];
      }
    }

    if (twaValues.length === 0 || speeds.length === 0) return null;

    return { tws: twsValues, twa: twaValues, speeds };
  }

  /**
   * Parse CSV content into a PolarTable.
   * Header row: ,TWS1,TWS2,...
   * Data rows: TWA1,speed1,speed2,...
   */
  parseCsvContent(content: string): PolarTable | null {
    const lines = content.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return null;

    // Header: first cell is empty/TWA label, rest are TWS values
    const header = lines[0].split(',').map((c) => c.trim());
    const twsValues = header.slice(1).map(Number).filter((n) => !isNaN(n));

    if (twsValues.length === 0) return null;

    const twaValues: number[] = [];
    // speeds[twsIdx][twaIdx] — fix #1: outer index is TWS (column), inner is TWA (row)
    const speeds: number[][] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      const twa = Number(cols[0]);
      if (isNaN(twa)) continue;

      const twaIdx = twaValues.length;
      twaValues.push(twa);
      // Each data column j (1-based) corresponds to twsValues[j-1]
      for (let j = 1; j < cols.length; j++) {
        const twsIdx = j - 1;
        const val = Number(cols[j]);
        if (!speeds[twsIdx]) speeds[twsIdx] = [];
        speeds[twsIdx][twaIdx] = isNaN(val) ? 0 : val;
      }
    }

    if (twaValues.length === 0) return null;

    return { tws: twsValues, twa: twaValues, speeds };
  }

  /**
   * Parse Expedition .txt polar content into a PolarTable.
   *
   * Expedition format:
   *   !comment                    ← skip
   *   4 0 0 46.11 3.67 52 3.99    ← TWS=4, then [TWA BSP] pairs
   *   6 0 0 43.118 4.95 52 5.49   ← TWS=6
   *
   * The (TWA=0, BSP=0) pair is a sentinel meaning "cannot sail dead
   * upwind" and is discarded. TWA values vary per row (the VMG angle
   * shifts with wind speed), so we take the union of all TWA values
   * across rows as the canonical TWA axis and linearly interpolate
   * each row onto it. Where a row does not cover a given TWA (outside
   * that row's min/max known TWA), we clamp BSP to 0.
   */
  parseExpeditionContent(content: string): PolarTable | null {
    const lines = content.split(/\r?\n/);

    interface RawRow {
      tws: number;
      points: Array<{ twa: number; bsp: number }>;
    }
    const rows: RawRow[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('!')) continue;

      const tokens = line.split(/\s+/).map(Number);
      if (tokens.length < 1 || isNaN(tokens[0])) continue;

      const tws = tokens[0];
      const rest = tokens.slice(1);

      // Remaining tokens must come in [TWA, BSP] pairs
      if (rest.length % 2 !== 0) {
        throw new Error(
          `Malformed Expedition polar line for TWS=${tws}: expected TWA/BSP pairs, got ${rest.length} tokens after TWS`,
        );
      }

      const points: Array<{ twa: number; bsp: number }> = [];
      for (let i = 0; i < rest.length; i += 2) {
        const twa = rest[i];
        const bsp = rest[i + 1];
        if (isNaN(twa) || isNaN(bsp)) continue;
        // Sentinel: (TWA=0, BSP=0) means "cannot sail dead upwind" — discard
        if (twa === 0 && bsp === 0) continue;
        points.push({ twa, bsp });
      }

      if (points.length === 0) continue;
      // Ensure per-row points are sorted by TWA for interpolation
      points.sort((a, b) => a.twa - b.twa);
      rows.push({ tws, points });
    }

    if (rows.length === 0) return null;

    // Sort rows by TWS ascending
    rows.sort((a, b) => a.tws - b.tws);

    // Collect unique TWA values across all rows
    const twaSet = new Set<number>();
    for (const row of rows) {
      for (const p of row.points) {
        twaSet.add(p.twa);
      }
    }
    const twaAxis = Array.from(twaSet).sort((a, b) => a - b);
    if (twaAxis.length === 0) return null;

    // For each row, interpolate BSP at every TWA on the canonical axis
    const speeds: number[][] = rows.map((row) => {
      const rowMinTwa = row.points[0].twa;
      const rowMaxTwa = row.points[row.points.length - 1].twa;
      return twaAxis.map((targetTwa) => {
        // Hold at the boundary VMG speed for angles tighter than the row's VMG
        // angle (or beyond its max). Clamping to 0 would corrupt bilinear
        // interpolation across neighbouring rows that have different VMG minima.
        if (targetTwa < rowMinTwa) return row.points[0].bsp;
        if (targetTwa > rowMaxTwa) return row.points[row.points.length - 1].bsp;

        // Exact match?
        for (const p of row.points) {
          if (p.twa === targetTwa) return p.bsp;
        }

        // Linear interpolation between bracketing points
        let lo = row.points[0];
        let hi = row.points[row.points.length - 1];
        for (let i = 0; i < row.points.length - 1; i++) {
          if (row.points[i].twa <= targetTwa && row.points[i + 1].twa >= targetTwa) {
            lo = row.points[i];
            hi = row.points[i + 1];
            break;
          }
        }
        if (hi.twa === lo.twa) return lo.bsp;
        const t = (targetTwa - lo.twa) / (hi.twa - lo.twa);
        return lo.bsp * (1 - t) + hi.bsp * t;
      });
    });

    // Each row's own beat angle is its tightest surviving point, and its run
    // angle its widest before 180°. The canonical axis above is the union of
    // every row's angles, so without recording these here the per-row values
    // are unrecoverable — a 24 kt row beating at 42.1° would be drawn from
    // 39.265°, the 10 kt row's angle. Rendering metadata only; `speeds` is
    // unchanged and every performance path still reads it exactly as before.
    const beatAngles = rows.map((r) => r.points[0].twa);

    return {
      tws: rows.map((r) => r.tws),
      twa: twaAxis,
      speeds,
      beatAngles,
    };
  }

  /**
   * Interpolate boat speed given TWS and TWA (delegates to the free function
   * `interpolateSpeed` — Phase 1.6 R2a).  Retained as an instance method for
   * API compatibility; new callers should import `interpolateSpeed` directly.
   */
  interpolateSpeed(
    table: PolarTable,
    tws: number,
    twa: number,
    method: InterpolationMethod = 'pchip',
  ): number | null {
    return interpolateSpeed(table, tws, twa, method);
  }

  /**
   * F1 (Phase 1.4) — recompute % polar for an already-observed sample against
   * an arbitrary polar table.  Distinct from `computePerformance()` in that
   * it returns a floating-point number and null (not a rounded integer inside
   * an object) so that comparison-time aggregation preserves precision.
   */
  recomputePercentPolar(
    table: PolarTable,
    tws: number | null,
    twa: number | null,
    stw: number | null,
  ): number | null {
    if (tws == null || twa == null || stw == null) return null;
    const target = interpolateSpeed(table, tws, twa);
    if (target == null || target === 0) return null;
    return (stw / target) * 100;
  }

  /**
   * Compute % of polar: (actual STW / interpolated target speed) × 100.
   * Returns null if wind data (TWS, TWA) or STW is missing.
   */
  computePerformance(
    table: PolarTable,
    tws: number | null,
    twa: number | null,
    stw: number | null,
  ): PolarPerformanceResult {
    if (tws === null || twa === null || stw === null) {
      return { percentPolar: null, targetSpeed: null, actualSpeed: null };
    }

    const targetSpeed = interpolateSpeed(table, tws, twa);
    if (targetSpeed === null) {
      return { percentPolar: null, targetSpeed: null, actualSpeed: stw };
    }

    if (targetSpeed === 0) {
      return { percentPolar: null, targetSpeed: 0, actualSpeed: stw };
    }

    const percent = Math.round((stw / targetSpeed) * 100);
    return { percentPolar: percent, targetSpeed, actualSpeed: stw };
  }
}
