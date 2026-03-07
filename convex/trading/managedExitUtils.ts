export const MANAGED_EXIT_MODE = "managed_scalp_v2" as const;
export const LEGACY_EXIT_MODE = "legacy" as const;

export type ManagedExitMode = typeof MANAGED_EXIT_MODE | typeof LEGACY_EXIT_MODE;

export interface ManagedExitRules {
  managedExitEnabled: boolean;
  managedExitHardStopLossPct: number;
  managedExitBreakEvenTriggerPct: number;
  managedExitBreakEvenLockProfitPct: number;
  managedExitTrailingTriggerPct: number;
  managedExitTrailingDistancePct: number;
  managedExitTightenTriggerPct: number;
  managedExitTightenedDistancePct: number;
  managedExitStaleMinutes: number;
  managedExitStaleMinProfitPct: number;
  managedExitMaxHoldMinutes: number;
}

export const DEFAULT_MANAGED_EXIT_RULES: ManagedExitRules = {
  managedExitEnabled: false,
  managedExitHardStopLossPct: 1.5,
  managedExitBreakEvenTriggerPct: 0.7,
  managedExitBreakEvenLockProfitPct: 0.08,
  managedExitTrailingTriggerPct: 0.5,
  managedExitTrailingDistancePct: 0.25,
  managedExitTightenTriggerPct: 1.0,
  managedExitTightenedDistancePct: 0.2,
  managedExitStaleMinutes: 20,
  managedExitStaleMinProfitPct: 0.2,
  managedExitMaxHoldMinutes: 180,
};

export function getManagedExitRules(config: Partial<ManagedExitRules> | null | undefined): ManagedExitRules {
  return {
    managedExitEnabled: config?.managedExitEnabled ?? DEFAULT_MANAGED_EXIT_RULES.managedExitEnabled,
    managedExitHardStopLossPct: config?.managedExitHardStopLossPct ?? DEFAULT_MANAGED_EXIT_RULES.managedExitHardStopLossPct,
    managedExitBreakEvenTriggerPct: config?.managedExitBreakEvenTriggerPct ?? DEFAULT_MANAGED_EXIT_RULES.managedExitBreakEvenTriggerPct,
    managedExitBreakEvenLockProfitPct: config?.managedExitBreakEvenLockProfitPct ?? DEFAULT_MANAGED_EXIT_RULES.managedExitBreakEvenLockProfitPct,
    managedExitTrailingTriggerPct: config?.managedExitTrailingTriggerPct ?? DEFAULT_MANAGED_EXIT_RULES.managedExitTrailingTriggerPct,
    managedExitTrailingDistancePct: config?.managedExitTrailingDistancePct ?? DEFAULT_MANAGED_EXIT_RULES.managedExitTrailingDistancePct,
    managedExitTightenTriggerPct: config?.managedExitTightenTriggerPct ?? DEFAULT_MANAGED_EXIT_RULES.managedExitTightenTriggerPct,
    managedExitTightenedDistancePct: config?.managedExitTightenedDistancePct ?? DEFAULT_MANAGED_EXIT_RULES.managedExitTightenedDistancePct,
    managedExitStaleMinutes: config?.managedExitStaleMinutes ?? DEFAULT_MANAGED_EXIT_RULES.managedExitStaleMinutes,
    managedExitStaleMinProfitPct: config?.managedExitStaleMinProfitPct ?? DEFAULT_MANAGED_EXIT_RULES.managedExitStaleMinProfitPct,
    managedExitMaxHoldMinutes: config?.managedExitMaxHoldMinutes ?? DEFAULT_MANAGED_EXIT_RULES.managedExitMaxHoldMinutes,
  };
}

export function isManagedExitPosition(position: { exitMode?: string | null } | null | undefined): boolean {
  return position?.exitMode === MANAGED_EXIT_MODE;
}

export function calculateHardStopPrice(entryPrice: number, side: "LONG" | "SHORT", stopLossPct: number): number {
  return side === "LONG"
    ? entryPrice * (1 - stopLossPct / 100)
    : entryPrice * (1 + stopLossPct / 100);
}

export function clampManagedStop(
  side: "LONG" | "SHORT",
  aiStop: number | undefined,
  configuredStop: number
): number {
  if (!aiStop || !Number.isFinite(aiStop)) {
    return configuredStop;
  }

  return side === "LONG"
    ? Math.max(aiStop, configuredStop)
    : Math.min(aiStop, configuredStop);
}

export function getBreakEvenStopPrice(entryPrice: number, side: "LONG" | "SHORT", lockProfitPct: number): number {
  return side === "LONG"
    ? entryPrice * (1 + lockProfitPct / 100)
    : entryPrice * (1 - lockProfitPct / 100);
}

export function getTrailingStopPrice(referencePrice: number, side: "LONG" | "SHORT", distancePct: number): number {
  return side === "LONG"
    ? referencePrice * (1 - distancePct / 100)
    : referencePrice * (1 + distancePct / 100);
}

export function tightenManagedStop(
  side: "LONG" | "SHORT",
  previousStop: number | undefined,
  nextStops: Array<number | undefined>
): number | undefined {
  const validStops = nextStops.filter((stop): stop is number => typeof stop === "number" && Number.isFinite(stop));
  if (validStops.length === 0 && previousStop === undefined) {
    return undefined;
  }

  if (side === "LONG") {
    return validStops.reduce(
      (effective, stop) => Math.max(effective, stop),
      previousStop ?? Number.NEGATIVE_INFINITY
    );
  }

  return validStops.reduce(
    (effective, stop) => Math.min(effective, stop),
    previousStop ?? Number.POSITIVE_INFINITY
  );
}

export function hasStopBeenCrossed(side: "LONG" | "SHORT", currentPrice: number, stopPrice: number): boolean {
  return side === "LONG" ? currentPrice <= stopPrice : currentPrice >= stopPrice;
}

export function getManagedPeakPrice(
  side: "LONG" | "SHORT",
  previousPeak: number | undefined,
  currentPrice: number
): number {
  if (previousPeak === undefined || !Number.isFinite(previousPeak)) {
    return currentPrice;
  }

  return side === "LONG"
    ? Math.max(previousPeak, currentPrice)
    : Math.min(previousPeak, currentPrice);
}

export function formatManagedExitReason(reason: string): string {
  return `RULE_EXIT: ${reason}`;
}
