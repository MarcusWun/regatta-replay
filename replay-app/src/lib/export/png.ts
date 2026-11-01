// Phase 2c — PNG snapshot of the current MapLibre canvas.
//
// MapLibre + deck.gl (interleaved via MapboxOverlay) share one canvas, so a
// single getCanvas().toBlob() captures the full frame — basemap + marks +
// trails + boats + labels.
//
// IMPORTANT: the map must be constructed with { preserveDrawingBuffer: true }
// (see MapView.tsx). Without it, WebGL implementations are free to discard
// the back buffer between frames and toBlob() returns a blank PNG.
import type * as maplibregl from 'maplibre-gl';

/**
 * Trigger a repaint and read the current canvas as a PNG Blob.
 * Returns null when the browser rejects the capture (e.g. tainted canvas).
 */
export async function captureMapPng(
  map: maplibregl.Map,
): Promise<Blob | null> {
  // Force a synchronous redraw so toBlob reads the latest frame, not the
  // previous animation tick. `redraw()` is MapLibre's public idle-render.
  // Fall through quietly if the method isn't present (test shim / old API).
  try {
    (map as unknown as { redraw?: () => void }).redraw?.();
  } catch {
    /* best-effort */
  }
  const canvas = map.getCanvas();
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
