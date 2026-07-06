import { describe, it, expect } from 'vitest';
import { AnalysisClip, AnalysisWindow } from '../types';
import { autoRule } from './auto';
import { buildReel } from './index';

function win(start: number, p: Partial<AnalysisWindow> = {}): AnalysisWindow {
  return {
    start,
    end: start + 1,
    blur: 0.2,
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

describe('autoRule.rejectClip', () => {
  it('rejects a clip with no usable window (all blurry)', () => {
    const c = clip('clip_01', [win(0, { blur: 0.9 }), win(1, { blur: 0.85 })]);
    expect(autoRule.rejectClip(c)).toBe(true);
  });

  it('rejects pitch-black and frozen-only clips', () => {
    expect(autoRule.rejectClip(clip('a', [win(0, { exposure: 0.02 })]))).toBe(true);
    expect(autoRule.rejectClip(clip('b', [win(0, { frozen: true })]))).toBe(true);
  });

  it('keeps a clip that has at least one good moment', () => {
    const c = clip('clip_01', [win(0, { blur: 0.9 }), win(1, { blur: 0.1 })]);
    expect(autoRule.rejectClip(c)).toBe(false);
  });

  it('rejects a clip with no windows', () => {
    expect(autoRule.rejectClip(clip('empty', []))).toBe(true);
  });
});

describe('autoRule.resolveConfig pacing', () => {
  it('short reels cut fast, long reels hold longer', () => {
    const short = autoRule.resolveConfig({ lengthMin: 0, lengthMax: 30 });
    expect([short.minSegment, short.maxSegment]).toEqual([1.0, 2.0]);

    const long = autoRule.resolveConfig({ lengthMin: 120, lengthMax: 300 });
    expect([long.minSegment, long.maxSegment]).toEqual([4.0, 6.0]);

    // duration clamp follows the chosen range
    expect(short.minDuration).toBe(0);
    expect(short.maxDuration).toBe(30);
  });

  it('holds each clip longer (~6-9s) when too few clips could reach a longer target at normal pacing', () => {
    // 30-60s target from just 5-6 uploads: 6 clips * normal 3.0s max = 18s, nowhere near 60s.
    const cfg = autoRule.resolveConfig({ lengthMin: 30, lengthMax: 60, clipCount: 6 });
    expect([cfg.minSegment, cfg.maxSegment]).toEqual([6.0, 9.0]);
  });

  it('keeps normal pacing when there is plenty of footage for the target', () => {
    const cfg = autoRule.resolveConfig({ lengthMin: 30, lengthMax: 60, clipCount: 40 });
    expect([cfg.minSegment, cfg.maxSegment]).toEqual([1.5, 3.0]);
  });

  it('keeps normal pacing when clipCount is not supplied', () => {
    const cfg = autoRule.resolveConfig({ lengthMin: 30, lengthMax: 60 });
    expect([cfg.minSegment, cfg.maxSegment]).toEqual([1.5, 3.0]);
  });
});

describe('autoRule.refineSegment', () => {
  const cfg = autoRule.resolveConfig({ lengthMin: 0, lengthMax: 90 }); // segments 2.5–4.0s

  it('snaps the out-point to a nearby scene cut', () => {
    const windows = Array.from({ length: 6 }, (_, i) => win(i));
    const c = clip('clip_01', windows, { sceneCuts: [3.0] });
    const refined = autoRule.refineSegment(c, { clipId: 'clip_01', in: 0, out: 4, score: 0.6, meanAudioRMS: -30 }, cfg);
    expect(refined.out).toBe(3.0); // snapped to the scene cut (within the 2.5–4.0 range)
  });

  it('cuts just after an audio spike when there is no scene cut', () => {
    const windows = [
      win(0, { audioRMS: -40 }),
      win(1, { audioRMS: -40 }),
      win(2, { audioRMS: -12 }), // spike
      win(3, { audioRMS: -40 }),
    ];
    const c = clip('clip_01', windows); // no sceneCuts
    const refined = autoRule.refineSegment(c, { clipId: 'clip_01', in: 0, out: 4, score: 0.6, meanAudioRMS: -34 }, cfg);
    expect(refined.out).toBe(3); // end of the spike window (start 2 → end 3)
  });
});

describe('autoRule.extractSegments (multi-clip extraction)', () => {
  // 50 uniform, good, 1s windows — a 50s source clip.
  const longUniform = (clipId: string) => clip(clipId, Array.from({ length: 50 }, (_, i) => win(i)));

  it('mines a second, non-overlapping segment from a long (40s+) clip when footage is scarce', () => {
    const cfg = autoRule.resolveConfig({ lengthMin: 30, lengthMax: 60, clipCount: 6 }); // scarce → 6-9s pacing
    const segs = autoRule.extractSegments!(longUniform('clip_01'), cfg, 6);

    expect(segs.length).toBe(2);
    expect(segs.every((s) => s.out - s.in >= cfg.minSegment - 1e-6)).toBe(true);
    expect(segs.every((s) => s.out - s.in <= cfg.maxSegment + 1e-6)).toBe(true);
    expect(segs[0].in).toBeLessThan(segs[1].in); // returned in source-chronological order
    expect(segs[0].out).toBeLessThanOrEqual(segs[1].in); // never overlapping
  });

  it('does not extract a second segment from a clip shorter than 40s, even when scarce', () => {
    const cfg = autoRule.resolveConfig({ lengthMin: 30, lengthMax: 60, clipCount: 6 });
    const shortClip = clip('clip_01', Array.from({ length: 20 }, (_, i) => win(i))); // 20s
    const segs = autoRule.extractSegments!(shortClip, cfg, 6);
    expect(segs.length).toBe(1);
  });

  it('does not extract a second segment when there is already plenty of footage', () => {
    const cfg = autoRule.resolveConfig({ lengthMin: 30, lengthMax: 60, clipCount: 40 }); // plentiful → normal pacing
    const segs = autoRule.extractSegments!(longUniform('clip_01'), cfg, 40);
    expect(segs.length).toBe(1);
  });
});

describe('buildReel (auto end-to-end)', () => {
  it('drops junk clips and produces an EDL within the chosen length', () => {
    const good = clip('clip_01', Array.from({ length: 6 }, (_, i) => win(i, { blur: 0.1 })));
    const junk = clip('clip_02', [win(0, { blur: 0.95 }), win(1, { frozen: true, blur: 0.95 })]);
    const edl = buildReel([good, junk], 'auto', { lengthMin: 0, lengthMax: 30 });

    expect(edl.timeline.length).toBeGreaterThan(0);
    expect(edl.timeline.every((t) => t.clipId !== 'clip_02')).toBe(true); // junk rejected
    expect(edl.targetDuration).toBeLessThanOrEqual(30);
  });

  it('fills a longer reel from just a couple of long clips via multi-clip extraction', () => {
    const a = clip('clip_01', Array.from({ length: 50 }, (_, i) => win(i)));
    const b = clip('clip_02', Array.from({ length: 50 }, (_, i) => win(i)));
    const edl = buildReel([a, b], 'auto', { lengthMin: 30, lengthMax: 90 });

    // 2 source clips → 2 timeline entries per clip (a second moment mined from each) = 4 total.
    expect(edl.timeline.length).toBe(4);
    const clip01Entries = edl.timeline.filter((t) => t.clipId === 'clip_01');
    expect(clip01Entries.length).toBe(2);
    expect(clip01Entries[0].in).toBeLessThan(clip01Entries[1].in); // chronological, not overlapping
    expect(clip01Entries[0].out).toBeLessThanOrEqual(clip01Entries[1].in);
  });
});
