# Regatta Replay

Standalone desktop app for post-race regatta replay. Loads `race.db` files produced by [Aeolus](https://github.com/MarcusWun/aeolus) and plays back the fleet's tracks on an offline nautical map.

**Status:** Phase 2a (walking skeleton) in progress — map, fleet animation, timeline controls. Analytics and exports are Phase 2b and 2c.

## What it does today

Phase 2a scope:

- Load a `race.db` file via a Tauri file picker.
- Render the course from `race_marks`; fall back to a GPX file picker if `race_marks` is empty.
- Draw an offline Natural Earth basemap (land + ocean, no labels, no network dependency).
- Animate the fleet along the race timeline using deck.gl `TripsLayer`.
- Start the replay 5 minutes before the first start-line crossing (`waypoint 1 → waypoint 2` perpendicular).
- Play / Pause, speed slider (1×–1000×, adaptive default), timeline scrubber, jump-to-start/end.
- Per-boat Legend with show/hide toggles and configurable trail length.
- Dim boats at 50 % opacity when they've been without a GPS fix for 60 s.

## Running locally

```
cd replay-app
npm install
npm run tauri dev    # dev build with hot reload
npm run tauri build  # produces installer in src-tauri/target/release/bundle
```

Prerequisites: Node 24+, Rust stable, and the [Tauri v2 prerequisites](https://tauri.app/start/prerequisites/) for your platform.

### Running tests

```
cd replay-app
npm run typecheck
npm run test
npm run test:coverage
```

## Architecture

```
replay-app/
├── src/
│   ├── components/       # MapView, Timeline, FilePicker, Legend
│   ├── hooks/            # useRaceData, useReplayClock, useStartDetection
│   ├── lib/              # geo math, gpx parser, colors, sqlite wrapper
│   ├── __tests__/        # vitest
│   └── assets/basemap/   # Natural Earth 10m land + ocean, pre-simplified
└── src-tauri/            # Tauri v2 Rust backend
```

- Map: [MapLibre GL JS](https://maplibre.org/) with offline Natural Earth vector sources.
- Fleet animation: [deck.gl](https://deck.gl/) `TripsLayer` interleaved onto MapLibre.
- Storage: `@tauri-apps/plugin-sql` opens `race.db` read-only; data pulled into memory once per load.

## Repo layout

- `PROPOSAL.md` — the long-form proposal that led to this repo.
- `research/` — background docs on AIS, competitive tools, platform tradeoffs.
- `replay-app/` — the Tauri + React + TypeScript app.
- `.github/workflows/build.yml` — CI for Linux `.AppImage` + Windows `.msi`.

## License

MIT — see [LICENSE](./LICENSE).
