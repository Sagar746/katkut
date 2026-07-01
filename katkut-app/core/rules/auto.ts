import { AnalysisClip, AnalysisWindow } from '../types';
import { AUTO, VibeConfig } from '../vibes';
import { ClipCandidate, windowScore } from '../scoring';
import { VibeRule, VibeRunParams } from './types';

/**
 * AUTO — AI Smart Default.
 * Goal: a balanced, steady reel that cuts on natural rhythm and audio spikes.
 *
 * Uses only signals we measure today (blur, exposure, frozen, sceneCuts, audioRMS, duration):
 *  - Selection: throw away clips with no usable moment (all blurry / pitch-black / frozen).
 *  - Cuts:      land segment out-points on a nearby scene cut, else just after an audio spike.
 *  - Pacing:    segment lengths scale with the chosen total length (short reel → snappy cuts).
 */

// --- tunables (revisit during validation) ---
const REJECT_BLUR = 0.72; // a window blurrier than this is unusable
const REJECT_DARK = 0.08; // exposure below this is ~pitch black
const REJECT_BRIGHT = 0.97; // exposure above this is blown out
const AUDIO_SPIKE_DB = 6; // a window this many dB above the segment mean counts as a spike

/**
 * Segment pacing by chosen total length: short reels cut fast, long reels hold longer.
 * NOTE: analysis windows are 1s, so segments are ~1s-quantized at selection — ranges below are
 * chosen to be achievable at that granularity (sub-second pacing like 1.2–1.8s would need
 * sub-window trimming, a later enhancement). The long end (4–6s) is exact.
 */
function pacingForLength(maxLen: number): { minSegment: number; maxSegment: number } {
  if (maxLen <= 30) return { minSegment: 1.0, maxSegment: 2.0 };
  if (maxLen <= 60) return { minSegment: 1.5, maxSegment: 3.0 };
  if (maxLen <= 90) return { minSegment: 2.0, maxSegment: 4.0 };
  if (maxLen <= 120) return { minSegment: 3.0, maxSegment: 5.0 };
  return { minSegment: 4.0, maxSegment: 6.0 }; // 120s+
}

function usableWindow(w: AnalysisWindow): boolean {
  return !w.frozen && w.blur < REJECT_BLUR && w.exposure > REJECT_DARK && w.exposure < REJECT_BRIGHT;
}

/** Duration-weighted score + mean audio over an arbitrary [inSec, outSec] sub-range. */
function statsOver(
  clip: AnalysisClip,
  cfg: VibeConfig,
  inSec: number,
  outSec: number,
): { score: number; meanAudioRMS: number } | null {
  let sumScoreDur = 0;
  let sumAudioDur = 0;
  let dur = 0;
  for (const w of clip.windows) {
    const lo = Math.max(w.start, inSec);
    const hi = Math.min(w.end, outSec);
    const d = hi - lo;
    if (d > 0) {
      sumScoreDur += windowScore(w, cfg) * d;
      sumAudioDur += w.audioRMS * d;
      dur += d;
    }
  }
  if (dur <= 0) return null;
  return { score: sumScoreDur / dur, meanAudioRMS: sumAudioDur / dur };
}

export const autoRule: VibeRule = {
  id: 'auto',

  resolveConfig(params: VibeRunParams): VibeConfig {
    const pace = pacingForLength(params.lengthMax);
    return {
      ...AUTO,
      minDuration: params.lengthMin,
      maxDuration: params.lengthMax,
      minSegment: pace.minSegment,
      maxSegment: pace.maxSegment,
      // Balanced, with a real audio voice (Auto cuts on loudness) and a firm anti-freeze penalty.
      weights: { sharp: 1.0, exposure: 0.6, frozenPenalty: 1.6, audio: 0.4 },
    };
  },

  // Throw away clips with no usable moment at all (every window blurry / dark / blown / frozen).
  rejectClip(clip: AnalysisClip): boolean {
    if (clip.windows.length === 0) return true;
    return !clip.windows.some(usableWindow);
  },

  // Cut on natural rhythm: snap the out-point to a scene cut in range (closest to the natural
  // out), otherwise to the end of the loudest audio "spike" window in range.
  refineSegment(clip: AnalysisClip, cand: ClipCandidate, cfg: VibeConfig): ClipCandidate {
    const minOut = cand.in + cfg.minSegment;
    const maxOut = Math.min(cand.in + cfg.maxSegment, clip.duration || cand.out);
    if (maxOut <= minOut) return cand;

    let out = cand.out;

    const sceneOpts = clip.sceneCuts.filter((t) => t >= minOut && t <= maxOut);
    if (sceneOpts.length > 0) {
      // closest scene cut to where the segment naturally ended
      out = sceneOpts.reduce(
        (best, t) => (Math.abs(t - cand.out) < Math.abs(best - cand.out) ? t : best),
        sceneOpts[0],
      );
    } else {
      // cut just after the loudest window in range, if it's a genuine spike
      const inRange = clip.windows.filter((w) => w.end > minOut && w.start < maxOut);
      if (inRange.length > 0) {
        const mean = inRange.reduce((a, w) => a + w.audioRMS, 0) / inRange.length;
        const spike = inRange.reduce((a, w) => (w.audioRMS > a.audioRMS ? w : a), inRange[0]);
        if (spike.audioRMS - mean >= AUDIO_SPIKE_DB) {
          out = Math.min(spike.end, maxOut);
        }
      }
    }

    out = Math.max(minOut, Math.min(out, maxOut));
    if (Math.abs(out - cand.out) < 1e-6) return cand;

    const stats = statsOver(clip, cfg, cand.in, out);
    return stats ? { ...cand, out, score: stats.score, meanAudioRMS: stats.meanAudioRMS } : { ...cand, out };
  },
};
