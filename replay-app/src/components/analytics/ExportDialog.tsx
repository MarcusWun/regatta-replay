// Phase 2c — Export dialog.
//
// Portaled modal with format checkboxes (PNG / CSV / GPX), a boat-scope
// dropdown (All / Visible / Own-boat), and a Save to… button that opens a
// Tauri directory picker. On save, runBatchExport writes everything into the
// chosen directory in one batch and the dialog closes with a toast line.
//
// Keyboard model mirrors Aeolus Phase 1.3's AddToFleetModal:
//   - backdrop click → cancel
//   - card captures bubble + Esc → cancel, Enter → save (when valid)
//
// The last-used directory is remembered in `localStorage` so repeat exports
// in the same session default to it; the key is session-scoped (cleared on
// every app restart) per PRD §2.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type * as maplibregl from 'maplibre-gl';
import type { VesselRow } from '../../lib/types';
import type { BatchExportBoat, ExportFormat } from '../../lib/export/batch';
import { runBatchExport } from '../../lib/export/batch';

export type BoatScope = 'all' | 'visible' | 'own';

const LAST_DIR_KEY = 'replay:export-last-dir';

export interface ExportDialogProps {
  vessels: VesselRow[];
  hidden: Set<string>;
  ownMmsi: string | null;
  raceName: string | null;
  startMs: number;
  elapsedMs: number;
  mapRef: { current: maplibregl.Map | null };
  /**
   * Return the position array for a vessel in the current replay window.
   * Called at save time so we only build the batch for selected boats.
   */
  getPositions: (mmsi: string) => BatchExportBoat;
  onClose: () => void;
  onToast?: (message: string) => void;
}

function readLastDir(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage?.getItem(LAST_DIR_KEY) ?? null;
  } catch {
    return null;
  }
}

function saveLastDir(dir: string): void {
  try {
    window.sessionStorage?.setItem(LAST_DIR_KEY, dir);
  } catch {
    /* storage unavailable — accept it */
  }
}

export function ExportDialog({
  vessels,
  hidden,
  ownMmsi,
  raceName,
  startMs,
  elapsedMs,
  mapRef,
  getPositions,
  onClose,
  onToast,
}: ExportDialogProps) {
  const [png, setPng] = useState(true);
  const [csv, setCsv] = useState(true);
  const [gpx, setGpx] = useState(true);
  const [scope, setScope] = useState<BoatScope>(() => {
    // PRD §2 — default scope is visible boats. If no boats visible (edge
    // case), fall through to all boats so the user isn't stuck with an empty
    // scope on the very first open.
    const anyVisible = vessels.some((v) => !hidden.has(v.mmsi));
    return anyVisible ? 'visible' : 'all';
  });
  const [directory, setDirectory] = useState<string | null>(readLastDir());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Focus the dialog on mount so Esc/Enter capture start working immediately.
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const selectedBoats = useMemo<VesselRow[]>(() => {
    if (scope === 'own') {
      return ownMmsi ? vessels.filter((v) => v.mmsi === ownMmsi) : [];
    }
    if (scope === 'visible') {
      return vessels.filter((v) => !hidden.has(v.mmsi));
    }
    return vessels;
  }, [vessels, hidden, ownMmsi, scope]);

  const formats = useMemo<Set<ExportFormat>>(() => {
    const set = new Set<ExportFormat>();
    if (png) set.add('png');
    if (csv) set.add('csv');
    if (gpx) set.add('gpx');
    return set;
  }, [png, csv, gpx]);

  const hasFormat = formats.size > 0;
  const hasBoatsForTracks = selectedBoats.length > 0;
  // PNG only needs the map, not any boats. CSV/GPX need boats.
  const needsBoats = formats.has('csv') || formats.has('gpx');
  const canSave =
    !busy && directory != null && hasFormat && (!needsBoats || hasBoatsForTracks);

  const pickDirectory = async (): Promise<void> => {
    setError(null);
    try {
      const chosen = await openDialog({ directory: true, multiple: false });
      const picked = Array.isArray(chosen) ? (chosen[0] ?? null) : chosen;
      if (!picked) return;
      setDirectory(picked);
      saveLastDir(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!canSave || !directory) return;
    setBusy(true);
    setError(null);
    try {
      const batchBoats: BatchExportBoat[] = selectedBoats.map((v) => getPositions(v.mmsi));
      const result = await runBatchExport({
        directory,
        formats,
        raceName,
        startMs,
        elapsedMs,
        boats: batchBoats,
        map: mapRef.current,
      });
      const count = result.writtenPaths.length;
      const parts: string[] = [`${count} file${count === 1 ? '' : 's'} saved to ${directory}`];
      if (result.skippedBoatsNoPositions > 0) {
        parts.push(`${result.skippedBoatsNoPositions} boat(s) skipped (no positions)`);
      }
      if (result.pngSkippedReason) {
        parts.push(`PNG skipped: ${result.pngSkippedReason}`);
      }
      onToast?.(parts.join(' · '));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!busy) onClose();
      return;
    }
    if (e.key === 'Enter' && canSave) {
      e.preventDefault();
      void handleSave();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          handleKey(e);
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Export race data"
        data-testid="export-dialog"
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Export…</h2>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded bg-slate-800 px-2 py-1 text-sm hover:bg-slate-700 disabled:opacity-60"
          >
            ×
          </button>
        </header>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Formats
            </span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={png}
                onChange={(e) => setPng(e.target.checked)}
                data-testid="export-format-png"
              />
              PNG snapshot (current map frame)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={csv}
                onChange={(e) => setCsv(e.target.checked)}
                data-testid="export-format-csv"
              />
              CSV per boat
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={gpx}
                onChange={(e) => setGpx(e.target.checked)}
                data-testid="export-format-gpx"
              />
              GPX per boat
            </label>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="export-scope"
              className="text-xs font-semibold uppercase tracking-wider text-slate-400"
            >
              Boat scope
            </label>
            <select
              id="export-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as BoatScope)}
              data-testid="export-scope"
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            >
              <option value="all">All boats ({vessels.length})</option>
              <option value="visible">
                Visible boats only ({vessels.filter((v) => !hidden.has(v.mmsi)).length})
              </option>
              <option value="own" disabled={!ownMmsi}>
                Own-boat only{ownMmsi ? '' : ' (no own-boat in race)'}
              </option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Save to
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={pickDirectory}
                disabled={busy}
                data-testid="export-pick-dir"
                className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-60"
              >
                {directory ? 'Change…' : 'Save to…'}
              </button>
              <span
                className="truncate text-xs text-slate-400"
                title={directory ?? ''}
                data-testid="export-selected-dir"
              >
                {directory ?? 'No folder chosen'}
              </span>
            </div>
          </div>

          {error && (
            <div className="rounded border border-rose-800 bg-rose-950/60 p-2 text-xs text-rose-200">
              {error}
            </div>
          )}
        </section>

        <footer className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded bg-slate-700 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-600 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            data-testid="export-save"
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
