# AIS Data Collection for Regatta Replay & Analytics

**Research date:** 2026-10-29
**Context:** Actisense NGT-1 on N2K bus, B&G H5000/Zeus 3S, Windows PC running Expedition, Aeolus Electron app (canboatjs). AIS expected to be spotty — not every boat every timestamp.

---

## 1. AIS Fundamentals for Racing Context

**Class B transponders** (what sailboat racers carry) transmit at a fixed 30-second interval regardless of speed (for speeds under 14 knots, which covers all sailing). At 7 knots boatspeed, a 30s gap = ~60 meters of position uncertainty. Acceptable for replay purposes.

**Class A** (commercial ships, some race committee boats) transmit every 2–10s depending on speed and manoeuvre state.

**Reception range:** From a sailboat masthead (~15–20m above water), horizon-limited AIS reception is approximately 15–25 nm in ideal conditions. In a 20-boat fleet in the Sound or offshore, 10–20 nm coverage is realistic. Boats behind land, in heavy sea scatter, or with obstructions may drop out for minutes at a time.

**Spotty data expectation:** For a 20h offshore race, expect:
- Boats within 5 nm: 90%+ update capture rate
- Boats 5–15 nm away: 50–80% capture rate
- Boats >15 nm: intermittent or absent

This is the core constraint — the app must handle gaps gracefully.

---

## 2. AIS Data Formats

**NMEA 0183 over serial/USB:**
- `!AIVDM` — AIS VHF data message (from other vessels)
- `!AIVDO` — own vessel
- Contains: MMSI, lat/lon, SOG, COG, heading, nav status, timestamp
- Multi-sentence for longer messages (static data, voyage info)

**NMEA 2000 PGNs (what the Actisense NGT-1 decodes):**
- PGN 129038 — AIS Class A Position Report
- PGN 129039 — AIS Class B Position Report
- PGN 129040 — AIS Class B Extended Position Report
- PGN 129794 — AIS Class A Static & Voyage Data (vessel name, call sign)
- PGN 129809/129810 — AIS Class B CS Static Data (vessel name, dimensions)

canboatjs fully decodes all of these. The NGT-1 → USB → Node.js pipeline Marcus already has in Aeolus will work without hardware changes.

---

## 3. Collection Method Options

### Option A: Aeolus AIS Logger Module (RECOMMENDED PRIMARY)

Add a new module to the existing Aeolus Electron app that:
1. Subscribes to N2K PGNs 129038, 129039, 129040, 129794 via canboatjs
2. Writes timestamped records to a SQLite database (`.regatta.db`) already used in Aeolus
3. Exposes a simple UI: "Start Race Logging" → "Stop & Export"
4. On export, generates a race file (JSON or SQLite snapshot)

**Pros:**
- Zero new hardware needed
- Uses Marcus's existing canboatjs expertise and NGT-1
- Runs on the boat PC (Windows/Expedition machine)
- SQLite already in Aeolus — trivial to add a new table

**Cons:**
- Aeolus must be running during the race (not Expedition-exclusive)
- Both Expedition and Aeolus can share the NGT-1 COM port via a virtual COM port splitter (com0com or similar) — documented approach, not novel

**Implementation note:** canboatjs `fromPgn()` decodes PGN 129039 to fields including `User ID` (MMSI), `Latitude`, `Longitude`, `Speed Over Ground`, `Course Over Ground`, `True Heading`, `Name` (from static data PGN when received).

---

### Option B: Expedition AIS Logging

Expedition logs its own instrument data but **does not log competitor AIS target history** to a replayable format. This path is a dead end for multi-boat post-race replay. [CONFIRMED via forum research — Expedition replay replays own boat only]

**Verdict:** Cannot use Expedition as the AIS collector for competitor data.

---

### Option C: OpenCPN + AISLogger Plugin

Install OpenCPN on the boat PC alongside Expedition. The AISLogger plugin captures all AIVDM sentences from the COM port to a flat file.

**Pros:** Battle-tested, open-source, runs on Windows
**Cons:**
- Requires running OpenCPN alongside Expedition
- COM port sharing needed (virtual splitter)
- Raw NMEA file requires parsing; no SQLite structure
- OpenCPN is heavyweight if only used for logging

**Verdict:** Viable fallback if Aeolus module isn't ready for a specific race.

---

