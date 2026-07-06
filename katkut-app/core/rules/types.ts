import { AnalysisClip } from '../types';
import { VibeConfig } from '../vibes';
import { ClipCandidate } from '../scoring';

/** What the user chose on the options screen, fed into every vibe rule. */
export interface VibeRunParams {
  /** target reel length range, seconds (from the options screen). */
  lengthMin: number;
  lengthMax: number;
  /**
   * Source clips that survived `rejectClip`, filled in by `buildReel` (not the caller) before
   * `resolveConfig` runs. Optional so existing call sites/tests that don't care are unaffected.
   * Lets a rule (e.g. Auto) adapt pacing to how much footage is actually available.
   */
  clipCount?: number;
}

/**
 * One vibe's editing logic. Each vibe lives in its own file (auto.ts, food.ts, …) and
 * implements this contract; the shared engine in `core/rules/index.ts` drives them.
 */
export interface VibeRule {
  id: string;

  /** Scoring/pacing config for this run. Pacing (segment lengths) and clamps may depend on
   *  the user's chosen length, so this is computed per run rather than being a static config. */
  resolveConfig(params: VibeRunParams): VibeConfig;

  /** Hard reject a whole clip BEFORE scoring (e.g. nothing usable — all blurry / dark / frozen). */
  rejectClip(clip: AnalysisClip): boolean;

  /** Adjust the chosen segment to land on natural cut points (scene cuts / audio spikes, etc.). */
  refineSegment(clip: AnalysisClip, candidate: ClipCandidate, cfg: VibeConfig): ClipCandidate;

  /**
   * Optional full override of the per-clip candidate pipeline: clip → one or more FINAL (already
   * refined) candidates. When present, the shared engine (`buildReel`) uses this INSTEAD of
   * bestSegment→refineSegment for this clip. Used by Auto to mine a second segment out of a long
   * source clip when there isn't enough footage overall to reach the chosen length otherwise.
   */
  extractSegments?(clip: AnalysisClip, cfg: VibeConfig, clipCount: number): ClipCandidate[];
}
