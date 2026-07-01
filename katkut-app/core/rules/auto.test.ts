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

describe('buildReel (auto end-to-end)', () => {
  it('drops junk clips and produces an EDL within the chosen length', () => {
    const good = clip('clip_01', Array.from({ length: 6 }, (_, i) => win(i, { blur: 0.1 })));
    const junk = clip('clip_02', [win(0, { blur: 0.95 }), win(1, { frozen: true, blur: 0.95 })]);
    const edl = buildReel([good, junk], 'auto', { lengthMin: 0, lengthMax: 30 });

    expect(edl.timeline.length).toBeGreaterThan(0);
    expect(edl.timeline.every((t) => t.clipId !== 'clip_02')).toBe(true); // junk rejected
    expect(edl.targetDuration).toBeLessThanOrEqual(30);
  });
});
