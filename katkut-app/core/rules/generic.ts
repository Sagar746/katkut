import { VibeConfig } from '../vibes';
import { ClipCandidate } from '../scoring';
import { VibeRule, VibeRunParams } from './types';

/**
 * Default rule for vibes that don't have dedicated logic yet. Uses the vibe's own VibeConfig,
 * applies the user's length range, no hard-reject, no cut refinement — i.e. the original
 * generic behavior. Each vibe gets its own file/rule over time (auto.ts first).
 */
export function makeGenericRule(cfg: VibeConfig): VibeRule {
  return {
    id: cfg.id,
    resolveConfig(params: VibeRunParams): VibeConfig {
      return { ...cfg, minDuration: params.lengthMin, maxDuration: params.lengthMax };
    },
    rejectClip(): boolean {
      return false;
    },
    refineSegment(_clip, candidate: ClipCandidate): ClipCandidate {
      return candidate;
    },
  };
}
