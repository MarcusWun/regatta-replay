// Replay clock — drives the current-replay-time using requestAnimationFrame.
// Keeps a wall-clock anchor + a race-time anchor; current race-time is
// recomputed each frame as:
//   raceTimeMs = anchorRaceMs + (performance.now() - anchorWallMs) * speed
//
// This avoids drift (we don't accumulate per-frame deltas) and lets us scrub
// cheaply (just move the anchor).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseReplayClockOptions {
  /** Replay window start (UTC ms since epoch). */
  startMs: number;
  /** Replay window end (UTC ms since epoch). */
  endMs: number;
  /** Initial playback speed multiplier (×). */
  initialSpeed: number;
}

export interface ReplayClock {
  /** Current replay time in UTC ms since epoch. */
  nowMs: number;
  /** Current speed multiplier (×). */
  speed: number;
  playing: boolean;
  /** 0..1 progress through [startMs, endMs]. */
  progress: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (s: number) => void;
  seek: (ms: number) => void;
  seekProgress: (p: number) => void;
  jumpToStart: () => void;
  jumpToEnd: () => void;
}

export function useReplayClock({ startMs, endMs, initialSpeed }: UseReplayClockOptions): ReplayClock {
  const [nowMs, setNowMs] = useState(startMs);
  const [speed, setSpeedState] = useState(initialSpeed);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const anchorsRef = useRef({ raceMs: startMs, wallMs: 0 });

  const span = Math.max(1, endMs - startMs);

  const reanchor = useCallback((raceMs: number, nextSpeed = speed) => {
    anchorsRef.current = { raceMs, wallMs: performance.now() };
    setSpeedState(nextSpeed);
    setNowMs(raceMs);
  }, [speed]);

  const stopRaf = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const tick = useCallback(() => {
    const { raceMs, wallMs } = anchorsRef.current;
    const elapsedWall = performance.now() - wallMs;
    const next = raceMs + elapsedWall * speed;
    if (next >= endMs) {
      setNowMs(endMs);
      setPlaying(false);
      stopRaf();
      return;
    }
    setNowMs(next);
    rafRef.current = requestAnimationFrame(tick);
  }, [endMs, speed]);

  useEffect(() => {
    if (!playing) {
      stopRaf();
      return;
    }
    anchorsRef.current = { raceMs: nowMs, wallMs: performance.now() };
    rafRef.current = requestAnimationFrame(tick);
    return stopRaf;
    // We deliberately re-anchor only when `playing` or `speed` flips; nowMs
    // is handled by the ticker itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, tick]);

  const play = useCallback(() => {
    if (nowMs >= endMs) {
      reanchor(startMs);
    }
    setPlaying(true);
  }, [endMs, nowMs, reanchor, startMs]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => {
    if (playing) setPlaying(false);
    else play();
  }, [play, playing]);

  const setSpeed = useCallback((s: number) => {
    reanchor(nowMs, s);
  }, [nowMs, reanchor]);

  const seek = useCallback((ms: number) => {
    const clamped = Math.max(startMs, Math.min(endMs, ms));
    reanchor(clamped);
  }, [endMs, reanchor, startMs]);

  const seekProgress = useCallback((p: number) => {
    const clamped = Math.max(0, Math.min(1, p));
    seek(startMs + clamped * span);
  }, [seek, span, startMs]);

  const jumpToStart = useCallback(() => seek(startMs), [seek, startMs]);
  const jumpToEnd = useCallback(() => seek(endMs), [endMs, seek]);

  return useMemo(() => ({
    nowMs,
    speed,
    playing,
    progress: (nowMs - startMs) / span,
    play,
    pause,
    toggle,
    setSpeed,
    seek,
    seekProgress,
    jumpToStart,
    jumpToEnd,
  }), [endMs, jumpToEnd, jumpToStart, nowMs, pause, play, playing, seek, seekProgress, setSpeed, speed, span, startMs, toggle]);
}

/**
 * Pick the default replay speed per PRD §2.5.
 *   <2h   → 60×
 *   2–10h → 180×
 *   10h+  → 300×
 */
export function defaultSpeedForDuration(durationMs: number): number {
  const hours = durationMs / (3600 * 1000);
  if (hours < 2) return 60;
  if (hours < 10) return 180;
  return 300;
}
