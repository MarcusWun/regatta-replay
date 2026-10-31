import { describe, expect, it } from 'vitest';
import { BOAT_PALETTE, colorForMmsi, rgbToCss } from '../lib/colors';

describe('colorForMmsi', () => {
  it('is deterministic for a given mmsi', () => {
    expect(colorForMmsi('367123456')).toEqual(colorForMmsi('367123456'));
  });

  it('picks colours from the fixed palette', () => {
    for (let i = 0; i < 100; i++) {
      const c = colorForMmsi(String(100_000_000 + i));
      expect(BOAT_PALETTE).toContainEqual(c);
    }
  });

  it('spreads nearby mmsis across different palette entries', () => {
    const colors = new Set<string>();
    for (let i = 0; i < 24; i++) {
      colors.add(JSON.stringify(colorForMmsi(String(200_000_000 + i))));
    }
    // Not a strict guarantee but with 12 palette entries and 24 inputs we
    // should see several distinct hashes.
    expect(colors.size).toBeGreaterThanOrEqual(5);
  });
});

describe('rgbToCss', () => {
  it('serialises alpha=1 by default', () => {
    expect(rgbToCss([10, 20, 30])).toBe('rgba(10, 20, 30, 1)');
  });

  it('honours a custom alpha', () => {
    expect(rgbToCss([10, 20, 30], 0.5)).toBe('rgba(10, 20, 30, 0.5)');
  });
});
