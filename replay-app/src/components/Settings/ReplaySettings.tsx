// Modal settings surface for the Replay app.
//
// Currently exposes one field — the Expedition .pol polar file path —
// persisted via `src/lib/settings.ts` (tauri-plugin-store under the hood).
// On selection we parse the file through our `pol-parser` facade and
// render a short summary so the user can confirm the right file.
import { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { parsePolar, type ParsedPolar } from '../../lib/polar-engine/pol-parser';
import { setPolarFilePath } from '../../lib/settings';

export interface ReplaySettingsProps {
  polarFilePath: string | null;
  parsedPolar: ParsedPolar | null;
  onPolarChange: (path: string | null, parsed: ParsedPolar | null) => void;
  onClose: () => void;
}

export function ReplaySettings({
  polarFilePath,
  parsedPolar,
  onPolarChange,
  onClose,
}: ReplaySettingsProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickFile = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const chosen = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          { name: 'Polar', extensions: ['pol', 'txt', 'csv'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      const picked =
        Array.isArray(chosen) ? (chosen[0] ?? null) : (chosen ?? null);
      if (!picked) return;

      const content = await readTextFile(picked);
      const parsed = parsePolar(content);
      if (!parsed) {
        setError(
          'Could not parse the selected file. Expected an Expedition .pol / .txt or CSV polar.',
        );
        return;
      }
      await setPolarFilePath(picked);
      onPolarChange(picked, parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    setError(null);
    await setPolarFilePath(null);
    onPolarChange(null, null);
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Replay settings</h2>
          <button
            onClick={onClose}
            className="rounded bg-slate-800 px-2 py-1 text-sm hover:bg-slate-700"
          >
            Close
          </button>
        </header>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Polar file
          </h3>
          <div className="rounded bg-slate-950/60 p-3 text-sm">
            {polarFilePath ? (
              <>
                <div className="truncate text-slate-200" title={polarFilePath}>
                  {polarFilePath}
                </div>
                {parsedPolar ? (
                  <div className="mt-1 text-xs text-slate-400">
                    Format: {parsedPolar.format} · TWS {parsedPolar.twsRange[0]}–
                    {parsedPolar.twsRange[1]} kt · TWA {parsedPolar.twaRange[0]}°–
                    {parsedPolar.twaRange[1]}°
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-amber-300">
                    Parsed polar not yet loaded.
                  </div>
                )}
              </>
            ) : (
              <div className="text-slate-400">No polar file configured.</div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={pickFile}
              disabled={busy}
              className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-60"
            >
              {busy ? 'Reading…' : 'Pick polar file…'}
            </button>
            {polarFilePath && (
              <button
                onClick={clear}
                disabled={busy}
                className="rounded bg-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
              >
                Clear
              </button>
            )}
          </div>

          {error && (
            <div className="rounded border border-rose-800 bg-rose-950/60 p-2 text-xs text-rose-200">
              {error}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
