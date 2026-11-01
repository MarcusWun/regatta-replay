# Basemap pipeline

Static GeoJSON land/ocean layers are committed under `replay-app/src/assets/basemap/`.
This directory holds the one-shot ETL scripts used to produce them. The output
files are repo artifacts — do **not** regenerate at build time.

## Current artifacts

| File | Source | Projection | Extent | Simplify |
|---|---|---|---|---|
| `ne_10m_land.geojson`        | Natural Earth 10m `land`  | WGS84 | global          | NE default |
| `ne_10m_ocean.geojson`       | Natural Earth 10m `ocean` | WGS84 | global          | NE default |
| `osm_us_ne_land.geojson`     | OSMData `land-polygons-complete-4326` | WGS84 | lon −78..−70, lat 38..45 | Douglas-Peucker 20 m |

Layer order in `MapView.tsx`: ocean background → `ocean` → `land` (NE global) →
`land-us-ne` (OSM, drawn on top so fine detail supersedes NE 10m inside the
clip bbox).

## Reproducing `osm_us_ne_land.geojson`

Requires: `node`, `npx`, `curl`, `unzip`. Takes a few minutes.

```bash
cd replay-app/scripts/basemap

# 1. Download full-resolution WGS84 land polygons (~900 MB).
#    Do NOT use the pre-"simplified" variant — it is simplified at ~300 m,
#    coarse enough that marina basins (~150 m) disappear.
curl -L -o land-polygons.zip \
  https://osmdata.openstreetmap.de/download/land-polygons-complete-4326.zip
unzip -q land-polygons.zip

# 2. Clip to bbox + simplify + export.
#    --max-old-space-size: the shapefile is ~1.3 GB; mapshaper loads it in RAM.
NODE_OPTIONS="--max-old-space-size=16384" \
  npx --yes mapshaper@latest \
    land-polygons-complete-4326/land_polygons.shp \
    -clip bbox=-78,38,-70,45 \
    -simplify dp interval=20m keep-shapes \
    -o format=geojson precision=0.00001 \
      ../../src/assets/basemap/osm_us_ne_land.geojson

# 3. Clean up.
rm -rf land-polygons-complete-4326 land-polygons.zip
```

### Output budget

Keep the GeoJSON under **10 MB** (installer-size discipline). If the output is
larger, iterate the simplify tolerance (20 m → 30 m → 50 m) until under budget
and record the final tolerance in the PR description.

### Known limitation — marina basins

OSM's `land-polygons-*` dataset is derived from `natural=coastline` ways. Artificial
marina basins behind seawalls (Liberty Harbor, most urban marinas) are usually
tagged `leisure=marina` / `water=basin` rather than `natural=coastline`, so they
appear as continuous land in this dataset. Tightening the simplify tolerance
does not fix this — the vertices are not in the source data. If a specific marina
is critical, add a hand-authored patch polygon or augment with an Overpass query
in a follow-up pipeline.

## Adding a new racing region

1. Pick a bounding box in `-clip bbox=minLon,minLat,maxLon,maxLat` form.
2. Produce the new GeoJSON into `src/assets/basemap/osm_<region>_land.geojson`.
3. Add a `?raw` import + source + fill layer in `MapView.tsx`, keeping the layer
   order: coarser global land first, finer regional land on top.
4. Verify the raw file size stays within the overall basemap budget (NE globals
   + all OSM regions combined should remain under ~15 MB to keep cold-start
   parse time comfortably inside the Phase 2a 2 s NFR).
