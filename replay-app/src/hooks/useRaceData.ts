// Load a race.db into memory, with GPX fallback when race_marks is empty.
// Exposes { state, loadRaceDb, loadGpx, reset } for the FilePicker flow.
import { useCallback, useMemo, useState } from 'react';
import { loadRaceDb as sqliteLoad } from '../lib/sqlite';
import type { LoadedRace } from '../lib/sqlite';
import { parseGpxString } from '../lib/gpx';
import type { RaceMarkRow } from '../lib/types';

export type RaceDataState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'needs-gpx'; race: LoadedRace; dbPath: string }
  | { kind: 'ready'; race: LoadedRace; dbPath: string; marksFromGpx: boolean }
  | { kind: 'error'; error: string };

export interface UseRaceData {
  state: RaceDataState;
  loadRaceDb: (path: string) => Promise<void>;
  loadGpxText: (gpxText: string) => void;
  reset: () => void;
}

export function useRaceData(): UseRaceData {
  const [state, setState] = useState<RaceDataState>({ kind: 'empty' });

  const loadRaceDb = useCallback(async (path: string): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const race = await sqliteLoad(path);
      if (race.marks.length > 0) {
        setState({ kind: 'ready', race, dbPath: path, marksFromGpx: false });
      } else {
        setState({ kind: 'needs-gpx', race, dbPath: path });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', error: `Failed to open race.db: ${msg}` });
    }
  }, []);

  const loadGpxText = useCallback((gpxText: string): void => {
    setState((prev) => {
      if (prev.kind !== 'needs-gpx') return prev;
      const parsed = parseGpxString(gpxText);
      if (!parsed.ok) {
        return { kind: 'error', error: `GPX parse failed: ${parsed.error}` };
      }
      const marks: RaceMarkRow[] = parsed.marks;
      return {
        kind: 'ready',
        race: { ...prev.race, marks },
        dbPath: prev.dbPath,
        marksFromGpx: true,
      };
    });
  }, []);

  const reset = useCallback(() => setState({ kind: 'empty' }), []);

  return useMemo(() => ({ state, loadRaceDb, loadGpxText, reset }), [state, loadRaceDb, loadGpxText, reset]);
}
