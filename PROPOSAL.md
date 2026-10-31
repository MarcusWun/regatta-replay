# Regatta Replay — PROPOSAL.md

**Project slug:** regatta-replay
**Written by:** Forge (Research Architect)
**Date:** 2026-10-29
**Status:** v1.5 — concurrent logging performance analysis added; proposal is final

## Revision History
- **v1.5 (2026-10-29):** Documented concurrent logging footprint — AIS competitor data volume is ~2 orders of magnitude smaller than Aeolus's existing performance logging; no CPU, I/O, or memory concern on the Geekom A9. Locked in three defaults: separate SQLite connections per DB, WAL journal mode, 5-second transaction batching.
- **v1.4 (2026-10-29):** Confirmed: all AIS vessels are on the N2K bus and visible to canboatjs via NGT-1 (OpenCPN already uses this path on same hardware); Aeolus and Expedition share one Windows PC — com0com virtual splitter required; OneDrive auto-sync is the file transfer path — race `.db` files are written directly to a OneDrive-synced folder so they appear on the home machine with no manual step.
- **v1.3 (2026-10-29):** Own-boat is captured from N2K GPS PGNs (129025/129029) at ~1 Hz — Aeolus's existing data stream — and written into the same `race.db` with a configured own-MMSI, flagged `source='n2k_gps_own'`. Dual-file `race.db` + `race.scan.db` storage is now confirmed (auto-write per race).
- **v1.2 (2026-10-29):** Split the "fleet" concept into a persistent `vessel_library` (grows over time via MarineTraffic lookups and Scan discoveries) and reusable `fleets` (per-race-series subsets promoted from the library). Added dual-file storage: a clean fleet-only `race.db` plus a sibling `race.scan.db` with unfiltered captures to enable post-race fleet editing. Updated workflow and open questions.
- **v1.1 (2026-10-29):** Added Fleet Manager (preload competitor MMSIs before race start). AIS recording filters to fleet-only. Added pre-race Scan mode as an assist for building the fleet from nearby boats.
- **v1.0 (2026-10-29):** Initial draft.

---

## 1. Executive Summary

Regatta Replay is a two-component system: (1) an AIS Logger module added to the existing Aeolus Electron app that silently records competitor AIS positions to a SQLite file during a race — filtered to a preloaded fleet of MMSIs so commercial and non-race traffic is ignored — and (2) a standalone cross-platform desktop replay app (Tauri v2 + React + MapLibre + deck.gl) that loads the race file and animates every boat's track on a nautical chart with basic speed analytics. It is built for Marcus's personal use — Sun Fast 3300, Northeast US offshore racing — and requires zero cooperation from competitors because it exploits AIS, which all boats are already required to transmit.

---

## 2. Problem & Opportunity

**The problem:** Post-race analysis for offshore sailors is either (a) own-boat only (Expedition, SailMon) or (b) requires every competitor to opt into the same platform (RaceQs, TackTracker). There is no tool that accepts self-collected competitor AIS and provides an offline multi-boat replay with performance analytics.

**Market research confirms the gap:** Every major sailing analytics platform was evaluated (see `research/competitor-tools.md`). None accepts a self-collected AIS file as input for multi-boat replay. Expedition is the closest existing tool Marcus uses, but its replay is own-boat only — competitor AIS targets are shown live but not stored.

**Competitors' weaknesses:**
- RaceQs / TackTracker: require app adoption; built for short windward-leeward courses, not 20h offshore races
- YB Tracking: organizer-deployed only; Marcus is a passive consumer
- SAP/TracTrac: enterprise broadcast tools, not available to individual sailors

**Opportunity:** Marcus has the hardware (B&G H5000/Zeus 3S with AIS reception, Actisense NGT-1, canboatjs expertise) to collect competitor AIS passively during any race. A modest amount of new software — an Aeolus logger module and a replay desktop app — closes the gap entirely.

---

## 3. Proposed Architecture

