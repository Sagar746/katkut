import { describe, it, expect } from 'vitest';
import { AnalysisClip, AnalysisWindow } from '../types';
import { miniVlogRule } from './mini_vlog';
import { buildReel } from './index';

function win(start: number, p: Partial<AnalysisWindow> = {}): AnalysisWindow {
  return {
    start,
    end: start + 1,
    blur: 0.1,
    audioRMS: -30,
    exposure: 0.5,
    frozen: false,
    ...p,
  };
}

function clip(clipId: string, windows: AnalysisWindow[], extra: Partial<AnalysisClip> = {}): AnalysisClip {
  const duration = windows.length ? windows[windows.length - 1].end : 0;
  return { clipId, duration, orientation: 'portrait', sceneCuts: [], windows, uri: `file://${clipId}`, ...extra };
}

function goodClip(id: string, len = 4): AnalysisClip {
  return clip(id, Array.from({ length: len }, (_, i) => win(i, { blur: 0.05, exposure: 0.5 })));
}

// ─── rejectClip ───────────────────────────────────────────────────────────────

describe('miniVlogRule.rejectClip', () => {
  it('rejects blurry, dark, blown and frozen-only clips', () => {
    expect(miniVlogRule.rejectClip(clip('a', [win(0, { blur: 0.9 })]))).toBe(true);
    expect(miniVlogRule.rejectClip(clip('b', [win(0, { exposure: 0.02 })]))).toBe(true);
    expect(miniVlogRule.rejectClip(clip('c', [win(0, { exposure: 0.99 })]))).toBe(true);
    expect(miniVlogRule.rejectClip(clip('d', [win(0, { frozen: true })]))).toBe(true);
  });

  it('keeps a clip with a sharp, well-lit, moving moment', () => {
    expect(miniVlogRule.rejectClip(clip('e', [win(0, { blur: 0.9 }), win(1, { blur: 0.05 })]))).toBe(false);
  });

  it('rejects an empty clip', () => {
    expect(miniVlogRule.rejectClip(clip('f', []))).toBe(true);
  });
});

// ─── resolveConfig ────────────────────────────────────────────────────────────

describe('miniVlogRule.resolveConfig', () => {
  it('keeps the segment range inside the 1–2s band at every length', () => {
    for (const max of [30, 60, 90, 120, 300]) {
      const cfg = miniVlogRule.resolveConfig({ lengthMin: 0, lengthMax: max });
      expect(cfg.minSegment).toBeGreaterThanOrEqual(1.0);
      expect(cfg.maxSegment).toBeLessThanOrEqual(2.0);
    }
  });

  it('ticks a touch faster for short reels, slower for long ones', () => {
    const short = miniVlogRule.resolveConfig({ lengthMin: 0, lengthMax: 30 });
    const long = miniVlogRule.resolveConfig({ lengthMin: 0, lengthMax: 120 });
    const beat = (c: { minSegment: number; maxSegment: number }) => (c.minSegment + c.maxSegment) / 2;
    expect(beat(short)).toBeLessThan(beat(long));
  });

  it('ignores audio entirely (weight 0)', () => {
    const cfg = miniVlogRule.resolveConfig({ lengthMin: 0, lengthMax: 60 });
    expect(cfg.weights.audio).toBe(0);
  });

  it('every range contains a whole second so bestSegment can find a segment', () => {
    for (const max of [30, 60, 90, 120, 300]) {
      const cfg = miniVlogRule.resolveConfig({ lengthMin: 0, lengthMax: max });
      const containsWholeSecond =
        Math.ceil(cfg.minSegment) <= Math.floor(cfg.maxSegment);
      expect(containsWholeSecond).toBe(true);
    }
  });
});

// ─── refineSegment (the metronome) ─────────────────────────────────────────────

