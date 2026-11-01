import { describe, expect, it } from 'vitest';
import { boatToGPX } from '../lib/export/gpx';
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

describe('boatToGPX', () => {
  it('declares GPX 1.1 and topografix xmlns', () => {
    const gpx = boatToGPX({
      mmsi: '338123456',
      displayName: 'Dark Star',
      raceName: '2026-10-30 Race',
      positions: [makePosition({})],
    });
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
  });

  it('emits metadata/name with the race name (XML-escaped)', () => {
    const gpx = boatToGPX({
      mmsi: '338123456',
      displayName: 'Dark Star',
      raceName: 'A & B <race>',
      positions: [makePosition({})],
    });
    expect(gpx).toMatch(/<metadata>\s*<name>A &amp; B &lt;race&gt;<\/name>\s*<\/metadata>/);
  });

  it('emits one trkpt per position with lat/lon/time/course/speed', () => {
    const gpx = boatToGPX({
      mmsi: '338123456',
      displayName: 'Dark Star',
      raceName: 'Race',
      positions: [
        makePosition({ timestamp_utc: '2026-10-30T15:00:00.000Z', sog: 6, cog: 90 }),
        makePosition({ timestamp_utc: '2026-10-30T15:00:01.000Z', sog: 7, cog: 95 }),
      ],
    });
    const trkpts = gpx.match(/<trkpt /g) ?? [];
    expect(trkpts).toHaveLength(2);
    expect(gpx).toContain('<trkpt lat="40.5000000" lon="-74.0000000">');
    expect(gpx).toContain('<time>2026-10-30T15:00:00.000Z</time>');
    expect(gpx).toContain('<course>90.0</course>');
    // SOG 6 kts → 6 * 0.5144444 = 3.087 m/s (rounded to 3 decimals).
    expect(gpx).toContain('<speed>3.087</speed>');
  });

  it('omits course/speed when the source values are null', () => {
    const gpx = boatToGPX({
      mmsi: '338123456',
      displayName: 'Dark Star',
      raceName: 'Race',
      positions: [makePosition({ sog: null, cog: null })],
    });
    expect(gpx).not.toContain('<course>');
    expect(gpx).not.toContain('<speed>');
  });

  it('sorts positions ascending by timestamp regardless of input order', () => {
    const gpx = boatToGPX({
      mmsi: '338123456',
      displayName: 'Dark Star',
      raceName: 'Race',
      positions: [
        makePosition({ timestamp_utc: '2026-10-30T15:00:02.000Z' }),
        makePosition({ timestamp_utc: '2026-10-30T15:00:00.000Z' }),
        makePosition({ timestamp_utc: '2026-10-30T15:00:01.000Z' }),
      ],
    });
    const timeMatches = Array.from(gpx.matchAll(/<time>([^<]+)<\/time>/g)).map((m) => m[1]);
    // First match is metadata? No — metadata has only <name>, no <time>. So all three
    // <time> entries are trkpts.
    expect(timeMatches).toEqual([
      '2026-10-30T15:00:00.000Z',
      '2026-10-30T15:00:01.000Z',
      '2026-10-30T15:00:02.000Z',
    ]);
  });

  it('falls back to "MMSI <n>" track name when display name is null', () => {
    const gpx = boatToGPX({
      mmsi: '338123456',
      displayName: null,
      raceName: 'Race',
      positions: [makePosition({})],
    });
    expect(gpx).toContain('<trk>\n    <name>MMSI 338123456</name>');
  });

  it('xml-escapes vessel display names with ampersands', () => {
    const gpx = boatToGPX({
      mmsi: '338123456',
      displayName: 'A & B',
      raceName: 'Race',
      positions: [makePosition({})],
    });
    expect(gpx).toContain('<name>A &amp; B</name>');
  });

  it('produces an empty trkseg when there are no positions', () => {
    const gpx = boatToGPX({
      mmsi: '338123456',
      displayName: 'Empty',
      raceName: 'Race',
      positions: [],
    });
    expect(gpx).toMatch(/<trkseg>\s*<\/trkseg>/);
    expect(gpx).not.toContain('<trkpt ');
  });
});
