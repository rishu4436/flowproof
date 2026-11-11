import { formatUsdMicros, parseUsdToMicros } from "./money.js";

export interface CostRow {
  costUsd: string | null;
}

export interface CostAggregate {
  knownUsd: string;
  knownCount: number;
  unknownCount: number;
  requestCount: number;
}

export function aggregateCost(rows: CostRow[]): CostAggregate {
  let micros = 0n;
  let knownCount = 0;
  let unknownCount = 0;
  for (const row of rows) {
    if (row.costUsd == null || row.costUsd === "") {
      unknownCount += 1;
      continue;
    }
    const parsed = parseUsdToMicros(row.costUsd);
    if (parsed == null) {
      unknownCount += 1;
      continue;
    }
    micros += parsed;
    knownCount += 1;
  }
  return {
    knownUsd: formatUsdMicros(micros),
    knownCount,
    unknownCount,
    requestCount: rows.length,
  };
}

export function costPerVerified(knownUsd: string, verifiedCount: number): string | null {
  if (verifiedCount <= 0) return null;
  const micros = parseUsdToMicros(knownUsd);
  if (micros == null) return null;
  return formatUsdMicros(micros / BigInt(verifiedCount));
}

export function budgetRemaining(input: {
  spentUsd: string;
  ceilingUsd: number | null;
}): { remainingUsd: string | null; exceeded: boolean } {
  if (input.ceilingUsd == null || !Number.isFinite(input.ceilingUsd)) {
    return { remainingUsd: null, exceeded: false };
  }
  const spent = parseUsdToMicros(input.spentUsd) ?? 0n;
  const ceiling = parseUsdToMicros(input.ceilingUsd.toFixed(6));
  if (ceiling == null) return { remainingUsd: null, exceeded: false };
  const remaining = ceiling - spent;
  return {
    remainingUsd: formatUsdMicros(remaining < 0n ? 0n : remaining),
    exceeded: remaining <= 0n,
  };
}
