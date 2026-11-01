// Browser-safe facade over the vendor-copied PolarEngine parsers.
//
// `PolarEngine` is byte-identical to Aeolus's version so parity holds on the
// `interpolateSpeed` free function. Its constructor, however, calls
// `os.homedir()` and `fs.mkdirSync()` which don't work in the Replay app's
// browser bundle (the Vite shims under `./shims/` turn those into throws).
//
// All three parsers — parsePolContent, parseCsvContent, parseExpeditionContent
// — are pure string processors on `this` that never read constructor state.
// We use `Object.create(PolarEngine.prototype)` to bind their `this` without
// triggering the constructor, giving us the same parse semantics as Aeolus
// without touching the engine's file-system plumbing.
import { PolarEngine, type PolarTable } from './polar-engine';

const facade = Object.create(PolarEngine.prototype) as PolarEngine;

export function parsePolContent(content: string): PolarTable | null {
  return facade.parsePolContent(content);
}

export function parseCsvContent(content: string): PolarTable | null {
  return facade.parseCsvContent(content);
}

export function parseExpeditionContent(content: string): PolarTable | null {
  return facade.parseExpeditionContent(content);
}

export type PolarFormat = 'pol' | 'csv' | 'expedition';

export interface ParsedPolar {
  format: PolarFormat;
  table: PolarTable;
  twsRange: [number, number];
  twaRange: [number, number];
}

/**
 * Try to parse arbitrary polar text, auto-detecting format by shape.
 *
 * Expedition format: data lines are TWS followed by [TWA BSP] pairs
 * (odd token count after dropping leading TWS). Legacy .pol: first line is
 * TWS values, subsequent lines are TWA + per-column speeds (even token count
 * on data lines). CSV: comma-separated.
 */
export function parsePolar(content: string): ParsedPolar | null {
  if (!content || content.trim().length === 0) return null;

  const looksLikeCsv = /[,]/.test(content.split(/\r?\n/).slice(0, 10).join('\n'));
  if (looksLikeCsv) {
    const table = parseCsvContent(content);
    if (table) return summarise('csv', table);
  }

  const firstDataLine = content
    .split(/\r?\n/)
    .find((l) => l.trim() && !l.trim().startsWith('!'));
  if (firstDataLine) {
    const tokens = firstDataLine.trim().split(/\s+/).map(Number);
    const hasSentinelZeros = tokens.length >= 3 && tokens[1] === 0 && tokens[2] === 0;
    if (hasSentinelZeros) {
      try {
        const table = parseExpeditionContent(content);
        if (table) return summarise('expedition', table);
      } catch {
        // Fall through — malformed Expedition → try .pol.
      }
    }
  }

  const polTable = parsePolContent(content);
  if (polTable) return summarise('pol', polTable);

  try {
    const expTable = parseExpeditionContent(content);
    if (expTable) return summarise('expedition', expTable);
  } catch {
    /* ignored */
  }

  return null;
}

function summarise(format: PolarFormat, table: PolarTable): ParsedPolar {
  return {
    format,
    table,
    twsRange: [table.tws[0], table.tws[table.tws.length - 1]],
    twaRange: [table.twa[0], table.twa[table.twa.length - 1]],
  };
}
