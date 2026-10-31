// Deterministic MMSI → palette assignment.
// Palette picked from colorbrewer "Set3" / Tableau 10 for max distinguishability
// at small icon sizes. 12 entries so a typical club fleet (≤12 boats) gets a
// unique colour; collisions beyond that are visually distinct enough.

export const BOAT_PALETTE: readonly [number, number, number][] = [
  [230, 25, 75],   // red
  [60, 180, 75],   // green
  [255, 225, 25],  // yellow
  [67, 99, 216],   // blue
  [245, 130, 49],  // orange
  [145, 30, 180],  // purple
  [66, 212, 244],  // cyan
  [240, 50, 230],  // magenta
  [191, 239, 69],  // lime
  [250, 190, 212], // pink
  [70, 153, 144],  // teal
  [220, 190, 255], // lavender
] as const;

export const OWN_BOAT_COLOR: readonly [number, number, number] = [255, 106, 0];

/** FNV-1a 32-bit hash — stable across platforms, no deps. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function colorForMmsi(mmsi: string): readonly [number, number, number] {
  const idx = hashString(mmsi) % BOAT_PALETTE.length;
  return BOAT_PALETTE[idx];
}

export function rgbToCss(c: readonly [number, number, number], alpha = 1): string {
  const [r, g, b] = c;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
