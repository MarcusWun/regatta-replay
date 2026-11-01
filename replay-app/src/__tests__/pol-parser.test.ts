// pol-parser facade — asserts that the Object.create trick exposes the
// vendor-copied parsers' output identically to a full PolarEngine instance.
import { describe, expect, it } from 'vitest';
import {
  parseCsvContent,
  parseExpeditionContent,
  parsePolContent,
  parsePolar,
} from '../lib/polar-engine/pol-parser';
import { PolarEngine } from '../lib/polar-engine/polar-engine';

const POL_SAMPLE = `6\t10\t14
40\t2.0\t3.5\t5.0
60\t3.0\t5.0\t7.0
80\t3.5\t5.5\t7.5
`;

const CSV_SAMPLE = `TWA,6,10,14
40,2.0,3.5,5.0
60,3.0,5.0,7.0
80,3.5,5.5,7.5
`;

const EXPEDITION_SAMPLE = `!SF 3300
4 0 0 52 3.99 60 4.35 75 4.61
6 0 0 52 5.49 60 5.98 75 6.20
`;

describe('pol-parser facade', () => {
  it('matches PolarEngine.parsePolContent exactly', () => {
    const direct = new PolarEngine().parsePolContent(POL_SAMPLE);
    const facade = parsePolContent(POL_SAMPLE);
    expect(facade).toEqual(direct);
  });

  it('matches PolarEngine.parseCsvContent exactly', () => {
    const direct = new PolarEngine().parseCsvContent(CSV_SAMPLE);
    const facade = parseCsvContent(CSV_SAMPLE);
    expect(facade).toEqual(direct);
  });

  it('matches PolarEngine.parseExpeditionContent exactly', () => {
    const direct = new PolarEngine().parseExpeditionContent(EXPEDITION_SAMPLE);
    const facade = parseExpeditionContent(EXPEDITION_SAMPLE);
    expect(facade).toEqual(direct);
  });

  it('parsePolar auto-detects Expedition polars (sentinel zeros)', () => {
    const parsed = parsePolar(EXPEDITION_SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed!.format).toBe('expedition');
    expect(parsed!.twsRange).toEqual([4, 6]);
    expect(parsed!.twaRange).toEqual([52, 75]);
  });

  it('parsePolar auto-detects legacy .pol files', () => {
    const parsed = parsePolar(POL_SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed!.format).toBe('pol');
    expect(parsed!.twsRange).toEqual([6, 14]);
  });

  it('parsePolar auto-detects CSV files', () => {
    const parsed = parsePolar(CSV_SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed!.format).toBe('csv');
  });

  it('returns null for empty input', () => {
    expect(parsePolar('')).toBeNull();
    expect(parsePolar('   \n   ')).toBeNull();
  });

  it('returns null for junk content', () => {
    expect(parsePolar('not a polar file\nat all')).toBeNull();
  });
});
