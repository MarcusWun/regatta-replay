import { describe, expect, it } from 'vitest';
import { nearestWind, normaliseAngle180 } from '../lib/wind';
import type { WindRow } from '../lib/types';

const rows: WindRow[] = [
  { timestamp_utc: '2026-10-31T12:00:00Z', tws: 10, twd: 0, aws: null, awa: null, source: 't' },
  { timestamp_utc: '2026-10-31T12:00:05Z', tws: 11, twd: 1, aws: null, awa: null, source: 't' },
  { timestamp_utc: '2026-10-31T12:00:10Z', tws: 12, twd: 2, aws: null, awa: null, source: 't' },
];

describe('nearestWind', () => {
  it('returns the row within ±2 s of the request', () => {
    const r = nearestWind(rows, Date.parse('2026-10-31T12:00:04Z'));
    expect(r?.tws).toBe(11); // 5s row is 1s away; 0s row is 4s away
  });

  it('returns null when nothing is within the tolerance', () => {
    expect(nearestWind(rows, Date.parse('2026-10-31T12:00:30Z'))).toBeNull();
  });

  it('returns null for empty rows', () => {
    expect(nearestWind([], Date.parse('2026-10-31T12:00:00Z'))).toBeNull();
  });

  it('handles exact matches', () => {
    const r = nearestWind(rows, Date.parse('2026-10-31T12:00:00Z'));
    expect(r?.tws).toBe(10);
  });
});

describe('normaliseAngle180', () => {
  it('maps 270 → -90', () => {
    expect(normaliseAngle180(270)).toBe(-90);
  });
  it('maps -270 → 90', () => {
    expect(normaliseAngle180(-270)).toBe(90);
  });
  it('leaves values in range alone', () => {
    expect(normaliseAngle180(180)).toBe(180);
    expect(normaliseAngle180(0)).toBe(0);
    expect(normaliseAngle180(-179)).toBe(-179);
  });
});
