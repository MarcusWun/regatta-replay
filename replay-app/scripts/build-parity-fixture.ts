#!/usr/bin/env tsx
// Builds src/lib/polar-engine/parity.fixture.json for the Phase 2b parity gate.
//
// The fixture captures:
//   - a base64-encoded Expedition SF 3300 polar (identical bytes committed to
//     both regatta-replay and aeolus repos)
//   - 20 input triples (TWS, TWA, SOG) covering upwind, reach, downwind,
//     TWS-only interpolation, TWA-only interpolation, and bilinear corners
//   - the engine's exact numeric outputs for each case (target, percent, vmg)
//
// Both repos' CI parses the base64 polar through their vendored engine,
// invokes `interpolateSpeed`, and asserts byte-identical values. Drift in
// either repo's engine → that repo's parity test fails.
//
// Run from repo root (replay-app/):
//   npx tsx scripts/build-parity-fixture.ts

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PolarEngine, interpolateSpeed } from '../src/lib/polar-engine/polar-engine';

// Realistic Sun Fast 3300 Expedition-format polar. 9 TWS rows (4..24 kts),
// 7 TWA data points per row plus the (0,0) sentinel. Same bytes seeded into
// both repos' fixture file via base64 encoding.
const SF3300_EXPEDITION = `!SF 3300 Stratos parity fixture polar
4  0 0  46.11 3.67  52 3.99  60 4.35  75 4.61  90 4.51  110 4.20  139.7 3.30
6  0 0  43.11 4.95  52 5.49  60 5.98  75 6.20  90 6.10  110 5.60  142.85 4.85
8  0 0  41.00 5.90  52 6.55  60 7.02  75 7.30  90 7.20  110 6.70  145.00 5.90
10 0 0  40.00 6.55  52 7.20  60 7.75  75 8.05  90 7.95  110 7.40  148.00 6.70
12 0 0  39.50 7.05  52 7.65  60 8.30  75 8.65  90 8.55  110 7.95  150.00 7.30
14 0 0  39.00 7.35  52 7.95  60 8.65  75 9.05  90 8.95  110 8.30  152.00 7.75
16 0 0  38.50 7.55  52 8.20  60 8.95  75 9.35  90 9.25  110 8.60  155.00 8.10
20 0 0  38.00 7.85  52 8.55  60 9.35  75 9.75  90 9.75  110 9.05  158.00 8.75
24 0 0  38.00 8.10  52 8.85  60 9.70  75 10.05 90 10.15 110 9.50  160.00 9.25
`;

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

