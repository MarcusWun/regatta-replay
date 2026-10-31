# Regatta Replay App — Platform & Stack Decision

**Date:** 2026-10-29
**Status:** FINAL

---

## Context

Marcus races sailboats competitively. Post-race, he wants to replay competitor AIS tracks overlaid with his own boat's track on a nautical chart, with time-series plots (SOG, VMG, position delta). Data source: SQLite file collected by the Aeolus AIS Logger module.

**Hardware:**
- **Home:** Geekom A9 mini-PC, 128 GB RAM, Ubuntu Linux — primary use platform post-race
- **Boat:** Windows PC running Expedition + Aeolus (Electron/React/TypeScript/SQLite/canboatjs/Vite/Tailwind)

---

## 1. Platform Choice

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Windows-only | Runs on boat PC; same machine as Expedition | Useless at home on Geekom A9 | No |
| Ubuntu-only | Primary home platform | Can't run on boat PC | No |
| Electron (like Aeolus) | Same stack Marcus knows; same deps | Ships Chromium; 200+ MB install; heavier RAM | Acceptable |
| **Tauri v2** | **96% smaller bundle; 75% less RAM; same React/TS front-end; cross-platform** | **Rust backend (new skill); slightly harder native APIs** | **Recommended** |
| Web app (local-first) | Browser anywhere | File system access clunky; no offline SQLite without WASM | Acceptable alternative |

**Recommendation: Tauri v2** for a standalone desktop app. Front-end is identical to Aeolus (React + TypeScript + Vite + Tailwind — Marcus's existing stack). The Rust backend is minimal: file picker + SQLite reads. Tauri's `tauri-plugin-sql` wraps SQLite natively. Bundle is <15 MB vs Electron's 200+ MB.

**Cross-platform:** Tauri v2 compiles to Windows (MSI/NSIS) and Linux (deb/AppImage) from a single codebase. Marcus gets both targets.

**Why not just extend Aeolus?** Aeolus is a live nav tool with an active N2K bus connection. The replay app has no N2K dependency and different UX concerns. Keeping them separate avoids coupling a post-race analysis tool to an instrument app that runs on the boat.

---

## 2. Chart Rendering

The replay needs to animate 10–30 boats over 6–20 hours. At 30s update intervals with linear interpolation at 1s for smooth animation, that's ~72,000 position points per boat × 20 boats = 1.44M total points. Must render smoothly at 60fps.

| Library | Best for | Performance | Notes |
|---|---|---|---|
| Leaflet + OpenSeaMap | Simple chart display | OK for static; poor for animation at scale | Too slow for animated 20-boat tracks |
| **MapLibre GL JS** | **Vector tile base map** | **Excellent — WebGL-accelerated** | **Open-source Mapbox fork; nautical tiles via OpenSeaMap** |
| deck.gl TripsLayer | Animated multi-track replay | Excellent (WebGL, 10M+ points) | Designed exactly for this use case |
| MapLibre + deck.gl overlay | Best of both worlds | Excellent | Standard integration pattern; well-documented |
| kepler.gl | Data analysis + trip animation | Good | Built on deck.gl; overkill UI for this use case |

**Recommendation: MapLibre GL JS base map + deck.gl TripsLayer overlay.**

- MapLibre provides the nautical chart (OpenSeaMap raster tiles as base layer; free, no API key)
- deck.gl TripsLayer renders animated boat trails with timestamps at WebGL speed
- Standard `@deck.gl/maplibre` integration is documented and actively maintained
- GeoLibre (Tauri + React + MapLibre + deck.gl) is an existing reference project confirming this stack works in Tauri

**Marine chart tiles:**
- OpenSeaMap: `https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png` (overlay)
- OpenStreetMap or Stamen Toner as base: free, no key required
- NOAA RNC (raster nautical charts) via TileMill or static tiles: viable for US waters

---

## 3. Time-Series Playback UX

**Core controls:**
- Timeline scrubber (race start → race end)
- Play / Pause / Restart
- Speed multiplier (1x, 5x, 10x, 30x, 60x)
- Click on boat icon → boat details panel (SOG, COG, name, time to leader)

**Reference UX:** YB Races replay and TracTrac both use a simple bottom-bar scrubber with speed control. That's the correct pattern — don't over-engineer it.

**Implementation:** React state + requestAnimationFrame loop. At each frame, advance `currentTime` by `dt × speedMultiplier`. Query interpolated position for each boat at `currentTime` using a binary search over the position array. Update deck.gl layer data. This is standard and well-documented in deck.gl TripsLayer examples.

---

## 4. Analytics Compute

**What to show:**
- SOG over time (line chart, per boat or overlaid)
- Distance to leader / time behind leader (calculated from positions)
- Track deviation from rhumb line (for offshore legs)
- Mark rounding times (if marks are defined)
- VMG (if wind data is loaded alongside — optional Phase 2)

**Where to compute:** Browser-side using **DuckDB-WASM**. DuckDB runs in the browser as a WASM module and can query SQLite/Parquet with SQL. For the analytics panel, run SQL against the loaded race SQLite file directly. This avoids a server-side compute step.

**Charting:** Observable Plot or Recharts for time-series line charts. Observable Plot is lighter and more composable; Recharts is more familiar for React devs. Either works.

---

## 5. Storage Format

**Race file:** SQLite (`.db`). Already decided in AIS collection research.

**In-app state:** Loaded into memory as typed TypeScript arrays at app startup (full race = 1.44M points × ~40 bytes each ≈ 58 MB; trivially fits in RAM). No streaming needed.

**Why not Parquet or GeoJSON?**
- Parquet: better for analytics pipelines, overkill for a file-per-race personal tool
- GeoJSON: large; no SQL query support; not portable for analytics
- SQLite: portable, queryable, already in use in Aeolus, Tauri has native plugin support

---

## 6. Ubuntu vs Windows Tradeoffs

Tauri v2 removes this concern — the same codebase produces both targets. The primary usage scenario is at home on Ubuntu (post-race debrief), with occasional use on the boat Windows PC. Both are first-class Tauri targets.

---

## 7. Stack Recommendation

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Tauri v2 | Cross-platform, 75% less RAM than Electron, same React TS front-end |
| UI | React 19 + TypeScript + Vite + Tailwind | Same as Aeolus; no new stack to learn |
| Chart/map | MapLibre GL JS + deck.gl TripsLayer | WebGL performance, open-source, nautical tiles |
| Map tiles | OpenSeaMap overlay + OpenStreetMap base | Free, no API key |
| Analytics queries | DuckDB-WASM | SQL over SQLite in-browser, zero backend |
| Time-series charts | Observable Plot | Lightweight, composable, MIT |
| Storage | SQLite (tauri-plugin-sql) | Single file per race, portable |
| Data ingest | Aeolus AIS Logger module | canboatjs PGN 129038/129039, SQLite write |

**One-paragraph justification:** Marcus already writes React + TypeScript + Tailwind in Aeolus. Tauri v2 lets him reuse that entirely while getting a lighter, faster, cross-platform binary. The hard part of this app is the map/replay layer — MapLibre + deck.gl is the production-grade open-source stack that handles the rendering problem (30 animated boat tracks at WebGL speed), and it integrates cleanly into Tauri's WebView. DuckDB-WASM means analytics SQL runs in the browser against the race SQLite file with no server. The result is a self-contained double-click app with no cloud dependency.
