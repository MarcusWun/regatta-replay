import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PositionRow, VesselRow } from '../lib/types';

const writeFileMock = vi.fn<(path: string, data: Uint8Array) => Promise<void>>();
const writeTextFileMock = vi.fn<(path: string, text: string) => Promise<void>>();

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: (path: string, data: Uint8Array) => writeFileMock(path, data),
  writeTextFile: (path: string, text: string) => writeTextFileMock(path, text),
}));

vi.mock('@tauri-apps/api/path', () => ({
  // Pure POSIX join is good enough for the test — the production path join
  // is OS-aware but we only need deterministic composition here.
  join: (...parts: string[]) => Promise.resolve(parts.join('/')),
}));

// Import *after* vi.mock so the batch module picks up the mocked plugins.
const { runBatchExport } = await import('../lib/export/batch');

function vessel(mmsi: string, displayName: string): VesselRow {
  return {
    mmsi,
    ais_name: null,
    display_name: displayName,
    sail_number: null,
    class: null,
    call_sign: null,
    vessel_type: null,
    excluded: 0,
    added_post_race: 0,
  };
}

function pos(mmsi: string, timestamp: string): PositionRow {
  return {
    mmsi,
    timestamp_utc: timestamp,
    lat: 40.5,
    lon: -74.0,
    sog: 6,
    cog: 180,
    heading: 180,
    source: 'n2k',
    interpolated: 0,
  };
}

const fakeCanvas = {
  toBlob: (cb: (b: Blob | null) => void) => {
    cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }));
  },
} as unknown as HTMLCanvasElement;

const fakeMap = {
  getCanvas: () => fakeCanvas,
  redraw: () => {},
} as unknown as import('maplibre-gl').Map;

beforeEach(() => {
  writeFileMock.mockReset().mockResolvedValue();
  writeTextFileMock.mockReset().mockResolvedValue();
});

describe('runBatchExport', () => {
  it('rejects when no directory is provided', async () => {
    await expect(
      runBatchExport({
        directory: '',
        formats: new Set(['csv']),
        raceName: 'Race',
        startMs: 0,
        elapsedMs: 0,
        boats: [{ vessel: vessel('1', 'A'), positions: [pos('1', '2026-10-30T15:00:00.000Z')] }],
      }),
    ).rejects.toThrow(/No directory selected/);
  });

  it('writes one CSV + one GPX per boat with positions', async () => {
    const result = await runBatchExport({
      directory: '/tmp/exports',
      formats: new Set(['csv', 'gpx']),
      raceName: 'Race X',
      startMs: Date.parse('2026-10-30T15:00:00.000Z'),
      elapsedMs: 0,
      boats: [
        { vessel: vessel('338100001', 'Dark Star'), positions: [pos('338100001', '2026-10-30T15:00:00.000Z')] },
        { vessel: vessel('338100002', 'Blue Moon'), positions: [pos('338100002', '2026-10-30T15:00:00.000Z')] },
      ],
    });
    expect(writeTextFileMock).toHaveBeenCalledTimes(4);
    expect(result.writtenPaths).toHaveLength(4);
    expect(result.skippedBoatsNoPositions).toBe(0);
    const paths = result.writtenPaths.join('\n');
    expect(paths).toContain('/tmp/exports/race-x_338100001_dark-star.csv');
    expect(paths).toContain('/tmp/exports/race-x_338100001_dark-star.gpx');
    expect(paths).toContain('/tmp/exports/race-x_338100002_blue-moon.csv');
    expect(paths).toContain('/tmp/exports/race-x_338100002_blue-moon.gpx');
  });

  it('silently skips boats with zero positions', async () => {
    const result = await runBatchExport({
      directory: '/tmp/exports',
      formats: new Set(['csv', 'gpx']),
      raceName: 'Race',
      startMs: 0,
      elapsedMs: 0,
      boats: [
        { vessel: vessel('1', 'A'), positions: [] },
        { vessel: vessel('2', 'B'), positions: [pos('2', '2026-10-30T15:00:00.000Z')] },
      ],
    });
    expect(result.writtenPaths).toHaveLength(2);
    expect(result.skippedBoatsNoPositions).toBe(1);
  });

  it('writes a PNG using the map canvas', async () => {
    const result = await runBatchExport({
      directory: '/tmp/exports',
      formats: new Set(['png']),
      raceName: 'Race',
      startMs: 0,
      elapsedMs: 32 * 60_000 + 18_000,
      boats: [],
      map: fakeMap,
    });
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [path, bytes] = writeFileMock.mock.calls[0];
    expect(path).toBe('/tmp/exports/race_T+0032m18s_map.png');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(4); // our fake PNG header
    expect(result.writtenPaths).toEqual(['/tmp/exports/race_T+0032m18s_map.png']);
  });

  it('reports PNG skipped when the map ref is null', async () => {
    const result = await runBatchExport({
      directory: '/tmp/exports',
      formats: new Set(['png', 'csv']),
      raceName: 'Race',
      startMs: 0,
      elapsedMs: 0,
      boats: [{ vessel: vessel('1', 'A'), positions: [pos('1', '2026-10-30T15:00:00.000Z')] }],
      map: null,
    });
    expect(result.pngSkippedReason).toBe('map not ready');
    expect(writeFileMock).not.toHaveBeenCalled();
    // CSV still goes through.
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    expect(result.writtenPaths).toHaveLength(1);
  });

  it('reports PNG skipped when the canvas yields no blob', async () => {
    const nullBlobMap = {
      getCanvas: () =>
        ({
          toBlob: (cb: (b: Blob | null) => void) => cb(null),
        }) as unknown as HTMLCanvasElement,
      redraw: () => {},
    } as unknown as import('maplibre-gl').Map;
    const result = await runBatchExport({
      directory: '/tmp/exports',
      formats: new Set(['png']),
      raceName: 'Race',
      startMs: 0,
      elapsedMs: 0,
      boats: [],
      map: nullBlobMap,
    });
    expect(result.pngSkippedReason).toBe('canvas returned no image');
    expect(result.writtenPaths).toHaveLength(0);
  });
});
