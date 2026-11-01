import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  CSV_COLUMNS,
  boatToCSV,
  formatRelativeTimestamp,
  type OwnBoatMetricsEntry,
} from '../lib/export/csv';
import type { PositionRow } from '../lib/types';

function makePosition(overrides: Partial<PositionRow>): PositionRow {
  return {
    mmsi: '338123456',
    timestamp_utc: '2026-10-30T15:00:00.000Z',
    lat: 40.5,
    lon: -74.0,
    sog: 6.4,
    cog: 180,
    heading: 182,
    source: 'n2k_129038',
    interpolated: 0,
    ...overrides,
  };
}

describe('formatRelativeTimestamp', () => {
  it('zero → +00:00:00', () => {
    expect(formatRelativeTimestamp(0)).toBe('+00:00:00');
  });

  it('positive delta pads correctly', () => {
    expect(formatRelativeTimestamp(32 * 60_000 + 18_000)).toBe('+00:32:18');
    expect(formatRelativeTimestamp(3_600_000 + 65_000)).toBe('+01:01:05');
  });

  it('negative delta prefixes -', () => {
    expect(formatRelativeTimestamp(-45_000)).toBe('-00:00:45');
  });
});

describe('boatToCSV', () => {
  const startMs = Date.parse('2026-10-30T15:00:00.000Z');

  it('prefixes a UTF-8 BOM', () => {
    const csv = boatToCSV({ positions: [makePosition({})], startMs });
    expect(csv.startsWith(CSV_BOM)).toBe(true);
  });

  it('emits the full header schema from PRD §2', () => {
    const csv = boatToCSV({ positions: [], startMs });
    const headerLine = csv.replace(CSV_BOM, '').split(/\r?\n/)[0];
    expect(headerLine).toBe(CSV_COLUMNS.join(','));
  });

  it('leaves wind/VMG/polar/VMC columns blank for a competitor', () => {
    const csv = boatToCSV({
      positions: [makePosition({ timestamp_utc: '2026-10-30T15:00:30.000Z' })],
      startMs,
    });
    const rows = csv.replace(CSV_BOM, '').trim().split(/\r?\n/);
    expect(rows).toHaveLength(2);
    const cells = rows[1].split(',');
    expect(cells[0]).toBe('2026-10-30T15:00:30.000Z');
    expect(cells[1]).toBe('+00:00:30');
    expect(cells[2]).toBe('40.5000000');
    expect(cells[3]).toBe('-74.0000000');
    expect(cells[4]).toBe('6.40');
    // Competitor rows: wind/VMG/polar/VMC columns all blank.
    for (let i = 9; i < cells.length; i += 1) {
      expect(cells[i]).toBe('');
    }
  });

  it('includes wind/VMG/polar%/VMC columns for the own-boat', () => {
    const positions = [
      makePosition({ timestamp_utc: '2026-10-30T15:00:00.000Z' }),
      makePosition({ timestamp_utc: '2026-10-30T15:00:01.000Z', sog: 7.1 }),
    ];
    const metrics = new Map<string, OwnBoatMetricsEntry>();
    metrics.set('2026-10-30T15:00:00.000Z', {
      tws: 12.3,
      twd: 210,
      aws: 15.1,
      awa: 35,
      twa: 45.6,
      vmg: 4.9,
      polarPct: 92.5,
      vmc: 3.3,
    });
    metrics.set('2026-10-30T15:00:01.000Z', {
      tws: 12.5,
      twd: 210,
      aws: 15.2,
      awa: 34,
      twa: 44.1,
      vmg: 5.0,
      polarPct: 95.0,
      vmc: null,
    });
    const csv = boatToCSV({ positions, startMs, ownBoatMetrics: metrics });
    const rows = csv.replace(CSV_BOM, '').trim().split(/\r?\n/);
    expect(rows).toHaveLength(3);
    const row0 = rows[1].split(',');
    expect(row0[9]).toBe('12.30'); // tws
    expect(row0[10]).toBe('210.0'); // twd
    expect(row0[11]).toBe('15.10'); // aws
    expect(row0[12]).toBe('35.0'); // awa
    expect(row0[13]).toBe('45.6'); // twa
    expect(row0[14]).toBe('4.90'); // vmg
    expect(row0[15]).toBe('92.5'); // polar%
    expect(row0[16]).toBe('3.30'); // vmc
    const row1 = rows[2].split(',');
    expect(row1[16]).toBe(''); // vmc null → blank
  });

  it('sorts positions ascending even when input is unordered', () => {
    const positions = [
      makePosition({ timestamp_utc: '2026-10-30T15:00:02.000Z' }),
      makePosition({ timestamp_utc: '2026-10-30T15:00:00.000Z' }),
      makePosition({ timestamp_utc: '2026-10-30T15:00:01.000Z' }),
    ];
    const csv = boatToCSV({ positions, startMs });
    const rows = csv.replace(CSV_BOM, '').trim().split(/\r?\n/);
    expect(rows[1].split(',')[0]).toBe('2026-10-30T15:00:00.000Z');
    expect(rows[2].split(',')[0]).toBe('2026-10-30T15:00:01.000Z');
    expect(rows[3].split(',')[0]).toBe('2026-10-30T15:00:02.000Z');
  });

  it('quotes cells containing commas / quotes / newlines', () => {
    const csv = boatToCSV({
      positions: [makePosition({ source: 'n2k, 129038 "live"' })],
      startMs,
    });
    expect(csv).toContain('"n2k, 129038 ""live"""');
  });

  it('writes interpolated 1/0 as a hard digit', () => {
    const csv = boatToCSV({
      positions: [makePosition({ interpolated: 1 })],
      startMs,
    });
    const cells = csv.replace(CSV_BOM, '').trim().split(/\r?\n/)[1].split(',');
    expect(cells[8]).toBe('1');
  });

  it('leaves cells blank for null sog/cog/heading', () => {
    const csv = boatToCSV({
      positions: [makePosition({ sog: null, cog: null, heading: null })],
      startMs,
    });
    const cells = csv.replace(CSV_BOM, '').trim().split(/\r?\n/)[1].split(',');
    expect(cells[4]).toBe('');
    expect(cells[5]).toBe('');
    expect(cells[6]).toBe('');
  });

  it('preserves non-ASCII vessel source text through the BOM path', () => {
    const csv = boatToCSV({
      positions: [makePosition({ source: 'Ålesund-GPS' })],
      startMs,
    });
    expect(csv).toContain('Ålesund-GPS');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
});
