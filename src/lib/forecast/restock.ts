import { forecast, type Period } from "./engine";

/**
 * Two-tier restock math (function #1). Every demand number here comes
 * from `forecast()` in ./engine - this file adds no forecasting of its
 * own, only the safety-stock/reorder-point/transfer-split arithmetic on
 * top of it, so restock alerts can never drift from the demand numbers
 * shown in the monthly-demand dashboard (function #3).
 *
 * Safety stock uses a target-service-level model (z-score x demand
 * std-dev x sqrt(lead time)), not a cost-based EOQ model - the brief
 * confirmed unit/holding cost data isn't available yet, so cost-based
 * reorder math isn't attempted here.
 */

/**
 * ASSUMPTION (FLAGGED): vendor lead time per SKU is not yet available -
 * the business said this data will be sent later (see chat, 2026-09-25).
 * Until `vendor_reorder_settings.lead_time_days` is populated for a SKU
 * (or the global default row), this placeholder is used so the restock
 * view can still function instead of being blocked entirely. Every
 * result computed with it is tagged `usedFallbackLeadTime: true` so the
 * UI can visibly flag it rather than presenting it as real data.
 */
export const FALLBACK_LEAD_TIME_DAYS = 14;

/**
 * ASSUMPTION (FLAGGED): there's no data at all on how long an
 * office -> store transfer takes (it's internal logistics, not a vendor
 * lead time, and nobody has given a number). This placeholder assumes
 * transfers are much faster than a vendor order, which is directionally
 * safe (a wrong-but-short transfer lead time makes the store alert fire
 * a little early rather than a lot late) but is still a guess - flagged
 * the same way as the vendor lead time above.
 */
export const FALLBACK_TRANSFER_LEAD_TIME_DAYS = 2;

/**
 * Rational approximation of the inverse standard normal CDF (Peter
 * Acklam's algorithm). Used to turn a target service level (e.g. 0.90)
 * into a z-score for the safety-stock formula, without pulling in a
 * stats dependency for one function.
 */
export function zScoreForServiceLevel(p: number): number {
  const clamped = Math.min(Math.max(p, 1e-6), 1 - 1e-6);

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  let q: number;
  let r: number;

  if (clamped < pLow) {
    q = Math.sqrt(-2 * Math.log(clamped));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (clamped <= 1 - pLow) {
    q = clamped - 0.5;
    r = q * q;
    return (
      (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - clamped));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

export interface DemandStats {
  /** Forecasted units/day, one period ahead - the "current" demand rate. */
  dailyRate: number;
  /** Std-dev of one-step-ahead daily forecast residuals - drives safety stock. */
  dailyStdDev: number;
}

/** Runs the shared engine over a daily history and reduces it to the two numbers restock math needs. */
export function demandStatsFromDaily(dailyHistory: Period[]): DemandStats {
  const result = forecast(dailyHistory, { horizon: 1 });
  const dailyRate = result.forecast[0]?.expected ?? 0;
  return { dailyRate, dailyStdDev: result.residualStdDev };
}

export interface ReorderCalc {
  demandOverLeadTime: number;
  safetyStock: number;
  reorderPoint: number;
  /** Combined stock <= reorderPoint. */
  isLow: boolean;
  suggestedOrderQty: number;
  usedFallbackLeadTime: boolean;
}

/** Shared by both the vendor-level and store-transfer alerts - only the inputs (combined vs. per-store stock/demand, vendor vs. transfer lead time) differ. */
export function computeReorder(
  stats: DemandStats,
  currentStock: number,
  leadTimeDays: number | null,
  targetServiceLevel: number,
  fallbackLeadTimeDays: number,
): ReorderCalc {
  const usedFallbackLeadTime = leadTimeDays == null;
  const effectiveLeadTime = leadTimeDays ?? fallbackLeadTimeDays;
  const z = zScoreForServiceLevel(targetServiceLevel);

  const demandOverLeadTime = stats.dailyRate * effectiveLeadTime;
  const safetyStock = z * stats.dailyStdDev * Math.sqrt(effectiveLeadTime);
  const reorderPoint = demandOverLeadTime + safetyStock;
  const isLow = currentStock <= reorderPoint;

  // Order-up-to target: cover one more lead-time cycle beyond the reorder
  // point, since the brief's "review period" input also isn't available
  // yet - using a second lead-time cycle as the review period is itself a
  // flagged simplification, not real review-period data.
  const targetStock = reorderPoint + demandOverLeadTime;
  const suggestedOrderQty = isLow ? Math.max(0, Math.round(targetStock - currentStock)) : 0;

  return {
    demandOverLeadTime,
    safetyStock,
    reorderPoint,
    isLow,
    suggestedOrderQty,
    usedFallbackLeadTime,
  };
}

export type CombinedRisk = "green" | "yellow" | "red";

/**
 * Per-SKU combined risk: red when both the office and at least one store
 * are low (the two-tier problem the brief calls out as most urgent -
 * transferring stock can't fix it), yellow when only one layer is low
 * (a transfer can likely fix it), green when neither is.
 */
export function combinedRisk(officeLow: boolean, anyStoreLow: boolean): CombinedRisk {
  if (officeLow && anyStoreLow) return "red";
  if (officeLow || anyStoreLow) return "yellow";
  return "green";
}

export interface TransferSplit {
  storeId: number;
  qty: number;
}

/**
 * Splits an incoming quantity across stores in proportion to each
 * store's forecasted demand rate (not an even split). Uses the largest-
 * remainder method so the split's integers always sum to exactly
 * `incomingQty` rather than drifting from independent rounding.
 */
export function suggestedTransferSplit(
  incomingQty: number,
  storeRates: { storeId: number; dailyRate: number }[],
): TransferSplit[] {
  const totalRate = storeRates.reduce((sum, s) => sum + s.dailyRate, 0);

  if (totalRate <= 0 || incomingQty <= 0) {
    // No demand signal to split by - fall back to an even split rather
    // than sending everything to whichever store happens to be first.
    const even = storeRates.length ? Math.floor(incomingQty / storeRates.length) : 0;
    let remainder = incomingQty - even * storeRates.length;
    return storeRates.map((s) => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      return { storeId: s.storeId, qty: even + extra };
    });
  }

  const raw = storeRates.map((s) => ({
    storeId: s.storeId,
    exact: (s.dailyRate / totalRate) * incomingQty,
  }));
  const floored = raw.map((r) => ({ storeId: r.storeId, qty: Math.floor(r.exact), remainder: r.exact - Math.floor(r.exact) }));

  const allocated = floored.reduce((sum, r) => sum + r.qty, 0);
  let toDistribute = incomingQty - allocated;

  const byRemainderDesc = [...floored].sort((a, b) => b.remainder - a.remainder);
  const bump = new Set<number>();
  for (let i = 0; i < byRemainderDesc.length && toDistribute > 0; i++) {
    bump.add(byRemainderDesc[i].storeId);
    toDistribute--;
  }

  return floored.map((r) => ({
    storeId: r.storeId,
    qty: r.qty + (bump.has(r.storeId) ? 1 : 0),
  }));
}
