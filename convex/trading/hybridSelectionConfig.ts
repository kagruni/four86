export interface HybridSelectionRules {
  hybridScoreFloor: number;
  hybridFourHourTrendThresholdPct: number;
  hybridExtremeRsi7Block: number;
  hybridMinChopVolumeRatio: number;
  hybridChopDistanceFromEmaPct: number;
}

export const DEFAULT_HYBRID_SELECTION_RULES: HybridSelectionRules = {
  hybridScoreFloor: 64,
  hybridFourHourTrendThresholdPct: 0.75,
  hybridExtremeRsi7Block: 25,
  hybridMinChopVolumeRatio: 0.8,
  hybridChopDistanceFromEmaPct: 0.25,
};

export function resolveHybridSelectionRules(
  config?: Partial<HybridSelectionRules> | null
): HybridSelectionRules {
  return {
    hybridScoreFloor:
      config?.hybridScoreFloor ?? DEFAULT_HYBRID_SELECTION_RULES.hybridScoreFloor,
    hybridFourHourTrendThresholdPct:
      config?.hybridFourHourTrendThresholdPct ??
      DEFAULT_HYBRID_SELECTION_RULES.hybridFourHourTrendThresholdPct,
    hybridExtremeRsi7Block:
      config?.hybridExtremeRsi7Block ??
      DEFAULT_HYBRID_SELECTION_RULES.hybridExtremeRsi7Block,
    hybridMinChopVolumeRatio:
      config?.hybridMinChopVolumeRatio ??
      DEFAULT_HYBRID_SELECTION_RULES.hybridMinChopVolumeRatio,
    hybridChopDistanceFromEmaPct:
      config?.hybridChopDistanceFromEmaPct ??
      DEFAULT_HYBRID_SELECTION_RULES.hybridChopDistanceFromEmaPct,
  };
}