describe('miniVlogRule.refineSegment', () => {
  const cfg = miniVlogRule.resolveConfig({ lengthMin: 0, lengthMax: 60 }); // range [1.0, 2.0] → beat 1.5

  it('forces every segment to exactly the beat length, ignoring scene cuts', () => {
    const c = clip('c', Array.from({ length: 4 }, (_, i) => win(i)), { duration: 4, sceneCuts: [1.2, 2.7] });
    const cand = { clipId: 'c', in: 0, out: 2, score: 0.7, meanAudioRMS: -30 };
    const refined = miniVlogRule.refineSegment(c, cand, cfg);
    expect(refined.out - refined.in).toBeCloseTo(1.5); // beat, NOT snapped to the 1.2 scene cut
  });

  it('ignores audio spikes — the rhythm is spacing, not sound', () => {
    const windows = [win(0, { audioRMS: -10 }), win(1, { audioRMS: -50 }), win(2), win(3)];
    const c = clip('c', windows, { duration: 4 });
    const cand = { clipId: 'c', in: 0, out: 2, score: 0.7, meanAudioRMS: -20 };
    const refined = miniVlogRule.refineSegment(c, cand, cfg);
    expect(refined.out - refined.in).toBeCloseTo(1.5);
  });

  it('produces the SAME length for every clip (true metronome)', () => {
    const cands = [
      { clip: clip('a', [win(0), win(1), win(2)], { duration: 3 }), cand: { clipId: 'a', in: 0, out: 2, score: 0.7, meanAudioRMS: -30 } },
      { clip: clip('b', [win(0), win(1), win(2)], { duration: 3 }), cand: { clipId: 'b', in: 1, out: 3, score: 0.7, meanAudioRMS: -30 } },
    ];
    const lengths = cands.map(({ clip: c, cand }) => {
      const r = miniVlogRule.refineSegment(c, cand, cfg);
      return r.out - r.in;
    });
    expect(lengths[0]).toBeCloseTo(lengths[1]);
    expect(lengths[0]).toBeCloseTo(1.5);
  });

  it('clamps to the clip end when there is not a full beat of footage', () => {
    const c = clip('c', [win(0, { end: 1 })], { duration: 1 });
    const cand = { clipId: 'c', in: 0, out: 1, score: 0.7, meanAudioRMS: -30 };
    const refined = miniVlogRule.refineSegment(c, cand, cfg);
    expect(refined.out).toBe(1); // only 1s of footage — can't reach the 1.5s beat
  });
});

// ─── buildReel end-to-end ─────────────────────────────────────────────────────

describe('buildReel (mini_vlog end-to-end)', () => {
  it('drops junk and keeps sharp clips', () => {
    const good = goodClip('clip_01');
    const junk = clip('clip_02', [win(0, { blur: 0.95 }), win(1, { frozen: true, blur: 0.95 })]);
    const edl = buildReel([good, junk], 'mini_vlog', { lengthMin: 0, lengthMax: 60 });
    expect(edl.timeline.every((t) => t.clipId !== 'clip_02')).toBe(true);
  });

  it('produces a uniform tick — all kept segments share one length', () => {
    const clips = Array.from({ length: 12 }, (_, i) => goodClip(`clip_${i + 1}`, 4));
    const edl = buildReel(clips, 'mini_vlog', { lengthMin: 0, lengthMax: 60 });
    expect(edl.timeline.length).toBeGreaterThan(1);
    const lengths = edl.timeline.map((t) => t.out - t.in);
    // clips with a full beat of footage are identical; allow shorter tails when footage runs out
    const full = lengths.filter((l) => l >= 1.4);
    expect(full.length).toBeGreaterThan(0);
    for (const l of full) expect(l).toBeCloseTo(1.5);
  });

  it('keeps every segment within the 1–2s band', () => {
    const clips = Array.from({ length: 12 }, (_, i) => goodClip(`clip_${i + 1}`, 5));
    const edl = buildReel(clips, 'mini_vlog', { lengthMin: 90, lengthMax: 120 });
    for (const t of edl.timeline) {
      const len = t.out - t.in;
      expect(len).toBeGreaterThan(0);
      expect(len).toBeLessThanOrEqual(2.0 + 0.01);
    }
  });
});
