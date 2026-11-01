import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FleetVMCChart, splitRuns } from '../components/analytics/FleetVMCChart';
import type { FleetVMC, FleetVMCSample } from '../hooks/useFleetVMC';
import type { VesselRow } from '../lib/types';

function vessel(mmsi: string, name: string): VesselRow {
  return {
    mmsi,
    ais_name: name,
    display_name: name,
    sail_number: null,
    class: null,
    call_sign: null,
    vessel_type: null,
    excluded: 0,
    added_post_race: 0,
  };
}

function sample(
  timestampMs: number,
  value: number,
  dashed: boolean,
  targetMarkSeq = 1,
  targetMarkName = 'M2',
): FleetVMCSample {
  return { timestampMs, value, dashed, targetMarkSeq, targetMarkName };
}

const START = Date.parse('2026-10-31T12:00:00Z');
const END = START + 30 * 60 * 1000;

describe('splitRuns — segment chunking', () => {
  it('returns a single run when all samples share the same dashed flag', () => {
    const samples = [
      sample(START + 60_000, 5, false),
      sample(START + 120_000, 5.1, false),
      sample(START + 180_000, 4.9, false),
    ];
    const runs = splitRuns('AAA', 'Alpha', '#f00', samples, START, END);
    expect(runs).toHaveLength(1);
    expect(runs[0].dashed).toBe(false);
    expect(runs[0].data).toHaveLength(3);
  });

  it('splits at every solid↔dashed transition with a duplicated boundary sample', () => {
    const samples = [
      sample(START + 60_000, 3, true),
      sample(START + 120_000, 3.2, true),
      sample(START + 180_000, 5, false), // transition
      sample(START + 240_000, 5.1, false),
      sample(START + 300_000, 2.9, true), // transition back
    ];
    const runs = splitRuns('BBB', 'Bravo', '#0f0', samples, START, END);
    expect(runs).toHaveLength(3);
    expect(runs[0].dashed).toBe(true);
    expect(runs[1].dashed).toBe(false);
    expect(runs[2].dashed).toBe(true);
    // Boundary-sample duplication: prior run has one extra sample on its tail.
    expect(runs[0].data).toHaveLength(3); // 2 dashed + 1 boundary into solid
    expect(runs[1].data).toHaveLength(3); // 2 solid + 1 boundary into dashed
    expect(runs[2].data).toHaveLength(1);
  });

  it('clips samples outside [startMs, endMs]', () => {
    const samples = [
      sample(START - 60_000, 5, false), // before window
      sample(START + 60_000, 5, false),
      sample(END + 60_000, 5, false), // after window
    ];
    const runs = splitRuns('CCC', 'Charlie', '#00f', samples, START, END);
    expect(runs).toHaveLength(1);
    expect(runs[0].data).toHaveLength(1);
    expect(runs[0].data[0].vmc).toBe(5);
  });
});

describe('FleetVMCChart — empty state', () => {
  it('renders the "No course loaded" placeholder when fleetVmc.hasCourse is false', () => {
    const fleetVmc: FleetVMC = { byMmsi: new Map(), hasCourse: false };
    render(
      <FleetVMCChart
        fleetVmc={fleetVmc}
        vessels={[]}
        ownMmsi={null}
        hidden={new Set()}
        startMs={START}
        endMs={END}
        nowMs={START}
      />,
    );
    expect(screen.getByTestId('fleet-vmc-chart-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-vmc-chart')).not.toBeInTheDocument();
    expect(screen.getByText(/No course loaded/)).toBeInTheDocument();
  });

  it('renders the chart container when a course is loaded', () => {
    const fleetVmc: FleetVMC = {
      byMmsi: new Map([
        [
          'AAA',
          {
            mmsi: 'AAA',
            samples: [
              sample(START + 60_000, 4.1, false),
              sample(START + 120_000, 4.3, false),
            ],
          },
        ],
      ]),
      hasCourse: true,
    };
    render(
      <FleetVMCChart
        fleetVmc={fleetVmc}
        vessels={[vessel('AAA', 'Alpha')]}
        ownMmsi={null}
        hidden={new Set()}
        startMs={START}
        endMs={END}
        nowMs={START + 60_000}
      />,
    );
    expect(screen.getByTestId('fleet-vmc-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-vmc-chart-empty')).not.toBeInTheDocument();
  });

  it('renders the chart container even when every boat is hidden by the Boat Selector', () => {
    // The "hidden" filter is applied inside the chart's effect; the container
    // itself still renders so the card header + axis remain in the panel.
    const fleetVmc: FleetVMC = {
      byMmsi: new Map([
        [
          'AAA',
          {
            mmsi: 'AAA',
            samples: [sample(START + 60_000, 4.1, false)],
          },
        ],
      ]),
      hasCourse: true,
    };
    render(
      <FleetVMCChart
        fleetVmc={fleetVmc}
        vessels={[vessel('AAA', 'Alpha')]}
        ownMmsi={null}
        hidden={new Set(['AAA'])}
        startMs={START}
        endMs={END}
        nowMs={START + 60_000}
      />,
    );
    expect(screen.getByTestId('fleet-vmc-chart')).toBeInTheDocument();
  });
});
