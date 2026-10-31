# Competitor Tools: Post-Race Sailboat Replay & Analytics

**Research date:** 2026-10-29
**Context:** Marcus races a Sun Fast 3300 in Northeast US offshore events. Goal: load self-collected AIS captures of every boat in a race and replay with analytics. On-board nav: Expedition (Windows). AIS data will be spotty.

---

## Expedition

**What it is:** Professional grand-prix nav and routing software (Windows only). The gold standard for offshore racing instrument integration.

**AIS support:** Expedition displays live AIS targets on the chart during racing. It logs all boat data to its own binary log format (.log). The replay function re-runs the own-boat track with all logged instrument data. **Critical gap: Expedition's replay only replays own-boat data.** AIS target positions are displayed live but are NOT stored in the log file in a way that enables multi-boat replay post-race. You can see competitors while racing; you cannot replay them afterward. [UNVERIFIED — confirmed via forum reports and lack of any documented AIS replay feature in Expedition docs]

**Platform:** Windows only
**Pricing:** ~£2,000–£3,000 one-time license (professional use)
**Verdict:** Best in class for own-boat nav; no multi-boat post-race replay from AIS.

---

## RaceQs

**What it is:** Free 3D race replay app, widely used in club racing. Each boat must run the RaceQs iOS/Android app during the race to record their GPS track.

**AIS support:** None. RaceQs requires opt-in participation from every boat. It does not accept AIS files.

**Platform:** Web + iOS + Android. Replay in browser (3D WebGL).
**Pricing:** Free
**Analytics:** Basic — replay only, limited leg timing, no polars overlay, no VMG.
**Verdict:** Useless for Marcus's use case. Requires every competitor to install and run the app.

---

## TackTracker

**What it is:** Web app focused on tack/gybe timing and leg analysis for windward-leeward racing.

**AIS support:** None. Accepts GPS tracks from their own logging hardware or GPX/TCX upload from the boat itself. No competitor AIS ingestion.

**Platform:** Web
**Pricing:** Free tier + paid tiers
**Analytics:** Tack timing, leg splits, mark roundings, speed comparisons
**Verdict:** Designed for dinghy/club racing. No path to AIS competitor data.

---

## SailMon (and SailMon Bravo)

**What it is:** Danish company making high-accuracy onboard instrument hardware (the Bravo display) with companion analytics.

**AIS support:** None as a replay platform. Their analytics focus on own-boat performance (polars, manoeuvre efficiency). No competitor AIS ingestion.

**Platform:** Proprietary hardware + web dashboard
**Pricing:** Hardware cost ~€1,500–€2,000 for Bravo display
**Verdict:** Excellent instrument hardware but not a multi-boat replay tool.

---

## SAP Sailing Analytics / TracTrac

**What it is:** Enterprise broadcast platform used at the Olympics, Volvo Ocean Race, SailGP, etc. Each boat carries a dedicated tracker unit. TracTrac provides live + replay for race organizers and broadcasters.

**AIS support:** Uses proprietary tracker hardware, not AIS. Replay is from TracTrac's own positioning system.

**Platform:** Enterprise (organizer-deployed)
**Pricing:** Enterprise only; not available to individual sailors
**Verdict:** Not applicable.

---

## Kattack / Kwindoo

**What it is:** Live tracking platform for race organizers. Boats activate tracking via a phone app or dedicated device. Kwindoo focuses on spectator-facing live tracking.

**AIS support:** None.

**Platform:** Web / mobile
**Pricing:** Event-based, organizer-focused
**Verdict:** Requires organizer buy-in; individual sailor can't self-collect.

---

## YB Tracking / YB Races

**What it is:** Satellite tracking + replay platform used in offshore distance races (Newport-Bermuda, Fastnet, etc.). Each boat must carry a YB tracker.

**AIS support:** None. Replays are from YB's own tracker data, which the race organizer activates.

**Platform:** Web (mobile-responsive)
**Pricing:** Organizer-procured (per-boat fee ~$150–200 per event)
**Verdict:** Used in many races Marcus may enter, but he's a consumer of YB replays, not the collector. Can't bring his own AIS data.

---

## MetaSail

**What it is:** Web-based regatta tracking and replay, common in Mediterranean and European club circuits.

**AIS support:** None. Requires GPS tracks uploaded by each participant.

**Platform:** Web
**Verdict:** Same limitation as RaceQs — requires opt-in from all boats.

---

## OpenCPN with AIS Logging

**What it is:** Free open-source chart plotter for Windows/Mac/Linux. Has AIS display capability. The "AISLogger" plugin logs all received AIS targets to a CSV file with timestamps.

**AIS support:** YES — this is the most promising existing tool for raw AIS capture. AISLogger plugin can write all received AIS NMEA sentences (AIVDM/AIVDO) to a timestamped file. However, post-race replay of competitor AIS tracks is not natively supported in OpenCPN.

**Platform:** Windows, Linux, Mac, Android
**Pricing:** Free, open-source
**Verdict:** Good for raw data collection; no replay or analytics layer. Could serve as a **fallback data source** if Expedition is running on the boat PC.

---

## Open-Source GitHub Projects

Searched for: "sailing replay", "AIS replay", "regatta analytics", "sailboat race visualization"

**Notable finds:**
- **gpxsee**: GPX viewer with multi-track support; no AIS, no analytics
- **AIS-catcher** (aiscatcher.org): SDR-based AIS receiver, logs to file/InfluxDB — useful as hardware alternative but Linux/SDR-focused
- **canboatjs** (github.com/canboat/canboatjs): TypeScript library already used in Aeolus. Fully supports PGN 129038/129039/129040 (AIS position reports). This is Marcus's native path.
- No dedicated "offline AIS race replay with analytics" project found on GitHub. The gap is real.

---

## AIS Ingestion Matrix

| Tool | Accepts AIS File | Multi-Boat Replay | Own-Boat Analytics | Platform | Cost |
|------|-----------------|-------------------|--------------------|----------|------|
| Expedition | No (live only) | No | Yes (polars, VMG) | Windows | ~£2.5k |
| RaceQs | No (own app) | Yes | Minimal | Web/Mobile | Free |
| TackTracker | No (own app) | Yes | Yes (tack timing) | Web | Free/Paid |
| SailMon | No | No | Yes (own boat) | Hardware | ~€1.5k |
| SAP/TracTrac | No (own tracker) | Yes | Enterprise only | Enterprise | Enterprise |
| YB Tracking | No (own tracker) | Yes | Minimal | Web | Organizer |
| OpenCPN | Logs NMEA | No native replay | No | Win/Lin/Mac | Free |
| **Custom app** | **Yes (design goal)** | **Yes** | **Yes** | **Win/Ubuntu** | **Self-built** |

---

## Market Gap Analysis

No existing tool serves the following combination:
1. **Self-collected AIS** — captured on Marcus's own boat from his existing receiver, no cooperation from competitors
2. **Offline/local replay** — doesn't depend on race organizer infrastructure or competitor app adoption
3. **Offshore long-course racing** — tools like RaceQs and TackTracker are built for windward-leeward short races; they lack features relevant to 6–20h offshore races (tide gates, routing decisions, night sailing)
4. **Spotty data tolerance** — gap-filling is not a solved UX problem; most tools assume continuous GPS
5. **Performance analytics** — SOG over time, VMG vs polars, time/distance delta to competitors

This is a genuine greenfield application with a clear, personal use case and no off-the-shelf solution.
