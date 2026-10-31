import { describe, expect, it } from 'vitest';
import { parseGpxString } from '../lib/gpx';

describe('parseGpxString', () => {
  it('returns an error when there are no waypoints', () => {
    const result = parseGpxString('<gpx version="1.1"></gpx>');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('no waypoints');
  });

  it('parses a simple two-waypoint GPX, marking first=start and last=finish', () => {
    const gpx = `
      <gpx version="1.1">
        <wpt lat="41.5" lon="-70.6"><name>Start</name></wpt>
        <wpt lat="41.55" lon="-70.55"><name>Windward</name></wpt>
      </gpx>
    `;
    const result = parseGpxString(gpx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.marks).toHaveLength(2);
    expect(result.marks[0]).toMatchObject({ seq: 1, name: 'Start', is_start: 1, is_finish: 0 });
    expect(result.marks[1]).toMatchObject({ seq: 2, name: 'Windward', is_start: 0, is_finish: 1 });
  });

  it('marks a single waypoint as both start and finish', () => {
    const result = parseGpxString('<wpt lat="41.5" lon="-70.6"><name>Solo</name></wpt>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.marks).toHaveLength(1);
    expect(result.marks[0].is_start).toBe(1);
    expect(result.marks[0].is_finish).toBe(1);
  });

  it('tolerates self-closing wpt tags without a name', () => {
    const result = parseGpxString('<wpt lat="41.5" lon="-70.6"/><wpt lat="41.55" lon="-70.55"/>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.marks).toHaveLength(2);
    expect(result.marks[0].name).toBeNull();
  });

  it('rejects out-of-range coordinates silently (skip, do not throw)', () => {
    const gpx = `
      <wpt lat="999" lon="-70.6"><name>Bad</name></wpt>
      <wpt lat="41.5" lon="-70.6"><name>Good</name></wpt>
    `;
    const result = parseGpxString(gpx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.marks).toHaveLength(1);
    expect(result.marks[0].name).toBe('Good');
  });

  it('unwraps CDATA inside <name>', () => {
    const gpx = `<wpt lat="41.5" lon="-70.6"><name><![CDATA[W/L 1]]></name></wpt>`;
    const result = parseGpxString(gpx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.marks[0].name).toBe('W/L 1');
  });
});
