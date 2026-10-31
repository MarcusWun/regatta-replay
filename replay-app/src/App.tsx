// Top-level app shell: file picker on empty, map + timeline + legend on ready.
import { useMemo, useState } from 'react';
import { FilePicker } from './components/FilePicker';
import { MapView } from './components/MapView';
import { Timeline } from './components/Timeline';
import { Legend } from './components/Legend';
import { useRaceData } from './hooks/useRaceData';
import { defaultSpeedForDuration, useReplayClock } from './hooks/useReplayClock';
import { useStartDetection } from './hooks/useStartDetection';
import type { PositionRow } from './lib/types';
import './App.css';

function groupByMmsi(positions: PositionRow[]): Map<string, PositionRow[]> {
  const out = new Map<string, PositionRow[]>();
  for (const p of positions) {
    const arr = out.get(p.mmsi);
    if (arr) arr.push(p);
    else out.set(p.mmsi, [p]);
  }
  for (const arr of out.values()) {
    arr.sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));
  }
  return out;
}

export default function App() {
  const data = useRaceData();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [trailSeconds, setTrailSeconds] = useState<number | null>(15 * 60);

  if (data.state.kind !== 'ready') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-100">
        <FilePicker
          state={data.state}
          onPickRaceDb={data.loadRaceDb}
          onPickGpx={data.loadGpxText}
          onReset={data.reset}
        />
      </div>
    );
  }

  return <ReadyApp
    key={data.state.dbPath}
    data={data}
    hidden={hidden}
    setHidden={setHidden}
    trailSeconds={trailSeconds}
    setTrailSeconds={setTrailSeconds}
  />;
}

interface ReadyAppProps {
  data: ReturnType<typeof useRaceData>;
  hidden: Set<string>;
  setHidden: React.Dispatch<React.SetStateAction<Set<string>>>;
  trailSeconds: number | null;
  setTrailSeconds: React.Dispatch<React.SetStateAction<number | null>>;
}

function ReadyApp({ data, hidden, setHidden, trailSeconds, setTrailSeconds }: ReadyAppProps) {
  if (data.state.kind !== 'ready') return null;
  const { race } = data.state;

  const positionsByMmsi = useMemo(() => groupByMmsi(race.positions), [race.positions]);
  const detection = useStartDetection(race.marks, race.positions);

  const startMs = detection.t0 ? Date.parse(detection.t0) : (detection.tFirst ? Date.parse(detection.tFirst) : 0);
  const endMs = detection.tLast ? Date.parse(detection.tLast) : startMs + 1;
  const defaultSpeed = defaultSpeedForDuration(endMs - startMs);
  const clock = useReplayClock({ startMs, endMs, initialSpeed: defaultSpeed });

  const ownMmsi = race.meta['own_mmsi'] ?? null;

  const toggleHidden = (mmsi: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(mmsi)) next.delete(mmsi);
      else next.add(mmsi);
      return next;
    });
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2 text-sm">
        <strong className="text-sky-400">Regatta Replay</strong>
        <span className="text-slate-500">·</span>
        <span className="truncate text-slate-300" title={data.state.dbPath}>
          {data.state.dbPath.split(/[\\/]/).pop()}
        </span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-400">
          {race.vessels.length} vessels, {race.positions.length} fixes, {race.marks.length} marks
          {data.state.marksFromGpx && <span className="ml-2 text-amber-400">(course via GPX)</span>}
        </span>
        <span className="ml-auto text-xs text-slate-500">
          start: {detection.source}
        </span>
        <button
          className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
          onClick={data.reset}
        >
          Load another…
        </button>
      </header>

      <main className="flex min-h-0 flex-1">
        <div className="relative flex-1">
          <MapView
            vessels={race.vessels}
            positionsByMmsi={positionsByMmsi}
            marks={race.marks}
            ownMmsi={ownMmsi}
            startMs={startMs}
            nowMs={clock.nowMs}
            trailSeconds={trailSeconds}
            hidden={hidden}
          />
        </div>
        <Legend
          vessels={race.vessels}
          ownMmsi={ownMmsi}
          hidden={hidden}
          onToggle={toggleHidden}
          trailSeconds={trailSeconds}
          onTrailChange={setTrailSeconds}
        />
      </main>

      <Timeline clock={clock} startMs={startMs} endMs={endMs} />
    </div>
  );
}