```
RACE DAY (on boat, Windows PC)
┌──────────────────────────────────────────────────────────┐
│  N2K Bus                                                  │
│  ┌───────────┐  PGN 129038/039/040/794                   │
│  │ AIS Rcvr  │──────────────────────────┐                │
│  │ (existing)│                          ↓                │
│  └───────────┘             ┌─────────────────────────┐   │
│                            │  Actisense NGT-1 (USB)  │   │
│                            └───────────┬─────────────┘   │
│                                        ↓                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Aeolus Electron App (existing)                     │  │
│  │  + Vessel Library (NEW)                             │  │
│  │    - Persistent CRUD of known boats                 │  │
│  │    - Manual entry from MarineTraffic lookups        │  │
│  │    - Scan mode promotes discovered MMSIs to library │  │
│  │  + Fleet Manager (NEW)                              │  │
│  │    - Build per-race fleets by promoting from library│  │
│  │    - Multiple fleets (e.g. Wed Night, Block Island) │  │
│  │  + AIS Logger Module (NEW)                          │  │
│  │    - canboatjs PGN subscribe                        │  │
│  │    - Own-boat from N2K GPS (PGN 129025/129029) 1Hz  │  │
│  │    - MMSI whitelist filter (fleet only) → race.db   │  │
│  │    - Unfiltered AIS mirror → race.scan.db (sibling) │  │
│  │    - UI: Select Fleet → Start / Stop / Export       │  │
│  └──────────────────────────┬──────────────────────────┘  │
│                             ↓                              │
│       YYYY-MM-DD_race.db  +  YYYY-MM-DD_race.scan.db      │
└──────────────────────────────────────────────────────────┘
                     (copy file to USB or sync)

POST-RACE (home, Ubuntu / boat Windows)
┌──────────────────────────────────────────────────────────┐
│  Regatta Replay App (Tauri v2 desktop)                    │
│                                                           │
│  File Picker → load race.db                              │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  MapLibre GL JS + deck.gl TripsLayer                │ │
│  │  Nautical chart (OpenSeaMap tiles)                  │ │
│  │  Animated boat icons (per MMSI)                     │ │
│  │  Interpolated tracks (30s → 1s smooth)              │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  Timeline scrubber + Play/Pause/Speed controls            │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Analytics Panel (DuckDB-WASM)                      │ │
│  │  - SOG over time (Observable Plot line chart)       │ │
│  │  - Distance to leader                               │ │
│  │  - Boat selector (show/hide individual tracks)      │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**Data flow:**
1. **Vessel Library** (ongoing): Marcus accumulates known boats over time by looking up MMSIs on MarineTraffic (manual entry) or by promoting discovered MMSIs from Scan mode. Each library entry has MMSI, display name, sail number, class, notes.
2. **Pre-race Fleet build:** For a specific race, Marcus opens Fleet Manager and promotes selected library entries into the active fleet. Fleets are reusable across races in a series.
3. **Race day:** two parallel capture streams:
   - *Competitors*: AIS signals → NGT-1 USB → canboatjs → split: (a) **fleet-filtered** write to `race.db`, (b) **unfiltered mirror** write to `race.scan.db`.
   - *Own boat*: N2K GPS PGN 129025 (position rapid update) + PGN 129029 (GNSS position with COG/SOG) at ~1 Hz → written to `race.db` only, tagged with Marcus's configured own-MMSI, `source='n2k_gps_own'`. Not written to `race.scan.db`.
4. **After race:** copy both `.db` files to home machine.
5. **Replay:** Open `race.db` → animate + analyze. If an unexpected competitor needs to be added post-race, "Add Boat" dialog surfaces MMSIs from the sibling `race.scan.db` not yet in the fleet; promote to library, add to race fleet, and the Replay app merges that boat's positions from scan.db into the active race view.

---

## 4. Tech Stack

| Layer | Choice | Rationale | Alternatives Considered |
|---|---|---|---|
| AIS Logger | canboatjs (existing) | Already in Aeolus; decodes PGN 129038/039/040/794 natively | signalk-server (heavier infra), OpenCPN (second app) |
| Logger host | Aeolus Electron (existing) | Zero new hardware; COM port already shared | Standalone Node script, OpenCPN plugin |
| Logger storage | SQLite (better-sqlite3) | Portable single file; already in Aeolus; queryable | JSON lines, CSV |
| Replay framework | Tauri v2 | Cross-platform (Windows + Ubuntu); 75% less RAM than Electron; same React/TS front-end | Electron (heavier), web-only (file access friction) |
| Replay UI | React 19 + TypeScript + Vite + Tailwind | Identical to Aeolus stack; no new skills | SvelteKit |
| Map rendering | MapLibre GL JS + deck.gl TripsLayer | WebGL-accelerated; handles 20+ boat tracks at 60fps; open-source | Leaflet (too slow for animation), Mapbox (paid) |
| Nautical tiles | OpenSeaMap + OpenStreetMap | Free, no API key | NOAA RNC tiles |
| Analytics queries | DuckDB-WASM | SQL over SQLite in-browser; zero backend | pandas (Python), observable-framework |
| Time-series charts | Observable Plot | Lightweight, composable, MIT; pairs well with DuckDB | Recharts, D3 |
| Native SQLite (Tauri) | tauri-plugin-sql | Official Tauri plugin for SQLite access | rusqlite directly |

---

## 5. External APIs & Services

| Service | Purpose | Pricing | Auth | Signup |
|---|---|---|---|---|
| OpenSeaMap tiles | Nautical chart overlay | Free (community) | None | tiles.openseamap.org |
| OpenStreetMap tiles | Base map | Free (tile usage policy applies) | None | tile.openstreetmap.org |
| canboatjs / npm | AIS PGN decoding | Free, MIT | None | npmjs.com |
| DuckDB-WASM | In-browser analytics | Free, MIT | None | duckdb.org |
| deck.gl | WebGL track rendering | Free, MIT | None | deck.gl |
| MapLibre GL JS | Vector map renderer | Free, BSD | None | maplibre.org |

**No paid external services required.** This is a fully offline/local application.

---

## 6. Access Tokens & Credentials Needed

None. All dependencies are open-source, self-hosted tile sources, or local libraries. No API keys, no accounts, no OAuth flows.

**Environment:** No `.env` file needed. The Aeolus AIS Logger module inherits whatever SQLite path Aeolus already uses for its data directory.

---

## 7. Implementation Roadmap

### Phase 1a — Vessel Library + Fleet Manager (3–4 days)

**Goal:** Marcus can accumulate known boats across a season and assemble a per-race fleet by promoting library entries.

**Deliverables:**
- Two new Aeolus modules: `VesselLibrary` and `FleetManager`
- SQLite tables in Aeolus main DB:
  - `vessel_library` (mmsi, display_name, sail_number, class, source, notes, created_at, updated_at)
  - `fleets` (fleet_id, name, notes, created_at)
  - `fleet_members` (fleet_id, mmsi, PK (fleet_id, mmsi); mmsi is FK into vessel_library)
- **Vessel Library UI:** sortable table of all known boats with add/edit/delete; "Add Boat" form takes MMSI + display name + sail number + class + notes. Typical workflow: Marcus looks up a boat on MarineTraffic, copies the MMSI, and enters it here.
- **Fleet Manager UI:** list of fleets, each with a two-pane editor — left pane shows the vessel library, right pane shows current fleet members, with promote/demote buttons. Fleets are reusable across races.
- **Scan mode:** toggle in Vessel Library that temporarily subscribes to all AIS PGNs and shows a live table of nearby MMSIs with [MMSI, AIS Name (from PGN 129794/129809), First Seen, Last Seen, Signal Count, In Library?, Add→]. "Add" opens the standard vessel entry form pre-filled with the AIS name. Scan writes nothing to any race file — it's purely a library-building assist.
- Library import/export: JSON for backup and device sync.

**Done when:** Marcus can build a vessel library of 50+ boats, create a "Wednesday Night Series 2026" fleet with 15 of them, save it, and reopen it later.

### Phase 1b — AIS Logger Module (3–5 days)

**Goal:** Aeolus produces two race files per race — a clean fleet-only `race.db` (with own-boat merged in from N2K GPS) and an unfiltered AIS sibling `race.scan.db`.

**Deliverables:**
- New `AISLogger` module in Aeolus
- Aeolus settings: `own_mmsi` (string), `own_boat_display_name`, `own_sail_number`, `own_class`. Configured once; used to tag own-boat positions and auto-populate the own-boat row in every race file's `vessels` table.
- Shared SQLite schema for both race files: `vessels`, `positions`, `race_meta` (see Section 8). `race.db` embeds a snapshot of the active fleet + own-boat at logging start.
- UI panel: Select Fleet → "New Race" → enter race name → Start Logging → Stop → both files written.
- canboatjs subscriptions:
  - AIS: PGN 129038, 129039, 129040, 129794, 129809, 129810
  - Own boat GPS: PGN 129025 (position rapid update, ~10 Hz on most GPS) and PGN 129029 (GNSS position with COG/SOG, ~1 Hz)
- **Dual-write dispatcher:**
  - All AIS position reports → deduplicated → written to `race.scan.db` (unfiltered mirror).
  - AIS position reports whose MMSI is in the active fleet → additionally written to `race.db`.
  - AIS static-data PGNs follow the same split.
  - Own-boat GPS → written to `race.db` only, tagged with own-MMSI, `source='n2k_gps_own'`. Downsample to 1 Hz for storage parity with competitors (keeps file sizes reasonable).
- Fleet snapshot: on logging start, copy active fleet rows + own-boat row into `race.db.vessels`. Snapshot is immutable mid-race.

**Done when:** For a 30-min test run with a 3-MMSI fleet in an area with 10+ visible AIS targets, `race.db` contains the 3 fleet MMSIs + own-boat (with ~1800 own-boat position records at 1 Hz), and `race.scan.db` contains all 10+ MMSIs (AIS only, no own-boat).
- Static data merge: when PGN 129794/129809/129810 arrives, upsert vessel name into `vessels` table

**Done when:** With a fleet of 5+ MMSIs selected, a `.db` file is produced on the boat that contains position records for ONLY those MMSIs (verified by inspecting the file — zero non-fleet MMSIs present).

---

### Phase 2 — Replay App Walking Skeleton (5–7 days)

**Goal:** Load a `.db` file and show animated boat tracks on a nautical chart.

**Deliverables:**
- Tauri v2 project scaffolded (`npm create tauri-app@latest`)
- File picker → load `.db` → read into memory
- MapLibre base map (OpenStreetMap + OpenSeaMap overlay)
- deck.gl TripsLayer: one color per MMSI, animated along timestamps
- Bottom timeline scrubber: drag to seek, play/pause, 1x/5x/10x/30x speed
- Boat labels (vessel name on hover)
- Basic gap handling: dashed line for gaps 3–15 min; gap marker for >15 min

**Done when:** A race `.db` file loads and all boats animate smoothly across the chart.

---

### Phase 3 — Analytics Panel + Post-Race Fleet Editing (5–7 days)

**Goal:** Useful post-race analysis beyond the visual replay, plus the ability to amend fleet composition after the fact.

**Deliverables:**
- DuckDB-WASM integration: load `.db` file into DuckDB session
- SOG time-series chart (Observable Plot): per-boat line, x=time y=SOG
- Boat selector checkboxes (show/hide individual boats)
- Distance-to-leader calculation: at each timestamp, which boat is closest to race finish (or a configurable mark), and delta to 1st place
- Mark rounding table: configurable waypoint lat/lon → auto-detect approximate rounding times
- **Post-race fleet editing:**
  - "Add Boat" button: if a sibling `race.scan.db` exists, surface its MMSIs not currently in `race.db`'s vessels table. Show MMSI, AIS Name, first/last seen, position count, with "Add" button. Adding promotes the boat into the user's Vessel Library (via a round-trip to Aeolus's library DB, or a local library mirror) and merges its positions from scan.db into race.db.
  - "Remove Boat": removes a boat from the race view by soft-flagging (`vessels.excluded=1`) rather than deleting data, so the removal is reversible.
  - "Reset to Snapshot": reverts fleet composition to the original fleet snapshot captured at logging start.
- Export: screenshot replay frame as PNG; export analytics as CSV; export a GPX per boat.

**Done when:** After loading a race file, Marcus can see a meaningful SOG chart, identify when/where position changes happened, AND add a missed competitor after the race if their MMSI was captured in the scan file.

---

### Phase 4 — Polish & Integration (3–4 days)

**Goal:** Usable as a personal tool across hardware.

**Deliverables:**
- Tauri auto-updater
- Race library: list of recent `.db` files with date, race name, boat count
- NMEA 0183 import: accept raw `!AIVDM` sentences file as fallback input (for OpenCPN-collected data)
- Map: NOAA chart tiles as optional base layer (US waters)
- Windows MSI + Linux AppImage build targets configured in CI

---

## 8. Coding Agent Handoff Notes

### Repository structure to bootstrap

```
regatta-replay/
├── aeolus-ais-module/     # Phase 1 — drop into existing Aeolus repo
│   ├── AISLogger.ts       # Main module: PGN subscribe + SQLite write
│   ├── schema.sql         # DB schema init
│   └── AISLoggerPanel.tsx # UI panel
├── replay-app/            # Phase 2–4 — new Tauri v2 project
│   ├── src-tauri/         # Rust backend (minimal: file commands only)
│   └── src/               # React front-end
│       ├── components/
│       │   ├── MapView.tsx       # MapLibre + deck.gl
│       │   ├── Timeline.tsx      # Scrubber + controls
│       │   └── AnalyticsPanel.tsx
│       ├── hooks/
│       │   └── useRaceData.ts    # Load + interpolate positions
│       └── lib/
│           ├── interpolate.ts    # Linear interpolation for AIS gaps
│           └── duckdb.ts         # DuckDB-WASM wrapper
```

### Scaffold commands

```bash
# Replay app (Phase 2+)
npm create tauri-app@latest replay-app -- --template react-ts
cd replay-app
npm install maplibre-gl @deck.gl/core @deck.gl/layers @deck.gl/maplibre
npm install @duckdb/duckdb-wasm
npm install @observablehq/plot
npm install @tauri-apps/plugin-sql @tauri-apps/plugin-dialog

