import { describe, expect, it } from 'vitest';
import {
  csvFilename,
  elapsedForFilename,
  gpxFilename,
  pngFilename,
  slug,
} from '../lib/export/filename';

describe('slug', () => {
  it('lowercases and replaces non-alphanumerics with -', () => {
    expect(slug('Dark Star')).toBe('dark-star');
    expect(slug('USA 51234')).toBe('usa-51234');
    expect(slug('TP52 — J/121')).toBe('tp52-j-121');
  });

  it('trims leading and trailing separators', () => {
    expect(slug('  Hello!  ')).toBe('hello');
    expect(slug('---foo---')).toBe('foo');
  });

  it('falls back when input is null/empty/all-punctuation', () => {
    expect(slug(null)).toBe('untitled');
    expect(slug('')).toBe('untitled');
    expect(slug('——')).toBe('untitled');
  });

  it('collapses runs of non-alphanumerics', () => {
    expect(slug('a  b   c')).toBe('a-b-c');
    expect(slug('a..b__c')).toBe('a-b-c');
  });
});

describe('elapsedForFilename', () => {
  it('matches the PRD example T+0032m18s', () => {
    expect(elapsedForFilename(32 * 60_000 + 18_000)).toBe('T+0032m18s');
  });

  it('zero-pads minutes to 4 digits', () => {
    expect(elapsedForFilename(5 * 60_000 + 1_000)).toBe('T+0005m01s');
  });

  it('handles exactly zero', () => {
    expect(elapsedForFilename(0)).toBe('T+0000m00s');
  });

  it('represents pre-start as T-...', () => {
    expect(elapsedForFilename(-45_000)).toBe('T-0000m45s');
  });
});

describe('filename builders', () => {
  it('composes the PNG filename from race name + elapsed', () => {
    expect(pngFilename('2026-10-30 Race', 32 * 60_000 + 18_000)).toBe(
      '2026-10-30-race_T+0032m18s_map.png',
    );
  });

  it('composes the CSV filename from race name + mmsi + display name', () => {
    expect(csvFilename('2026-10-30 Race', '338123456', 'Dark Star')).toBe(
      '2026-10-30-race_338123456_dark-star.csv',
    );
  });

  it('composes the GPX filename from race name + mmsi + display name', () => {
    expect(gpxFilename('2026-10-30 Race', '338123456', 'Dark Star')).toBe(
      '2026-10-30-race_338123456_dark-star.gpx',
    );
  });

  it('falls back when race or display name are null', () => {
    expect(csvFilename(null, '338123456', null)).toBe(
      'untitled_338123456_untitled.csv',
    );
  });
});
