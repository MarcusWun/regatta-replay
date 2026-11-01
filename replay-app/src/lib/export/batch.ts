// Phase 2c — batch export orchestrator.
//
// Given a chosen directory, selected formats, and the fleet-scope boats, write
// everything the user asked for into one directory in one shot. Returns the
// list of actually-written file paths so the UI can toast "N files saved to X".
//
// All I/O is funnelled through @tauri-apps/plugin-fs so the Tauri permission
// scope (see src-tauri/capabilities/default.json) is the single source of
// truth for what the user can write where.
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type * as maplibregl from 'maplibre-gl';
import type { PositionRow, VesselRow } from '../types';
import { boatToCSV, type OwnBoatMetricsEntry } from './csv';
import { boatToGPX } from './gpx';
import { captureMapPng } from './png';
import { csvFilename, gpxFilename, pngFilename } from './filename';

export type ExportFormat = 'png' | 'csv' | 'gpx';

export interface BatchExportBoat {
  vessel: VesselRow;
  positions: PositionRow[];
  /** Own-boat only — supplies the extended wind/VMG/polar%/VMC columns. */
  ownBoatMetrics?: Map<string, OwnBoatMetricsEntry>;
}

export interface BatchExportInput {
  directory: string;
  formats: Set<ExportFormat>;
  raceName: string | null;
  startMs: number;
  elapsedMs: number;
  /** Boats already filtered down to the user's chosen scope. */
  boats: BatchExportBoat[];
  /** Required when `formats` includes `png`. */
  map?: maplibregl.Map | null;
}

export interface BatchExportResult {
  writtenPaths: string[];
  skippedBoatsNoPositions: number;
  pngSkippedReason?: string;
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

export async function runBatchExport(
  input: BatchExportInput,
): Promise<BatchExportResult> {
  if (!input.directory) {
    throw new Error('No directory selected for export.');
  }

  const written: string[] = [];
  let skipped = 0;
  let pngSkippedReason: string | undefined;

  if (input.formats.has('png')) {
    if (!input.map) {
      pngSkippedReason = 'map not ready';
    } else {
      const blob = await captureMapPng(input.map);
      if (!blob) {
        pngSkippedReason = 'canvas returned no image';
      } else {
        const data = await blobToUint8Array(blob);
        const path = await join(
          input.directory,
          pngFilename(input.raceName, input.elapsedMs),
        );
        await writeFile(path, data);
        written.push(path);
      }
    }
  }

  if (input.formats.has('csv') || input.formats.has('gpx')) {
    for (const b of input.boats) {
      if (b.positions.length === 0) {
        skipped += 1;
        continue;
      }
      const displayName = b.vessel.display_name ?? b.vessel.sail_number ?? b.vessel.ais_name;

      if (input.formats.has('csv')) {
        const content = boatToCSV({
          positions: b.positions,
          startMs: input.startMs,
          ownBoatMetrics: b.ownBoatMetrics,
        });
        const path = await join(
          input.directory,
          csvFilename(input.raceName, b.vessel.mmsi, displayName),
        );
        await writeTextFile(path, content);
        written.push(path);
      }

      if (input.formats.has('gpx')) {
        const content = boatToGPX({
          mmsi: b.vessel.mmsi,
          displayName,
          raceName: input.raceName,
          positions: b.positions,
        });
        const path = await join(
          input.directory,
          gpxFilename(input.raceName, b.vessel.mmsi, displayName),
        );
        await writeTextFile(path, content);
        written.push(path);
      }
    }
  }

  return { writtenPaths: written, skippedBoatsNoPositions: skipped, pngSkippedReason };
}