# In src-tauri/Cargo.toml, add:
# tauri-plugin-sql = { version = "2", features = ["sqlite"] }
# tauri-plugin-dialog = "2"
```

### SQLite schema

**Aeolus main DB (persistent, survives across races):**

```sql
CREATE TABLE IF NOT EXISTS vessel_library (
  mmsi TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  sail_number TEXT,
  class TEXT,
  source TEXT,              -- 'marinetraffic' | 'scan' | 'manual' | 'import'
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fleets (
  fleet_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fleet_members (
  fleet_id INTEGER NOT NULL,
  mmsi TEXT NOT NULL,       -- FK into vessel_library
  PRIMARY KEY (fleet_id, mmsi),
  FOREIGN KEY (fleet_id) REFERENCES fleets(fleet_id) ON DELETE CASCADE,
  FOREIGN KEY (mmsi) REFERENCES vessel_library(mmsi)
);
```

Note that `fleet_members` holds no boat metadata — it's a pure junction table. Library is the single source of truth for display_name / sail_number / class. Edits to the library propagate everywhere.

**Race files (one pair per race — `race.db` + `race.scan.db`, identical schema):**

```sql
CREATE TABLE IF NOT EXISTS race_meta (key TEXT PRIMARY KEY, value TEXT);
-- Keys: race_name, start_time_utc, end_time_utc, own_mmsi, fleet_name, fleet_snapshot_at

CREATE TABLE IF NOT EXISTS vessels (
  mmsi TEXT PRIMARY KEY,
  ais_name TEXT,          -- as reported by AIS static data
  display_name TEXT,      -- from library snapshot at logging start
  sail_number TEXT,       -- from library snapshot
  class TEXT,             -- from library snapshot
  call_sign TEXT,
  vessel_type INTEGER,
  excluded INTEGER DEFAULT 0,  -- 1 = removed post-race (soft delete)
  added_post_race INTEGER DEFAULT 0  -- 1 = added via post-race fleet edit
);

CREATE TABLE IF NOT EXISTS positions (
  mmsi TEXT NOT NULL,
  timestamp_utc TEXT NOT NULL,  -- ISO 8601 UTC
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  sog REAL,                      -- knots
  cog REAL,                      -- degrees true
  heading REAL,                  -- degrees true
  source TEXT,                   -- 'n2k_129038' | 'n2k_129039' | 'nmea_aivdm' | 'n2k_gps_own'
  interpolated INTEGER DEFAULT 0, -- 1 = gap-filled
  PRIMARY KEY (mmsi, timestamp_utc)
);

CREATE INDEX IF NOT EXISTS idx_positions_mmsi_time ON positions(mmsi, timestamp_utc);
```

- `race.db` — fleet MMSIs populated from AIS + own-boat populated from N2K GPS; this is the primary artifact.
- `race.scan.db` — same schema, holds every received AIS target during the logging window. Can be deleted anytime for storage savings; its only purpose is to support post-race "Add Boat" merges. Not required for replay or analytics.

### Key implementation notes

1. **COM port sharing on Windows (REQUIRED):** Marcus runs Aeolus and Expedition on the same Windows PC. The NGT-1 presents as a single COM port that cannot be opened by two apps simultaneously. Use `com0com` (free, open-source) to create a virtual COM port pair; feed the NGT-1 output into both virtual ports so Expedition and Aeolus each get their own stream. Document this setup once — it is a one-time install on the boat PC and is the most likely installation pain point.

2. **canboatjs PGN subscribe pattern:**
   ```typescript
   const fromPgn = require('@canboat/canboatjs').fromPgn
   // Listen on serial port for N2K frames
   // On each frame, call fromPgn(rawFrame) → decoded PGN object
   // Filter by pgn: [129038, 129039, 129040, 129794, 129809, 129810]
   ```

3. **deck.gl TripsLayer data format:**
   ```typescript
   // Each boat = one Trip object
   { path: [[lon, lat], ...], timestamps: [t1, t2, ...], color: [r,g,b] }
   // currentTime (state) drives the animation
   ```

4. **Interpolation:** For each boat's position array, on load, run a pass that fills gaps ≤ 15 min with linear interpolation at 30s intervals and flags them `interpolated: true`. Gaps >15 min → insert a null break in the path array (deck.gl handles null breaks in TripsLayer).

5. **MMSI → vessel name:** The static data PGN (129794) arrives infrequently. Implement an upsert that merges vessel name into the `vessels` table whenever it's received. On first seen MMSI with no name yet, insert a placeholder `"MMSI: [mmsi]"` and update when static data arrives.

6. **Tauri file access:** Use `tauri-plugin-dialog` for the file picker, `tauri-plugin-sql` for SQLite reads. The Rust backend needs no custom commands for Phase 2 — both plugins handle it.

7. **Fleet whitelist filter:** Load the active fleet's MMSIs into a `Set<string>` at race-logging start. In the PGN handler, drop any decoded position/static-data message whose MMSI is not in the set. This is a single `if (!fleet.has(pgn.fields['User ID'])) return` guard; cheap and simple. The fleet is a snapshot — mid-race edits do not affect the running log (prevents accidental data loss or MMSI-ambiguity bugs).

8. **Scan mode UX:** When active, show a simple table with columns [MMSI, AIS Name, First Seen, Last Seen, Signal Count, Add→]. Updates in real time as PGNs arrive. Checking "Add" opens a small form to confirm display name + sail number before writing to `fleet_members`. Scan mode writes nothing to any race file.

9. **Race file output path:** Aeolus settings expose a `race_file_output_dir` (default: `%USERPROFILE%\OneDrive\Regatta Replay\races\`). Race files are written directly here; OneDrive handles the sync to the home Geekom A9. On the home side, point the Replay app's "Race Library" at the same OneDrive folder (`~/OneDrive/Regatta Replay/races/` on Linux once OneDrive sync is set up, or configure the appropriate client — rclone, OneDrive-for-Linux, or Insync). No manual file transfer needed.

10. **Risk — OneDrive sync lag or conflicts:** If logging is interrupted and the file is partially flushed, OneDrive may sync a corrupt intermediate state. Mitigation: write to a `.tmp` filename during logging; rename to the final `.db` only after clean Stop. Rename is atomic on NTFS and OneDrive syncs the final name as a complete upload.

11. **Concurrent logging footprint:** Aeolus already logs own-boat performance data (GPS, wind, instruments at 1–10 Hz across many channels — hundreds to a thousand+ writes per second). Adding competitor AIS logging is additive but **negligible by comparison**: 20 Class B boats × 1 report / 30s = ~0.7 writes/sec; even 100 AIS targets in a busy harbor ≈ 3–4/sec. canboatjs is already decoding every PGN on the bus — adding AIS handlers is near-zero marginal CPU. **Locked-in defaults to keep it safe:**
    - **Separate SQLite connections per DB file** (Aeolus perf DB, race.db, race.scan.db). Each file gets its own `better-sqlite3` connection — no lock contention.
    - **WAL journal mode on all three files** (`PRAGMA journal_mode=WAL`). Standard for concurrent-write workloads.
    - **5-second transaction batching for position inserts.** Instead of a per-row INSERT (fsync per row), buffer incoming position reports in memory and commit every 5 seconds with `BEGIN...COMMIT`. Keeps the Node event loop clean and amortizes fsync cost. On clean Stop, flush any pending buffer before the atomic rename.

    Expected steady-state footprint during a race on the boat PC: well under 2% CPU and under 5 MB RAM for the Logger module itself (on top of whatever Aeolus already uses). Any modern Windows PC capable of running Expedition has massive headroom for this.

---

## 9. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AIS receiver not on N2K bus / PGNs not flowing | **Resolved** | — | Confirmed: OpenCPN already consumes AIS via NGT-1 on this hardware. |
| COM port sharing on Windows causes conflicts | Medium | Medium | com0com virtual splitter — one-time install on the Expedition PC; standard practice. |
| OneDrive syncs partial/corrupt mid-logging file | Low | Low | Logger writes to `.tmp` and atomically renames to `.db` on Stop; OneDrive only uploads the final name. |
| AIS reception range insufficient in heavy fleet | Medium | Medium | Expected — app is designed for spotty data; interpolation handles it |
| deck.gl TripsLayer performance with 30 boats × 20h | Low | Medium | deck.gl handles 10M+ points; 1.4M points is well within limits |
| OpenSeaMap tiles unavailable offline | Low | Low | Cache tiles locally using a tile cache proxy (Phase 4 item) |
| Tauri WebView on Linux renders differently than Windows | Low | Low | MapLibre/deck.gl are browser-standard WebGL; consistent across platforms |

**All design and operational questions resolved:**
- MMSI acquisition: MarineTraffic.com lookups done ahead of time, entered manually into Vessel Library. (v1.2)
- Post-race fleet editing: SUPPORTED via dual-file `race.db` + `race.scan.db` storage. (v1.2)
- Dual-file auto-write: YES, written automatically every race. (v1.3)
- Own-boat capture: from N2K GPS (PGN 129025/129029) at 1 Hz, written to `race.db` with configured own-MMSI. Not pulled from AIS self-receive. (v1.3)
- AIS reception on N2K confirmed: all AIS vessels are visible on the bus; OpenCPN already uses the NGT-1 path on the same hardware. (v1.4)
- Hardware topology: Aeolus and Expedition share one Windows PC. **com0com virtual COM port splitter required** to let both apps consume the NGT-1 stream simultaneously. (v1.4)
- File transfer: Expedition PC runs Microsoft OneDrive sync. Aeolus writes `race.db` + `race.scan.db` to a configured OneDrive-synced folder; files appear on the home Geekom A9 automatically with no USB step. (v1.4)

---

## 10. Resources

| URL | Why it matters |
|---|---|
| https://github.com/canboat/canboatjs | AIS PGN decoding — core of the logger module |
| https://deck.gl/docs/api-reference/geo-layers/trips-layer | TripsLayer API — core of the replay animation |
| https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre | MapLibre + deck.gl integration |
| https://maplibre.org/maplibre-gl-js/docs/ | MapLibre GL JS docs |
| https://tiles.openseamap.org | OpenSeaMap tile server (free) |
| https://duckdb.org/docs/api/wasm | DuckDB-WASM for in-browser analytics |
| https://observablehq.com/plot/ | Observable Plot for time-series charts |
| https://v2.tauri.app/start/ | Tauri v2 getting started |
| https://github.com/tauri-apps/tauri-plugin-sql | Tauri SQLite plugin |
| https://panbo.com/class-b-ais-so-cs-transmit-rates-truth-vs-confusion/ | Class B AIS transmit rate specs (30s interval) |
| https://sailingmetrics.com/blog/sailing-analytics-and-gps-tracking-apps-compared-15 | Competitor landscape comparison |
| https://raceqs.com | RaceQs — benchmarked; not suitable for this use case |
| https://github.com/saikosis/geolibre | Reference Tauri + MapLibre + deck.gl project |
