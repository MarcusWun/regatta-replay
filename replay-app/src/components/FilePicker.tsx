// Race.db + GPX file picker, driven by @tauri-apps/plugin-dialog.
// This component is dumb — the parent owns the state machine (useRaceData).
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';

export interface FilePickerProps {
  state:
    | { kind: 'empty' }
    | { kind: 'loading' }
    | { kind: 'needs-gpx' }
    | { kind: 'ready' }
    | { kind: 'error'; error: string };
  onPickRaceDb: (path: string) => void;
  onPickGpx: (text: string) => void;
  onReset: () => void;
}

async function pickRaceDbPath(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Race database', extensions: ['db'] }],
  });
  return typeof picked === 'string' ? picked : null;
}

async function pickGpxText(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'GPX course', extensions: ['gpx', 'xml'] }],
  });
  if (typeof picked !== 'string') return null;
  return readTextFile(picked);
}

export function FilePicker({ state, onPickRaceDb, onPickGpx, onReset }: FilePickerProps) {
  if (state.kind === 'loading') {
    return (
      <div className="p-6 text-center text-slate-300">Loading race data…</div>
    );
  }

  if (state.kind === 'needs-gpx') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-slate-200">
          This race file has no course marks saved. Pick the GPX file used for the race to continue.
        </p>
        <button
          data-testid="pick-gpx-btn"
          className="rounded bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500"
          onClick={async () => {
            const text = await pickGpxText();
            if (text) onPickGpx(text);
          }}
        >
          Load GPX…
        </button>
        <button
          className="text-sm text-slate-400 underline hover:text-slate-200"
          onClick={onReset}
        >
          Cancel
        </button>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-red-400">{state.error}</p>
        <button
          className="rounded bg-slate-700 px-4 py-2 font-medium text-white hover:bg-slate-600"
          onClick={onReset}
        >
          Try again
        </button>
      </div>
    );
  }

  // kind === 'empty' or 'ready' — in ready mode the parent won't render this,
  // but we still render the picker so the user can swap files.
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold text-slate-100">Regatta Replay</h1>
      <p className="text-slate-400">Load a race.db file produced by Aeolus to begin.</p>
      <button
        data-testid="pick-racedb-btn"
        className="rounded bg-sky-600 px-5 py-3 font-medium text-white hover:bg-sky-500"
        onClick={async () => {
          const path = await pickRaceDbPath();
          if (path) onPickRaceDb(path);
        }}
      >
        Load race file…
      </button>
    </div>
  );
}
