// Lightweight state-machine test for useRaceData. We stub @tauri-apps/plugin-sql
// via vi.mock so the hook doesn't actually try to open a sqlite file.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@tauri-apps/plugin-sql', () => {
  class FakeDb {
    static async load(_url: string) {
      return new FakeDb();
    }
    async select<T>(sql: string): Promise<T> {
      if (sql.startsWith('SELECT key, value')) return [] as unknown as T;
      if (sql.includes('FROM vessels')) {
        return [
          {
            mmsi: '111',
            ais_name: 'A',
            display_name: null,
            sail_number: null,
            class: null,
            call_sign: null,
            vessel_type: null,
            excluded: 0,
            added_post_race: 0,
          },
        ] as unknown as T;
      }
      if (sql.includes('FROM positions')) return [] as unknown as T;
      if (sql.includes('FROM race_marks')) return [] as unknown as T;
      if (sql.includes('sqlite_master')) return [] as unknown as T;
      if (sql.includes('FROM wind')) return [] as unknown as T;
      return [] as unknown as T;
    }
    async close() {}
  }
  return { default: FakeDb };
});

import { useRaceData } from '../hooks/useRaceData';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useRaceData', () => {
  it('transitions empty → loading → needs-gpx when race_marks is empty', async () => {
    const { result } = renderHook(() => useRaceData());
    expect(result.current.state.kind).toBe('empty');
    await act(async () => {
      await result.current.loadRaceDb('/fake/race.db');
    });
    await waitFor(() => expect(result.current.state.kind).toBe('needs-gpx'));
  });

  it('transitions to ready after a GPX pick in needs-gpx state', async () => {
    const { result } = renderHook(() => useRaceData());
    await act(async () => {
      await result.current.loadRaceDb('/fake/race.db');
    });
    await waitFor(() => expect(result.current.state.kind).toBe('needs-gpx'));
    act(() => {
      result.current.loadGpxText('<wpt lat="41.5" lon="-70.6"><name>S</name></wpt><wpt lat="41.6" lon="-70.5"><name>W</name></wpt>');
    });
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));
    if (result.current.state.kind !== 'ready') return;
    expect(result.current.state.marksFromGpx).toBe(true);
    expect(result.current.state.race.marks).toHaveLength(2);
  });

  it('reset() returns to empty state', async () => {
    const { result } = renderHook(() => useRaceData());
    await act(async () => {
      await result.current.loadRaceDb('/fake/race.db');
    });
    act(() => result.current.reset());
    expect(result.current.state.kind).toBe('empty');
  });
});
