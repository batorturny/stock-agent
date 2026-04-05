import type { Env } from "../types";

export type RiskLevel = "conservative" | "balanced" | "aggressive";

export type RiskConfig = {
  label: string;
  labelHu: string;
  stopLossPct: number;
  takeProfitPct: number;
  maxCashPct: number;
  minCashReservePct: number;
  maxSinglePositionPct: number;
  maxPositions: number;
  minConfidence: number;
  minHoldHours: number;
};

const RISK_PROFILES: Record<RiskLevel, RiskConfig> = {
  conservative: {
    label: "Conservative",
    labelHu: "Konzervatív",
    stopLossPct: -0.03,
    takeProfitPct: 0.08,
    maxCashPct: 0.25,
    minCashReservePct: 0.15,
    maxSinglePositionPct: 0.12,
    maxPositions: 12,
    minConfidence: 0.70,
    minHoldHours: 168,
  },
  balanced: {
    label: "Balanced",
    labelHu: "Kiegyensúlyozott",
    stopLossPct: -0.05,
    takeProfitPct: 0.12,
    maxCashPct: 0.15,
    minCashReservePct: 0.08,
    maxSinglePositionPct: 0.18,
    maxPositions: 8,
    minConfidence: 0.60,
    minHoldHours: 72,
  },
  aggressive: {
    label: "Aggressive",
    labelHu: "Agresszív",
    stopLossPct: -0.08,
    takeProfitPct: 0.20,
    maxCashPct: 0.10,
    minCashReservePct: 0.05,
    maxSinglePositionPct: 0.25,
    maxPositions: 6,
    minConfidence: 0.50,
    minHoldHours: 48,
  },
};

const VALID_RISK_LEVELS = new Set<string>(["conservative", "balanced", "aggressive"]);

export async function getRiskProfile(env: Env): Promise<RiskConfig> {
  // Check KV first for user-configured override
  const kvLevel = await env.CACHE.get("setting:risk_profile");
  if (kvLevel && VALID_RISK_LEVELS.has(kvLevel)) {
    return RISK_PROFILES[kvLevel as RiskLevel];
  }
  // Fall back to env var or default
  const level = (env.RISK_PROFILE || "balanced") as RiskLevel;
  return RISK_PROFILES[level] || RISK_PROFILES.balanced;
}

export async function getRiskLevel(env: Env): Promise<RiskLevel> {
  const kvLevel = await env.CACHE.get("setting:risk_profile");
  if (kvLevel && VALID_RISK_LEVELS.has(kvLevel)) {
    return kvLevel as RiskLevel;
  }
  const level = env.RISK_PROFILE || "balanced";
  return VALID_RISK_LEVELS.has(level) ? (level as RiskLevel) : "balanced";
}

export function getRiskProfiles(): Record<RiskLevel, RiskConfig> {
  return RISK_PROFILES;
}

export function isValidRiskLevel(level: string): level is RiskLevel {
  return VALID_RISK_LEVELS.has(level);
}
