// Top-level app shell: file picker on empty, map + timeline + analytics
// panel on ready.
import { useEffect, useMemo, useState } from 'react';
import { FilePicker } from './components/FilePicker';
import { MapView } from './components/MapView';
import { Timeline } from './components/Timeline';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { BoatSelector } from './components/analytics/BoatSelector';
import { MarkRoundingTableCard } from './components/analytics/MarkRoundingTable';
import { DistanceToLeaderBar } from './components/analytics/DistanceToLeaderBar';
import { SOGChart } from './components/analytics/SOGChart';
import { FleetVMCChart } from './components/analytics/FleetVMCChart';
import { OwnBoatPerformance } from './components/analytics/OwnBoatPerformance';
import { ReplaySettings } from './components/Settings/ReplaySettings';
import { useRaceData } from './hooks/useRaceData';
import { defaultSpeedForDuration, useReplayClock } from './hooks/useReplayClock';
import { useStartDetection } from './hooks/useStartDetection';
import { useMarkRoundings } from './hooks/useMarkRoundings';
import { useDistanceToLeader } from './hooks/useDistanceToLeader';
import { usePolarPerformance } from './hooks/usePolarPerformance';
import { useVMC } from './hooks/useVMC';
import { useFleetVMC } from './hooks/useFleetVMC';
import { readSettings } from './lib/settings';
import { parsePolar, type ParsedPolar } from './lib/polar-engine/pol-parser';
import { readTextFile } from '@tauri-apps/plugin-fs';
import type { PositionRow } from './lib/types';
import './App.css';

const PANEL_STORAGE_KEY = 'replay:analytics-panel-open';

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

