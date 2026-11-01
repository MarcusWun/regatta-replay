import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OwnBoatPerformance } from '../components/analytics/OwnBoatPerformance';
import type { PolarPerformanceSeries } from '../hooks/usePolarPerformance';
import type { VMCEntry, VMCSnapshot } from '../hooks/useVMC';

const emptyPerfSeries: PolarPerformanceSeries = { entries: [] };

function snap(partial: Partial<VMCSnapshot>): VMCSnapshot {
  return {
    instantaneous: null,
    smoothed10min: null,
    targetMarkName: null,
    targetMarkSeq: null,
    isUnsmoothed: false,
    hasCourse: true,
    postFinish: false,
    ...partial,
  };
}

describe('OwnBoatPerformance — VMC card', () => {
  it('renders the VMC card with a target-mark label when a course is loaded', () => {
    render(
      <OwnBoatPerformance
        series={emptyPerfSeries}
        nowMs={Date.parse('2026-10-31T12:00:00Z')}
        windMissing={false}
        polarMissing
        vmcSnapshot={snap({
          instantaneous: 4.2,
          smoothed10min: 4.2,
          targetMarkName: 'Weather',
          targetMarkSeq: 1,
        })}
        vmcWindow={[]}
      />,
    );
    expect(screen.getByTestId('vmc-card')).toBeInTheDocument();
    expect(screen.getByText('VMC to Weather')).toBeInTheDocument();
    expect(screen.getByText('4.2 kt')).toBeInTheDocument();
  });

  it('renders a placeholder when no course is loaded', () => {
    render(
      <OwnBoatPerformance
        series={emptyPerfSeries}
        nowMs={Date.parse('2026-10-31T12:00:00Z')}
        windMissing={false}
        polarMissing
        vmcSnapshot={snap({ hasCourse: false })}
        vmcWindow={[]}
      />,
    );
    expect(screen.queryByTestId('vmc-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('vmc-no-course')).toBeInTheDocument();
  });

  it('renders "—" when own-boat has sailed past the finish', () => {
    render(
      <OwnBoatPerformance
        series={emptyPerfSeries}
        nowMs={Date.parse('2026-10-31T12:00:00Z')}
        windMissing={false}
        polarMissing
        vmcSnapshot={snap({
          postFinish: true,
          targetMarkName: null,
          smoothed10min: null,
        })}
        vmcWindow={[]}
      />,
    );
    expect(screen.getByText('VMC — finished')).toBeInTheDocument();
    expect(screen.getByTestId('vmc-card')).toHaveTextContent('—');
  });

  it('shows an "unsmoothed" tag when the window has <2 samples but a raw value exists', () => {
    render(
      <OwnBoatPerformance
        series={emptyPerfSeries}
        nowMs={Date.parse('2026-10-31T12:00:00Z')}
        windMissing={false}
        polarMissing
        vmcSnapshot={snap({
          instantaneous: 3.1,
          smoothed10min: 3.1,
          targetMarkName: 'M1',
          targetMarkSeq: 0,
          isUnsmoothed: true,
        })}
        vmcWindow={[]}
      />,
    );
    expect(screen.getByText('unsmoothed')).toBeInTheDocument();
  });

  it('clamps near-zero values to "— kt"', () => {
    render(
      <OwnBoatPerformance
        series={emptyPerfSeries}
        nowMs={Date.parse('2026-10-31T12:00:00Z')}
        windMissing={false}
        polarMissing
        vmcSnapshot={snap({
          instantaneous: 0.04,
          smoothed10min: 0.04,
          targetMarkName: 'M1',
          targetMarkSeq: 0,
        })}
        vmcWindow={
          [
            { timestampMs: Date.parse('2026-10-31T11:59:00Z'), vmc: 0.03, targetMarkSeq: 0, targetMarkName: 'M1' },
            { timestampMs: Date.parse('2026-10-31T12:00:00Z'), vmc: 0.04, targetMarkSeq: 0, targetMarkName: 'M1' },
          ] satisfies VMCEntry[]
        }
      />,
    );
    expect(screen.getByText('— kt')).toBeInTheDocument();
  });

  it('tints the VMC number red when the smoothed value is negative beyond the noise floor', () => {
    render(
      <OwnBoatPerformance
        series={emptyPerfSeries}
        nowMs={Date.parse('2026-10-31T12:00:00Z')}
        windMissing={false}
        polarMissing
        vmcSnapshot={snap({
          instantaneous: -1.4,
          smoothed10min: -1.4,
          targetMarkName: 'M1',
          targetMarkSeq: 0,
        })}
        vmcWindow={[]}
      />,
    );
    const value = screen.getByText('-1.4 kt');
    expect(value.className).toMatch(/text-rose-300/);
  });

  it('keeps the windMissing early-return behaviour for VMG/polar even though VMC is wind-free', () => {
    render(
      <OwnBoatPerformance
        series={emptyPerfSeries}
        nowMs={Date.parse('2026-10-31T12:00:00Z')}
        windMissing
        polarMissing
        vmcSnapshot={snap({ hasCourse: true })}
        vmcWindow={[]}
      />,
    );
    expect(screen.getByText('No wind data in this race file.')).toBeInTheDocument();
    // Per PRD §4 "No regressions" the existing windMissing message stays. VMC
    // without wind is a future refinement if Marcus wants it later.
    expect(screen.queryByTestId('vmc-card')).not.toBeInTheDocument();
  });
});
