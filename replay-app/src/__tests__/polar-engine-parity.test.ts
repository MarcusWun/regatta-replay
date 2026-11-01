// Phase 2b parity gate (Replay side).
//
// Reads the shared `parity.fixture.json` and asserts that this repo's
// vendor-copied polar engine produces byte-identical outputs to the
// expected values. The identical fixture file is committed to
// MarcusWun/aeolus (`electron/__tests__/parity.fixture.json`), where the
// sibling test runs the same cases through Aeolus's live engine and
// asserts the same expected values.
//
// Drift in either repo's engine → that repo's CI fails. Resolve by making
// a coordinated two-repo commit updating both engines + the fixture.
//
// To regenerate the fixture: `npx tsx scripts/build-parity-fixture.ts`.
import { describe, expect, it } from 'vitest';
import fixture from '../lib/polar-engine/parity.fixture.json';
import { PolarEngine, interpolateSpeed } from '../lib/polar-engine/polar-engine';
import { parseExpeditionContent } from '../lib/polar-engine/pol-parser';

interface FixtureCase {
  label: string;
  tws: number;
  twa: number;
  sog: number;
  method: 'linear' | 'pchip';
  expected: {
    target: number;
    percent: number;
    vmg: number;
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function toTwaRadians(twa: number): number {
  return (twa * Math.PI) / 180;
}

const polarContent = Buffer.from(fixture.polar as string, 'base64').toString('utf-8');
const cases = fixture.cases as FixtureCase[];

describe('polar-engine parity gate (Replay)', () => {
  it('decodes the shared polar bytes', () => {
    expect(polarContent).toContain('SF 3300');
    expect(polarContent.split(/\r?\n/).length).toBeGreaterThan(5);
  });

  it('parses the shared polar identically via the free-function parser (pol-parser.ts)', () => {
    const table = parseExpeditionContent(polarContent);
    expect(table).not.toBeNull();
    expect(table!.tws).toEqual([4, 6, 8, 10, 12, 14, 16, 20, 24]);
  });

  it('parses the shared polar identically via the PolarEngine class', () => {
    const engine = new PolarEngine();
    const table = engine.parseExpeditionContent(polarContent);
    const facade = parseExpeditionContent(polarContent);
    expect(table).toEqual(facade);
  });

  const engine = new PolarEngine();
  const table = engine.parseExpeditionContent(polarContent);
  if (!table) throw new Error('Fixture polar failed to parse');

  it.each(cases)(
    'parity case: $label (tws=$tws, twa=$twa, method=$method)',
    (c) => {
      const target = interpolateSpeed(table, c.tws, c.twa, c.method);
      expect(target).not.toBeNull();
      expect(target).toBe(c.expected.target);

      const percent = round2((c.sog / target!) * 100);
      expect(percent).toBe(c.expected.percent);

      const vmg = round2(c.sog * Math.cos(toTwaRadians(c.twa)));
      expect(vmg).toBe(c.expected.vmg);
    },
  );
});
