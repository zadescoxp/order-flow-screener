// ============================================================
// DERIVATIVES ANALYTICS
// Open interest, funding, basis and liquidations for perpetuals.
// Pure functions — the manager owns the state, panels render it.
// ============================================================

import type {
  DerivativesAggregate,
  DerivativesSnapshot,
  NormalizedLiquidation,
  OpenInterestPoint,
  Venue,
} from "@/lib/types/market";

const DEFAULT_FUNDING_HOURS = 8;

/** Venues with a public liquidation feed (Bitget and Hyperliquid don't publish one). */
export const LIQUIDATION_FEED_VENUES: ReadonlySet<Venue> = new Set<Venue>([
  "binance-futures",
  "bybit-futures",
  "okx-futures",
  "deribit",
]);

/** Merge a partial venue update into the last known snapshot for that venue. */
export function mergeDerivatives(
  previous: DerivativesSnapshot | undefined,
  update: DerivativesSnapshot
): DerivativesSnapshot {
  const merged: DerivativesSnapshot = { ...(previous ?? { venue: update.venue }), timestamp: update.timestamp } as DerivativesSnapshot;
  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}

/** Funding rate restated over an 8-hour interval so venues with 1h / 4h / 8h funding compare. */
export function fundingRate8h(snapshot: DerivativesSnapshot): number | undefined {
  if (snapshot.fundingRate === undefined) return undefined;
  const hours = snapshot.fundingIntervalHours ?? DEFAULT_FUNDING_HOURS;
  return snapshot.fundingRate * (8 / hours);
}

/** Annualized funding (decimal) from a rate over `intervalHours`. */
export function annualizeFunding(rate: number, intervalHours = DEFAULT_FUNDING_HOURS): number {
  return rate * (24 / intervalHours) * 365;
}

/**
 * Combine per-venue derivatives state. Open interest is summed over the
 * venues that reported it (restricted to `oiVenues` when given, so the total
 * doesn't jump when a slow venue reports late). Funding and basis are
 * weighted by each venue's open interest, falling back to an equal weight.
 */
export function aggregateDerivatives(
  snapshots: DerivativesSnapshot[],
  primaryVenue: Venue | undefined,
  referencePrice: number | undefined,
  oiVenues?: ReadonlySet<Venue>
): DerivativesAggregate | null {
  if (!snapshots.length) return null;
  const primary = snapshots.find((s) => s.venue === primaryVenue) ?? snapshots[0];

  let oi = 0;
  let oiValue = 0;
  let oiCount = 0;
  for (const s of snapshots) {
    if (s.openInterest === undefined) continue;
    if (oiVenues && !oiVenues.has(s.venue)) continue;
    oi += s.openInterest;
    oiValue += s.openInterest * (s.markPrice ?? referencePrice ?? 0);
    oiCount++;
  }

  const weighted = (value: (s: DerivativesSnapshot) => number | undefined) => {
    let sum = 0;
    let weight = 0;
    for (const s of snapshots) {
      const v = value(s);
      if (v === undefined || !Number.isFinite(v)) continue;
      const w = s.openInterest && s.openInterest > 0 ? s.openInterest : 1;
      sum += v * w;
      weight += w;
    }
    return weight > 0 ? sum / weight : null;
  };

  return {
    timestamp: Math.max(...snapshots.map((s) => s.timestamp)),
    venues: snapshots,
    openInterest: oiCount ? oi : null,
    openInterestValue: oiCount && oiValue > 0 ? oiValue : null,
    fundingRate8h: weighted(fundingRate8h),
    nextFundingTime: primary.nextFundingTime ?? null,
    fundingIntervalHours: primary.fundingRate !== undefined ? primary.fundingIntervalHours ?? DEFAULT_FUNDING_HOURS : null,
    primaryFundingRate: primary.fundingRate ?? null,
    markPrice: weighted((s) => s.markPrice),
    indexPrice: weighted((s) => s.indexPrice),
    basisBps: weighted((s) => (s.markPrice && s.indexPrice ? ((s.markPrice - s.indexPrice) / s.indexPrice) * 10_000 : undefined)),
  };
}

// ----------------------------------------------------------
// Price × open-interest regime
// ----------------------------------------------------------
export type OIRegime = "new-longs" | "short-covering" | "new-shorts" | "long-unwind" | "neutral";

export const OI_REGIME_LABEL: Record<OIRegime, string> = {
  "new-longs": "New longs",
  "short-covering": "Short covering",
  "new-shorts": "New shorts",
  "long-unwind": "Long unwind",
  neutral: "Balanced",
};

export const OI_REGIME_HINT: Record<OIRegime, string> = {
  "new-longs": "Price up with rising open interest: fresh long positioning is driving the move.",
  "short-covering": "Price up with falling open interest: shorts are closing; the rally is driven by exits, not new demand.",
  "new-shorts": "Price down with rising open interest: fresh short positioning is driving the move.",
  "long-unwind": "Price down with falling open interest: longs are closing or being liquidated.",
  neutral: "Price or open interest is roughly flat over the window.",
};

