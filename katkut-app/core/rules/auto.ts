import { AnalysisClip, AnalysisWindow } from '../types';
import { AUTO, VibeConfig } from '../vibes';import { bestSegment, ClipCandidate, windowScore } from '../scoring';
import { VibeRule, VibeRunParams } from './types';

/**
 * AUTO — AI Smart Default.
 * Goal: a balanced, steady reel that cuts on natural rhythm and audio spikes, and adapts to
 * how much footage is actually available.
 *
 * Uses only signals we measure today (blur, exposure, frozen, sceneCuts, audioRMS, duration):
 *  - Selection: throw away clips with no usable moment (all blurry / pitch-black / frozen).
 *  - Cuts:      land segment out-points on a nearby scene cut, else just after an audio spike.
 *  - Pacing:    segment lengths scale with the chosen total length (short reel → snappy cuts),
 *               AND with how many clips there are — few clips + a long target hold each clip
 *               longer instead of making rapid-fire short cuts that fall far short of the target.
 *  - Extraction: a long (40s+) source clip gets a SECOND non-overlapping segment mined out of it
 *               when there still isn't enough footage to reach the target even at wider pacing.
 */

// --- tunables (revisit during validation) ---
const REJECT_BLUR = 0.72; // a window blurrier than this is unusable
const REJECT_DARK = 0.08; // exposure below this is ~pitch black
const REJECT_BRIGHT = 0.97; // exposure above this is blown out
const AUDIO_SPIKE_DB = 6; // a window this many dB above the segment mean counts as a spike

/** Segment length used when clips are scarce relative to the chosen target (see pacingForLength). */
const FEW_CLIPS_MIN_SEGMENT = 6.0;
const FEW_CLIPS_MAX_SEGMENT = 9.0;

/**
 * Segment pacing by chosen total length: short reels cut fast, long reels hold longer.
 * NOTE: analysis windows are 1s, so segments are ~1s-quantized at selection — ranges below are
 * chosen to be achievable at that granularity (sub-second pacing like 1.2–1.8s would need
 * sub-window trimming, a later enhancement). The long end (4–6s) is exact.
 *
 * `clipCount` (optional — omitted by direct resolveConfig() calls, e.g. in tests, that don't care
 * about this): when there are so few clips that even the longest segment from every one of them
 * would land well short of the target (e.g. a 30–60s target from just 5–6 uploads), rapid short
 * cuts would leave the reel far under length for no reason — hold each clip longer instead.
 */
function pacingForLength(maxLen: number, clipCount?: number): { minSegment: number; maxSegment: number } {
  const base = baselinePacing(maxLen);
  if (clipCount != null && clipCount > 0 && clipCount * base.maxSegment < maxLen) {
    return { minSegment: FEW_CLIPS_MIN_SEGMENT, maxSegment: FEW_CLIPS_MAX_SEGMENT };
  }
  return base;
}

function baselinePacing(maxLen: number): { minSegment: number; maxSegment: number } {
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

// Cut on natural rhythm: snap the out-point to a scene cut in range (closest to the natural
// out), otherwise to the end of the loudest audio "spike" window in range. `hardCeiling`
// (optional) further caps how far out can be pushed — used when mining a second segment out of
// the same clip, so refining the earlier one can never snap forward into the later one's territory.
function refineOut(
  clip: AnalysisClip,
  cand: ClipCandidate,
  cfg: VibeConfig,
  hardCeiling?: number,
): ClipCandidate {
  const minOut = cand.in + cfg.minSegment;
  const maxOut = Math.min(cand.in + cfg.maxSegment, clip.duration || cand.out, hardCeiling ?? Infinity);
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
}

/** A source clip at least this long is worth mining for a SECOND moment when footage is scarce. */
const MULTI_EXTRACT_MIN_SOURCE_DURATION = 40;
/** Keep the two extracted segments from visibly touching. */
const MULTI_EXTRACT_GAP = 2;

/** True when even the resolved pacing's longest segment, taken from every available clip, would
 *  land well short of the chosen length — i.e. there just isn't enough footage overall. */
function needsMoreMaterial(clipCount: number, cfg: VibeConfig): boolean {
  return clipCount > 0 && clipCount * cfg.maxSegment < cfg.maxDuration;
}

function clipDuration(clip: AnalysisClip): number {
  return clip.duration > 0 ? clip.duration : (clip.windows[clip.windows.length - 1]?.end ?? 0);
}

/**
 * Clip → one or two FINAL (refined) candidates. Always takes the best segment first; if the
 * source is long enough (40s+) AND the available clips overall can't reach the target length even
 * at the current pacing, it also mines a second, non-overlapping segment from the remainder of
 * the SAME clip — "Multi-Clip Extraction" — so a handful of long uploads can still fill a longer
 * reel instead of leaving it far short. Returned in source-chronological order (we have no
 * cross-clip capture time, but within one clip the source timeline itself is exact).
 */
function extractClipSegments(clip: AnalysisClip, cfg: VibeConfig, clipCount: number): ClipCandidate[] {
  const first = bestSegment(clip, cfg);
  if (!first) return [];
  const refinedFirst = refineOut(clip, first, cfg);

  if (clipDuration(clip) < MULTI_EXTRACT_MIN_SOURCE_DURATION || !needsMoreMaterial(clipCount, cfg)) {
    return [refinedFirst];
  }

  const excludeIn = refinedFirst.in - MULTI_EXTRACT_GAP;
  const excludeOut = refinedFirst.out + MULTI_EXTRACT_GAP;
  const second = bestSegment(clip, cfg, { in: excludeIn, out: excludeOut });
  if (!second) return [refinedFirst];

  // A candidate found BEFORE the excluded zone could still have its out-point refined forward
  // into the gap (refineOut only ever moves out later) — cap it there. One found AFTER is already
  // safe: extending its out-point further forward can never reach back across an earlier gap.
  const refinedSecond =
    second.in < refinedFirst.in ? refineOut(clip, second, cfg, excludeIn) : refineOut(clip, second, cfg);

  return [refinedFirst, refinedSecond].sort((a, b) => a.in - b.in);
}

export const autoRule: VibeRule = {
  id: 'auto',

  resolveConfig(params: VibeRunParams): VibeConfig {
    const pace = pacingForLength(params.lengthMax, params.clipCount);
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

  refineSegment(clip: AnalysisClip, cand: ClipCandidate, cfg: VibeConfig): ClipCandidate {
    return refineOut(clip, cand, cfg);
  },

  extractSegments(clip: AnalysisClip, cfg: VibeConfig, clipCount: number): ClipCandidate[] {
    return extractClipSegments(clip, cfg, clipCount);
  },
};
