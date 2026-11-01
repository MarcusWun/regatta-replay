// Persistent Replay app settings via tauri-plugin-store.
//
// Store lives at `~/.local/share/<bundleId>/replay-settings.dat` on Linux
// and the OS-equivalent on macOS/Windows (tauri-plugin-store handles the
// per-platform path resolution). We lazily open it the first time any
// getter/setter is called so a Vitest + jsdom run that never touches
// settings doesn't need to stub out the plugin.
import { load, type Store } from '@tauri-apps/plugin-store';

const STORE_FILENAME = 'replay-settings.dat';

export interface ReplaySettings {
  polarFilePath: string | null;
}

const DEFAULTS: ReplaySettings = {
  polarFilePath: null,
};

const KEYS: Record<keyof ReplaySettings, string> = {
  polarFilePath: 'polar_file_path',
};

let _storePromise: Promise<Store> | null = null;

function openStore(): Promise<Store> {
  if (!_storePromise) {
    _storePromise = load(STORE_FILENAME, { autoSave: true });
  }
  return _storePromise;
}

export async function readSettings(): Promise<ReplaySettings> {
  try {
    const store = await openStore();
    const polarFilePath = (await store.get<string>(KEYS.polarFilePath)) ?? DEFAULTS.polarFilePath;
    return { polarFilePath };
  } catch (err) {
    // Store unavailable (test runs, first-boot before migration, etc.) —
    // return defaults rather than propagating. Callers see no polar
    // configured, which the UI already handles.
    console.warn('[settings] failed to read, using defaults:', err);
    return { ...DEFAULTS };
  }
}

export async function setPolarFilePath(value: string | null): Promise<void> {
  const store = await openStore();
  if (value == null) {
    await store.delete(KEYS.polarFilePath);
  } else {
    await store.set(KEYS.polarFilePath, value);
  }
  await store.save();
}