### Option D: Dedicated SignalK Server (Raspberry Pi on boat)

Run SignalK server on a cheap RPi Zero 2 W connected to the N2K bus via NGT-1 or direct via Actisense USB. SignalK logs all data including AIS targets to InfluxDB or flat files.

**Pros:** Clean separation of concerns; runs headless; well-documented
**Cons:**
- Adds hardware to the boat
- Raspberry Pi power/mounting on a race boat is a hassle
- More infrastructure to maintain

**Verdict:** Elegant architecture but over-engineered for this use case. Marcus already has the Geekom A9 on the boat (implied by Expedition running there). Use Aeolus instead.

---

### Option E: Public AIS APIs (MarineTraffic, AISHub)

MarineTraffic and similar services aggregate AIS globally. However:
- API access for historical data: $300–$1,000+/month for commercial-grade
- Coverage offshore is spotty (terrestrial receivers only reach so far)
- Data has latency (not raw; aggregated and filtered)
- Privacy/MMSI requirements

**Verdict:** Not viable as primary source. Could potentially supplement very close-to-shore data, but cost is prohibitive for a personal project.

---

## 4. Does Marcus Already Have AIS Reception?

The Zeus 3S MFD has documented AIS **display** capability (icon filters, target alerts). For it to display AIS targets, there must be an AIS receiver or transponder on the N2K bus providing PGNs 129038/129039.

The H5000 CPU page mentions VHF radio with integrated AIS receiver as a companion product — it's likely Marcus has a B&G VHF with AIS receiver (e.g., B&G V60 or similar) already connected to the N2K bus.

**Conclusion:** Marcus almost certainly already has AIS reception on the N2K bus. The NGT-1 will expose these PGNs to canboatjs with no additional hardware. [UNVERIFIED — confirm by checking canboatjs console output for PGN 129039 on the N2K bus while underway]

---

## 5. Gap-Fill / Spotty-Data Realities

**The problem:** Boat A is at position P1 at T=10:00 and next seen at P2 at T=10:18. What happened in between?

**Approach:**

| Gap Duration | Strategy |
|---|---|
| < 3 minutes (≤6 missed updates) | Linear interpolation, no flag |
| 3–15 minutes | Linear interpolation, render as dashed line |
| > 15 minutes | No interpolation; render as explicit gap marker in UI ("Lost contact for 22 min") |
| > 2 hours | Discard segment; treat as separate sub-track |

**Linear interpolation** is sufficient for replay purposes. Kalman filtering adds accuracy but complexity; given 30s Class B intervals, linear is defensible.

**Python/JS libraries:**
- `pyais` (Python) — decode raw NMEA AIS sentences to Python objects; used in data pipeline tools
- No dedicated sailing interpolation library found on GitHub — implement custom linear interpolator in the app (~30 lines of code)

**Known gotcha:** SOG and COG should also be interpolated, but with bounds checks (SOG ≥ 0, COG 0–359). Don't extrapolate beyond the last known position.

---

## 6. Summary Recommendation

**Primary collection path:** Aeolus AIS Logger module (new module in the existing Electron app).

Rationale:
- Zero new hardware
- canboatjs already decodes AIS PGNs — this is a ~200-line addition to Aeolus
- Outputs to SQLite, which maps directly to the replay app's data model
- Runs on the same Windows PC as Expedition via COM port splitter

**Fallback:** OpenCPN + AISLogger plugin if the Aeolus module isn't available for a specific race. Raw NMEA output requires a parsing step before loading into the replay app — document this as a supported import format.

**Storage format for race files:** SQLite database (see full schema in PROPOSAL.md Section 8). Core tables:
- `race_meta` (key, value)
- `vessels` (mmsi, name, display_name, sail_number, class, call_sign, vessel_type) — snapshot of the active fleet embedded at logging start
- `positions` (mmsi, timestamp_utc, lat, lon, sog, cog, heading, source, interpolated)

One `.db` file per race, named `YYYY-MM-DD_[race-name].db`.

**Fleet filtering (v1.1 addition):** The logger subscribes to all AIS PGNs but drops every message whose MMSI is not in the active fleet whitelist. Fleet is defined and persisted in Aeolus's main DB via the Fleet Manager module (CRUD UI + Scan mode). Race file contains ONLY fleet positions — no commercial traffic, no pleasure craft, no race committee.
