export interface HybridSelectionRules {
  hybridScoreFloor: number;
  hybridFourHourTrendThresholdPct: number;
  hybridExtremeRsi7Block: number;
  hybridMinChopVolumeRatio: number;
  hybridChopDistanceFromEmaPct: number;
}

export const DEFAULT_HYBRID_SELECTION_RULES: HybridSelectionRules = {
  hybridScoreFloor: 42,
  hybridFourHourTrendThresholdPct: 0.75,
  hybridExtremeRsi7Block: 25,
  hybridMinChopVolumeRatio: 0.6,
  hybridChopDistanceFromEmaPct: 0.25,
};

const LEGACY_HYBRID_SCORE_FLOORS = new Set([60, 64]);
const LEGACY_HYBRID_MIN_CHOP_VOLUME_RATIO = 0.8;

function normalizeHybridScoreFloor(
  hybridScoreFloor: number | null | undefined
): number {
  if (
    hybridScoreFloor == null ||
    LEGACY_HYBRID_SCORE_FLOORS.has(hybridScoreFloor)
  ) {
    return DEFAULT_HYBRID_SELECTION_RULES.hybridScoreFloor;
  }

  return hybridScoreFloor;
}

function normalizeHybridMinChopVolumeRatio(
  hybridMinChopVolumeRatio: number | null | undefined
): number {
  if (
    hybridMinChopVolumeRatio == null ||
    hybridMinChopVolumeRatio === LEGACY_HYBRID_MIN_CHOP_VOLUME_RATIO
  ) {
    return DEFAULT_HYBRID_SELECTION_RULES.hybridMinChopVolumeRatio;
  }

  return hybridMinChopVolumeRatio;
}

export function normalizeHybridSelectionConfig<
  T extends {
    hybridScoreFloor?: number | null;
    hybridMinChopVolumeRatio?: number | null;
  },
>(config: T): Omit<T, "hybridScoreFloor" | "hybridMinChopVolumeRatio"> & {
  hybridScoreFloor: number;
  hybridMinChopVolumeRatio: number;
} {
  return {
    ...config,
    hybridScoreFloor: normalizeHybridScoreFloor(config.hybridScoreFloor),
    hybridMinChopVolumeRatio: normalizeHybridMinChopVolumeRatio(
      config.hybridMinChopVolumeRatio
    ),
  };
}

export function needsHybridSelectionDefaultsMigration(config: {
  useHybridSelection?: boolean | null;
  hybridScoreFloor?: number | null;
  hybridMinChopVolumeRatio?: number | null;
}): boolean {
  if (!config.useHybridSelection) {
    return false;
  }

  return (
    config.hybridScoreFloor == null ||
    LEGACY_HYBRID_SCORE_FLOORS.has(config.hybridScoreFloor) ||
    config.hybridMinChopVolumeRatio == null ||
    config.hybridMinChopVolumeRatio === LEGACY_HYBRID_MIN_CHOP_VOLUME_RATIO
  );
}

export function resolveHybridSelectionRules(
  config?: Partial<HybridSelectionRules> | null
): HybridSelectionRules {
  const normalized = normalizeHybridSelectionConfig({
    hybridScoreFloor: config?.hybridScoreFloor,
    hybridMinChopVolumeRatio: config?.hybridMinChopVolumeRatio,
  });

  return {
    hybridScoreFloor: normalized.hybridScoreFloor,
    hybridFourHourTrendThresholdPct:
      config?.hybridFourHourTrendThresholdPct ??
      DEFAULT_HYBRID_SELECTION_RULES.hybridFourHourTrendThresholdPct,
    hybridExtremeRsi7Block:
      config?.hybridExtremeRsi7Block ??
      DEFAULT_HYBRID_SELECTION_RULES.hybridExtremeRsi7Block,
    hybridMinChopVolumeRatio: normalized.hybridMinChopVolumeRatio,
    hybridChopDistanceFromEmaPct:
      config?.hybridChopDistanceFromEmaPct ??
      DEFAULT_HYBRID_SELECTION_RULES.hybridChopDistanceFromEmaPct,
  };
}
