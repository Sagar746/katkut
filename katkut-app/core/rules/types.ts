import { AnalysisClip } from '../types';
import { VibeConfig } from '../vibes';
import { ClipCandidate } from '../scoring';

/** What the user chose on the options screen, fed into every vibe rule. */
export interface VibeRunParams {
  /** target reel length range, seconds (from the options screen). */
  lengthMin: number;
  lengthMax: number;
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
}