// 20 inputs spanning the polar envelope. Each pairs a (TWS, TWA, SOG) with
// an interpolation method so both the linear and pchip code paths are gated.
const INPUTS: Array<Omit<FixtureCase, 'expected'>> = [
  { label: 'close-hauled midwind — linear',  tws: 10, twa: 42, sog: 6.60, method: 'linear' },
  { label: 'close-hauled midwind — pchip',   tws: 10, twa: 42, sog: 6.60, method: 'pchip'  },
  { label: 'close-hauled light — linear',    tws:  6, twa: 45, sog: 5.00, method: 'linear' },
  { label: 'exact row/col TWS=10 TWA=60',    tws: 10, twa: 60, sog: 7.75, method: 'linear' },
  { label: 'TWS between rows — linear',      tws:  9, twa: 60, sog: 7.00, method: 'linear' },
  { label: 'TWS between rows — pchip',       tws:  9, twa: 60, sog: 7.00, method: 'pchip'  },
  { label: 'TWA interp 55° at TWS=12',       tws: 12, twa: 55, sog: 7.80, method: 'linear' },
  { label: 'TWA interp 65° at TWS=12',       tws: 12, twa: 65, sog: 8.40, method: 'linear' },
  { label: 'bilinear TWS=11 TWA=47',         tws: 11, twa: 47, sog: 6.80, method: 'linear' },
  { label: 'reach TWS=14 TWA=90',            tws: 14, twa: 90, sog: 8.85, method: 'linear' },
  { label: 'broad reach TWS=16 TWA=110',     tws: 16, twa: 110, sog: 8.40, method: 'linear' },
  { label: 'running TWS=20 TWA=150',         tws: 20, twa: 150, sog: 8.80, method: 'linear' },
  { label: 'running pchip TWS=20 TWA=150',   tws: 20, twa: 150, sog: 8.80, method: 'pchip'  },
  { label: 'TWS=10 TWA=100 bilinear hint',   tws: 10, twa: 100, sog: 7.60, method: 'linear' },
  { label: 'TWS=15 TWA=75 both-interp',      tws: 15, twa: 75, sog: 9.00, method: 'linear' },
  { label: 'TWS=15 TWA=75 pchip',            tws: 15, twa: 75, sog: 9.00, method: 'pchip'  },
  { label: 'low-TWS limit TWS=4 TWA=90',     tws:  4, twa: 90, sog: 4.30, method: 'linear' },
  { label: 'high-TWS limit TWS=24 TWA=90',   tws: 24, twa: 90, sog: 9.70, method: 'linear' },
  { label: 'exceeds polar TWS=18 TWA=52',    tws: 18, twa: 52, sog: 8.95, method: 'linear' },
  { label: 'below polar TWS=18 TWA=52 pchip',tws: 18, twa: 52, sog: 8.00, method: 'pchip'  },
];

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function toTwaRadians(twa: number): number {
  // TWA in [-180, 180] space. Values in the polar are 0..180 (symmetric).
  return (twa * Math.PI) / 180;
}

function buildFixture(): {
  description: string;
  anchoredToAeolusSha: string;
  polarEncoding: 'base64:expedition';
  polar: string;
  cases: FixtureCase[];
} {
  // Instantiate PolarEngine WITHOUT the browser constraints — this script
  // runs under Node (tsx), so the full engine (including fs-dependent
  // constructor) is safe to use.
  const engine = new PolarEngine();
  const parsed = engine.parseExpeditionContent(SF3300_EXPEDITION);
  if (!parsed) {
    throw new Error('Fixture polar failed to parse — refusing to emit a dead fixture.');
  }

  const cases: FixtureCase[] = INPUTS.map((input) => {
    const target = interpolateSpeed(parsed, input.tws, input.twa, input.method);
    if (target == null) {
      throw new Error(
        `interpolateSpeed returned null for ${input.label} ` +
          `(tws=${input.tws}, twa=${input.twa}, method=${input.method}). ` +
          `Pick inputs that stay inside the polar envelope.`,
      );
    }
    const percent = round2((input.sog / target) * 100);
    const vmg = round2(input.sog * Math.cos(toTwaRadians(input.twa)));
    return {
      ...input,
      expected: {
        target,
        percent,
        vmg,
      },
    };
  });

  return {
    description:
      'Phase 2b parity gate — identical bytes committed to MarcusWun/regatta-replay ' +
      '(src/lib/polar-engine/parity.fixture.json) and MarcusWun/aeolus ' +
      '(electron/__tests__/parity.fixture.json). Both repos run the fixture through ' +
      'their vendored polar-engine and assert byte-identical outputs.',
    anchoredToAeolusSha: process.env.AEOLUS_SHA ?? 'MANUALLY_RECORD_IN_COMMIT_MESSAGE',
    polarEncoding: 'base64:expedition',
    polar: Buffer.from(SF3300_EXPEDITION, 'utf-8').toString('base64'),
    cases,
  };
}

function main(): void {
  const fixture = buildFixture();
  const outPath = resolve(
    import.meta.dirname ?? resolve('./scripts'),
    '..',
    'src',
    'lib',
    'polar-engine',
    'parity.fixture.json',
  );
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n', 'utf-8');
  console.log(`Wrote ${fixture.cases.length} cases to ${outPath}`);
}

main();