/**
 * Classify the joint move of price and open interest.
 * Changes are fractional (0.001 = 0.1%). Moves smaller than the
 * thresholds count as flat.
 */
export function classifyOIRegime(
  priceChange: number,
  oiChange: number,
  priceThreshold = 0.0005,
  oiThreshold = 0.001
): OIRegime {
  if (Math.abs(priceChange) < priceThreshold || Math.abs(oiChange) < oiThreshold) return "neutral";
  if (priceChange > 0) return oiChange > 0 ? "new-longs" : "short-covering";
  return oiChange > 0 ? "new-shorts" : "long-unwind";
}

export interface OIWindowChange {
  priceChange: number; // fraction
  oiChange: number; // fraction
  oiDelta: number; // base units
  regime: OIRegime;
  from: OpenInterestPoint;
  to: OpenInterestPoint;
}

/** Price and OI change over the trailing `windowMs` of the history. */
export function oiWindowChange(history: OpenInterestPoint[], windowMs: number): OIWindowChange | null {
  if (history.length < 2) return null;
  const to = history[history.length - 1];
  const cutoff = to.time - windowMs;
  let lo = 0;
  let hi = history.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (history[mid].time < cutoff) lo = mid + 1;
    else hi = mid;
  }
  const from = history[lo];
  if (from === to || !(from.openInterest > 0) || !(from.price > 0)) return null;
  const priceChange = (to.price - from.price) / from.price;
  const oiChange = (to.openInterest - from.openInterest) / from.openInterest;
  return {
    priceChange,
    oiChange,
    oiDelta: to.openInterest - from.openInterest,
    regime: classifyOIRegime(priceChange, oiChange),
    from,
    to,
  };
}

// ----------------------------------------------------------
// Liquidations
// ----------------------------------------------------------
export interface LiquidationBucket {
  time: number;
  longNotional: number;
  shortNotional: number;
  longQty: number;
  shortQty: number;
  count: number;
}

/** Bucket liquidations into fixed windows ending at `now`, oldest first; empty windows included. */
export function bucketLiquidations(
  liquidations: NormalizedLiquidation[],
  bucketMs: number,
  count: number,
  now: number
): LiquidationBucket[] {
  const end = Math.floor(now / bucketMs) * bucketMs;
  const start = end - (count - 1) * bucketMs;
  const buckets: LiquidationBucket[] = Array.from({ length: count }, (_, i) => ({
    time: start + i * bucketMs,
    longNotional: 0,
    shortNotional: 0,
    longQty: 0,
    shortQty: 0,
    count: 0,
  }));
  for (const l of liquidations) {
    const index = Math.floor((l.timestamp - start) / bucketMs);
    if (index < 0 || index >= count) continue;
    const b = buckets[index];
    if (l.side === "long") { b.longNotional += l.quoteVolume; b.longQty += l.quantity; }
    else { b.shortNotional += l.quoteVolume; b.shortQty += l.quantity; }
    b.count++;
  }
  return buckets;
}

/** How far arrival order may lag exchange time when scanning liquidations newest-first. */
export const ARRIVAL_SLACK_MS = 60_000;

export interface LiquidationSummary {
  longNotional: number;
  shortNotional: number;
  count: number;
  largest: NormalizedLiquidation | null;
}

export function summarizeLiquidations(liquidations: NormalizedLiquidation[], since: number): LiquidationSummary {
  const summary: LiquidationSummary = { longNotional: 0, shortNotional: 0, count: 0, largest: null };
  // The list is in arrival order, which can trail exchange time by a few
  // seconds across venues; scan a little past `since` before stopping.
  for (let i = liquidations.length - 1; i >= 0; i--) {
    const l = liquidations[i];
    if (l.timestamp < since - ARRIVAL_SLACK_MS) break;
    if (l.timestamp < since) continue;
    if (l.side === "long") summary.longNotional += l.quoteVolume;
    else summary.shortNotional += l.quoteVolume;
    summary.count++;
    if (!summary.largest || l.quoteVolume > summary.largest.quoteVolume) summary.largest = l;
  }
  return summary;
}

/**
 * Flags a cascade when the latest bucket's notional is far above the
 * typical (median of non-empty) bucket and above an absolute floor.
 */
export function isLiquidationCascade(buckets: LiquidationBucket[], multiple = 5, floor = 0): boolean {
  if (buckets.length < 4) return false;
  const last = buckets[buckets.length - 1];
  const total = last.longNotional + last.shortNotional;
  if (total <= floor) return false;
  const history = buckets
    .slice(0, -1)
    .map((b) => b.longNotional + b.shortNotional)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (history.length < 3) return false;
  const median = history[Math.floor(history.length / 2)];
  return total >= median * multiple;
}