function readPanelOpen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage?.getItem(PANEL_STORAGE_KEY);
    if (raw == null) return false; // PRD §2.1 — default collapsed
    return raw === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const data = useRaceData();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [trailSeconds, setTrailSeconds] = useState<number | null>(15 * 60);
  const [panelOpen, setPanelOpen] = useState<boolean>(readPanelOpen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [polarPath, setPolarPath] = useState<string | null>(null);
  const [parsedPolar, setParsedPolar] = useState<ParsedPolar | null>(null);

  useEffect(() => {
    try {
      window.localStorage?.setItem(PANEL_STORAGE_KEY, panelOpen ? '1' : '0');
    } catch {
      /* storage unavailable — accept it */
    }
  }, [panelOpen]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await readSettings();
        if (cancelled || !settings.polarFilePath) return;
        setPolarPath(settings.polarFilePath);
        try {
          const content = await readTextFile(settings.polarFilePath);
          const parsed = parsePolar(content);
          if (!cancelled) setParsedPolar(parsed);
        } catch (err) {
          console.warn('[App] failed to read saved polar file:', err);
        }
      } catch (err) {
        console.warn('[App] failed to load settings:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <ReadyApp
      key={data.state.dbPath}
      data={data}
      hidden={hidden}
      setHidden={setHidden}
      trailSeconds={trailSeconds}
      setTrailSeconds={setTrailSeconds}
      panelOpen={panelOpen}
      setPanelOpen={setPanelOpen}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      polarPath={polarPath}
      parsedPolar={parsedPolar}
      onPolarChange={(path, parsed) => {
        setPolarPath(path);
        setParsedPolar(parsed);
      }}
    />
  );
}

interface ReadyAppProps {
  data: ReturnType<typeof useRaceData>;
  hidden: Set<string>;
  setHidden: React.Dispatch<React.SetStateAction<Set<string>>>;
  trailSeconds: number | null;
  setTrailSeconds: React.Dispatch<React.SetStateAction<number | null>>;
  panelOpen: boolean;
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  settingsOpen: boolean;
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  polarPath: string | null;
  parsedPolar: ParsedPolar | null;
  onPolarChange: (path: string | null, parsed: ParsedPolar | null) => void;
}

function ReadyApp({
  data,
  hidden,
  setHidden,
  trailSeconds,
  setTrailSeconds,
  panelOpen,
  setPanelOpen,
  settingsOpen,
  setSettingsOpen,
  polarPath,
  parsedPolar,
  onPolarChange,
}: ReadyAppProps) {
  if (data.state.kind !== 'ready') return null;
  const { race } = data.state;

  const positionsByMmsi = useMemo(() => groupByMmsi(race.positions), [race.positions]);
  const detection = useStartDetection(race.marks, race.positions);
  const roundings = useMarkRoundings(race.marks, race.positions);

  const startMs = detection.t0
    ? Date.parse(detection.t0)
    : detection.tFirst
      ? Date.parse(detection.tFirst)
      : 0;
  const endMs = detection.tLast ? Date.parse(detection.tLast) : startMs + 1;
  const defaultSpeed = defaultSpeedForDuration(endMs - startMs);
  const clock = useReplayClock({ startMs, endMs, initialSpeed: defaultSpeed });

  const ownMmsi = race.meta['own_mmsi'] ?? null;
  const ownTrack = useMemo(
    () => (ownMmsi ? (positionsByMmsi.get(ownMmsi) ?? []) : []),
    [positionsByMmsi, ownMmsi],
  );

  const distance = useDistanceToLeader(race.marks, positionsByMmsi, roundings, clock.nowMs);
  const performanceSeries = usePolarPerformance(
    ownTrack,
    race.wind,
    parsedPolar?.table ?? null,
  );
  const vmc = useVMC(ownTrack, race.marks, roundings, ownMmsi, clock.nowMs);
  const fleetVmc = useFleetVMC(positionsByMmsi, race.marks, roundings);

  const toggleHidden = (mmsi: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(mmsi)) next.delete(mmsi);
      else next.add(mmsi);
      return next;
    });
  };

  const windMissing = !race.hasWindTable;
  const polarMissing = !parsedPolar;
  const showPerformanceCard = ownMmsi != null;

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
          {race.hasWindTable && (
            <span className="ml-2 text-emerald-400" title="race.db has own-boat wind data">
              + wind ({race.wind.length})
            </span>
          )}
          {data.state.marksFromGpx && (
            <span className="ml-2 text-amber-400">(course via GPX)</span>
          )}
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
        <AnalyticsPanel
          open={panelOpen}
          onToggle={() => setPanelOpen((v) => !v)}
          onOpenSettings={() => setSettingsOpen(true)}
        >
          <BoatSelector
            vessels={race.vessels}
            ownMmsi={ownMmsi}
            hidden={hidden}
            onToggle={toggleHidden}
            trailSeconds={trailSeconds}
            onTrailChange={setTrailSeconds}
          />
          <MarkRoundingTableCard
            table={roundings}
            vessels={race.vessels}
            ownMmsi={ownMmsi}
            startMs={startMs}
            hidden={hidden}
          />
          <DistanceToLeaderBar
            snapshot={distance}
            vessels={race.vessels}
            ownMmsi={ownMmsi}
            hidden={hidden}
          />
          <SOGChart
            positionsByMmsi={positionsByMmsi}
            vessels={race.vessels}
            ownMmsi={ownMmsi}
            hidden={hidden}
            startMs={startMs}
            endMs={endMs}
            nowMs={clock.nowMs}
          />
          <FleetVMCChart
            fleetVmc={fleetVmc}
            vessels={race.vessels}
            ownMmsi={ownMmsi}
            hidden={hidden}
            startMs={startMs}
            endMs={endMs}
            nowMs={clock.nowMs}
          />
          {showPerformanceCard && (
            <OwnBoatPerformance
              series={performanceSeries}
              nowMs={clock.nowMs}
              windMissing={windMissing}
              polarMissing={polarMissing}
              vmcSnapshot={vmc.snapshot}
              vmcWindow={vmc.window}
            />
          )}
        </AnalyticsPanel>
      </main>

      <Timeline clock={clock} startMs={startMs} endMs={endMs} />

      {settingsOpen && (
        <ReplaySettings
          polarFilePath={polarPath}
          parsedPolar={parsedPolar}
          onPolarChange={onPolarChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
