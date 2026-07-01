import { AnalysisClip, AnalysisWindow } from '../types';
import { MINI_VLOG, VibeConfig } from '../vibes';
import { ClipCandidate, windowScore } from '../scoring';
import { VibeRule, VibeRunParams } from './types';

/**
 * MINI VLOG — Clock-like Ticking Rhythm.
 * Goal: a consistent, snappy, metronomic pace. Every cut is the SAME length, so the reel ticks
 * along like a clock (tick-tick-tick), 1–2s per clip.
 *
 * Character (vs Auto/Travel/Food):
 *  - UNIFORM segments. We deliberately do NOT snap to scene cuts or audio here — those make lengths
 *    vary, which would break the metronome. Instead every clip is forced to one fixed "beat".
 *  - Audio is IGNORED (weight 0, no audio-based cutting): the rhythm comes from equal spacing, not
 *    from the soundtrack.
 *  - Firm freeze penalty: a snappy vlog wants lively frames, so static/duplicate junk is punished.
 *
 * The beat is the MIDPOINT of the segment range (see pacingForLength). refineSegment forces every
 * segment to exactly that midpoint, so the whole reel shares one tick length.
 */

// --- tunables (revisit during validation) ---
const REJECT_BLUR = 0.72; // a window blurrier than this is unusable
const REJECT_DARK = 0.08; // exposure below this is ~pitch black
const REJECT_BRIGHT = 0.97; // exposure above this is blown out

/**
 * Segment pacing by chosen total length: short reels tick a touch faster, long reels a touch slower,
 * always within the 1–2s band. The BEAT every clip is forced to is the midpoint of the range.
 * NOTE: 1s analysis windows mean bestSegment can only find whole-second segments, so each range is
 * chosen to CONTAIN a whole second (1.0 or 2.0) — otherwise bestSegment would find nothing. The
 * exact, uniform beat then comes from refineSegment snapping to the midpoint.
 */
function pacingForLength(maxLen: number): { minSegment: number; maxSegment: number } {
  if (maxLen <= 30) return { minSegment: 1.0, maxSegment: 1.5 }; // beat 1.25s
  if (maxLen <= 90) return { minSegment: 1.0, maxSegment: 2.0 }; // beat 1.5s
  return { minSegment: 1.5, maxSegment: 2.0 }; // beat 1.75s — 90s+
}

/** The uniform tick length: the midpoint of the segment range. */
function beatOf(cfg: VibeConfig): number {
  return (cfg.minSegment + cfg.maxSegment) / 2;
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

export const miniVlogRule: VibeRule = {
  id: 'mini_vlog',

  resolveConfig(params: VibeRunParams): VibeConfig {
    const pace = pacingForLength(params.lengthMax);
    return {
      ...MINI_VLOG,
      minDuration: params.lengthMin,
      maxDuration: params.lengthMax,
      minSegment: pace.minSegment,
      maxSegment: pace.maxSegment,
      // Sharp, lively frames; audio plays no part in the rhythm (weight 0); firm anti-freeze.
      weights: { sharp: 1.2, exposure: 0.6, frozenPenalty: 1.8, audio: 0 },
    };
  },

  // Standard junk rejection: no usable (sharp, well-lit, moving) moment → drop the clip.
  rejectClip(clip: AnalysisClip): boolean {
    if (clip.windows.length === 0) return true;
    return !clip.windows.some(usableWindow);
  },

  // Force the metronome: every segment is exactly one beat long, ignoring scene cuts and audio.
  refineSegment(clip: AnalysisClip, cand: ClipCandidate, cfg: VibeConfig): ClipCandidate {
    const beat = beatOf(cfg);
    const maxOut = clip.duration || cand.out;
    const out = Math.min(cand.in + beat, maxOut); // clamp only if the clip runs out of footage
    if (out <= cand.in || Math.abs(out - cand.out) < 1e-6) return cand;

    const stats = statsOver(clip, cfg, cand.in, out);
    return stats ? { ...cand, out, score: stats.score, meanAudioRMS: stats.meanAudioRMS } : { ...cand, out };
  },
};
