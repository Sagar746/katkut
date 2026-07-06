import { AnalysisClip, Edl, PhotoRef } from '../types';
import { VIBES, AUTO } from '../vibes';
import { bestSegment, ClipCandidate } from '../scoring';
import { assembleEdl, appendPhotos } from '../selection';
import { VibeRule, VibeRunParams } from './types';
import { autoRule } from './auto';
import { foodRule } from './food';
import { travelRule } from './travel';
import { miniVlogRule } from './mini_vlog';
import { unboxingRule } from './unboxing';
import { makeGenericRule } from './generic';

export type { VibeRule, VibeRunParams } from './types';

// Vibes with dedicated logic. Others fall back to the generic rule using their VibeConfig.
const RULES: Record<string, VibeRule> = {
  auto: autoRule,
  food_cooking: foodRule,
  travel_adventure: travelRule,
  mini_vlog: miniVlogRule,
  unboxing: unboxingRule,
};

export function getVibeRule(vibeId: string): VibeRule {
  return RULES[vibeId] ?? makeGenericRule(VIBES[vibeId] ?? AUTO);
}

/**
 * Build the reel for a vibe + the user's length choice, applying that vibe's rules:
 * hard-reject junk clips → best segment per clip → refine its cut points → assemble the EDL.
 * Any photos are appended last as fixed 0.5s stills (not scored or clamped) — see appendPhotos.
 *
 * A rule may implement `extractSegments` to produce MORE than one candidate from a single clip
 * (e.g. Auto mining a second moment out of a long source clip when footage is scarce) — see
 * VibeRule.extractSegments. Rules without it keep the original one-candidate-per-clip behavior.
 */
export function buildReel(
  analyses: AnalysisClip[],
  vibeId: string,
  params: VibeRunParams,
  photos: PhotoRef[] = [],
): Edl {
  const rule = getVibeRule(vibeId);
  const eligible = analyses.filter((clip) => !rule.rejectClip(clip));
  const cfg = rule.resolveConfig({ ...params, clipCount: eligible.length });

  const candidates: ClipCandidate[] = eligible.flatMap((clip) => {
    if (rule.extractSegments) return rule.extractSegments(clip, cfg, eligible.length);
    const cand = bestSegment(clip, cfg);
    return cand ? [rule.refineSegment(clip, cand, cfg)] : [];
  });

  return appendPhotos(assembleEdl(candidates, cfg), photos);
}
