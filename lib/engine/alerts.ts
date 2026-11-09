// ============================================================
// ALERTS
// A stateful monitor that turns successive market snapshots into
// discrete alert events. Pure logic: delivery (toast, sound, browser
// notification) lives in hooks/useAlerts.
// ============================================================

import type { FlowBar, NormalizedLiquidation, NormalizedTrade } from "@/lib/types/market";
import type { MicroEvent } from "@/lib/engine/microstructure";

export type AlertRuleId =
  | "vwapCross"
  | "valueAreaCross"
  | "volumeZ"
  | "stackedImbalance"
  | "blockPrint"
  | "cvdDivergence"
  | "liquidation"
  | "absorption"
  | "iceberg";

export interface AlertSettings {
  rules: Record<AlertRuleId, boolean>;
  volumeZThreshold: number; // σ
  blockPrintRatio: number; // × session average print
  liquidationNotional: number; // quote units
  cooldownSec: number; // per rule (and per level for crosses)
  sound: boolean;
  notifications: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  rules: {
    vwapCross: false,
    valueAreaCross: false,
    volumeZ: false,
    stackedImbalance: false,
    blockPrint: false,
    cvdDivergence: false,
    liquidation: false,
    absorption: false,
    iceberg: false,
  },
  volumeZThreshold: 3,
  blockPrintRatio: 20,
  liquidationNotional: 250_000,
  cooldownSec: 30,
  sound: true,
  notifications: false,
};

export type AlertTone = "buy" | "sell" | "warn" | "neutral";

export interface AlertEvent {
  id: string;
  rule: AlertRuleId;
  time: number;
  /** Full sentence, used for system notifications. */
  title: string;
  /** Short label for the toast's headline ("Above VWAP", "Block buy"). */
  headline: string;
  /** The key number, shown large in mono ("28×", "+3.4σ", "$512K"). */
  figure?: string;
  /** Supporting detail in one line. */
  body: string;
  tone: AlertTone;
}

export const ALERT_RULE_LABEL: Record<AlertRuleId, string> = {
  vwapCross: "VWAP",
  valueAreaCross: "Value area",
  volumeZ: "Volume",
  stackedImbalance: "Imbalance",
  blockPrint: "Block print",
  cvdDivergence: "CVD",
  liquidation: "Liquidation",
  absorption: "Absorption",
  iceberg: "Iceberg",
};

export interface StackedRun {
  dir: "buy" | "sell";
  start: number;
  end: number;
}

export interface AlertSnapshot {
  now: number;
  price: number | null;
  vwap: number | null;
  vah: number | null;
  val: number | null;
  sessionTrades: number;
  averagePrint: number;
  /** z-score of the latest completed volume bar, and that bar's open time. */
  volumeZ: { z: number; time: number } | null;
  /** Stacked-imbalance runs in the live candle. */
  stacked: { candleOpen: number; runs: StackedRun[] } | null;
  divergence: "bullish" | "bearish" | null;
  newTrades: NormalizedTrade[];
  newLiquidations: NormalizedLiquidation[];
  newMicro: MicroEvent[];
  format: (price: number) => string;
}

/** Crossing alerts need this much session history so start-up noise doesn't fire. */
export const ALERT_WARMUP_TRADES = 50;
const EVENT_COOLDOWN_MS = 5_000; // block prints / liquidations: collapse bursts

let nextId = 0;

export class AlertMonitor {
  private sides = new Map<string, number>();
  private lastFired = new Map<string, number>();
  private stackSeen = new Map<number, StackedRun[]>();
  private lastZBar = 0;
  private lastDivergence: AlertSnapshot["divergence"] = null;

  reset(): void {
    this.sides.clear();
    this.lastFired.clear();
    this.stackSeen.clear();
    this.lastZBar = 0;
    this.lastDivergence = null;
  }

  evaluate(s: AlertSnapshot, settings: AlertSettings): AlertEvent[] {
    const out: AlertEvent[] = [];
    const rules = settings.rules;
    const cooldown = settings.cooldownSec * 1000;
    const fire = (key: string, cooldownMs: number, event: Omit<AlertEvent, "id" | "time">) => {
      const last = this.lastFired.get(key);
      if (last !== undefined && s.now - last < cooldownMs) return;
      this.lastFired.set(key, s.now);
      out.push({ ...event, id: `alert-${++nextId}`, time: s.now });
    };

    // ── Level crosses (state is tracked even while a rule is off) ──
    const warm = s.sessionTrades >= ALERT_WARMUP_TRADES;
    const cross = (key: string, level: number | null, name: string, enabled: boolean, rule: AlertRuleId) => {
      if (s.price === null || level === null || !Number.isFinite(level)) return;
      const side = Math.sign(s.price - level);
      if (side === 0) return; // touching the level keeps the previous side
      const previous = this.sides.get(key);
      this.sides.set(key, side);
      if (!enabled || !warm || previous === undefined || previous === side) return;
      fire(key, cooldown, {
        rule,
        title: `Price crossed ${side > 0 ? "above" : "below"} ${name}`,
        headline: `${side > 0 ? "Above" : "Below"} ${name}`,
        figure: s.format(s.price),
        body: `${name} ${s.format(level)}`,
        tone: side > 0 ? "buy" : "sell",
      });
    };
    cross("vwap", s.vwap, "VWAP", rules.vwapCross, "vwapCross");
    cross("vah", s.vah, "VAH", rules.valueAreaCross, "valueAreaCross");
    cross("val", s.val, "VAL", rules.valueAreaCross, "valueAreaCross");

    // ── Volume z-score: once per completed bar ──
    if (s.volumeZ && s.volumeZ.time > this.lastZBar) {
      this.lastZBar = s.volumeZ.time;
      if (rules.volumeZ && s.volumeZ.z >= settings.volumeZThreshold) {
        fire("volumeZ", cooldown, {
          rule: "volumeZ",
          title: `Volume spike +${s.volumeZ.z.toFixed(1)}σ`,
          headline: "Volume spike",
          figure: `+${s.volumeZ.z.toFixed(1)}σ`,
          body: `5s bar vs prior 20 · threshold ${settings.volumeZThreshold}σ`,
          tone: "warn",
        });
      }
    }

    // ── New stacked imbalance in the live candle ──
    if (s.stacked) {
      const seen = this.stackSeen.get(s.stacked.candleOpen) ?? [];
      for (const run of s.stacked.runs) {
        const overlap = seen.find((r) => r.dir === run.dir && r.start <= run.end && run.start <= r.end);
        if (overlap) {
          overlap.start = Math.min(overlap.start, run.start);
          overlap.end = Math.max(overlap.end, run.end);
          continue;
        }
        seen.push({ ...run });
        if (rules.stackedImbalance) {
          fire(`stack:${s.stacked.candleOpen}:${run.dir}:${run.start}`, 0, {
            rule: "stackedImbalance",
            title: `Stacked ${run.dir} imbalance`,
            headline: `${run.dir === "buy" ? "Buy" : "Sell"} stack`,
            body: `${s.format(run.start)} – ${s.format(run.end)} · live candle`,
            tone: run.dir,
          });
        }
      }
      this.stackSeen.set(s.stacked.candleOpen, seen);
      // Keep only recent candles.
      if (this.stackSeen.size > 8) this.stackSeen.delete(this.stackSeen.keys().next().value!);
    }

    // ── Block print ──
    if (rules.blockPrint && warm && s.averagePrint > 0 && s.newTrades.length) {
      let largest: NormalizedTrade | null = null;
      for (const t of s.newTrades) {
        if (t.quantity >= s.averagePrint * settings.blockPrintRatio && (!largest || t.quantity > largest.quantity)) largest = t;
      }
      if (largest) {
        fire("blockPrint", EVENT_COOLDOWN_MS, {
          rule: "blockPrint",
          title: `Block ${largest.side} ${(largest.quantity / s.averagePrint).toFixed(0)}× average`,
          headline: `Block ${largest.side}`,
          figure: `${(largest.quantity / s.averagePrint).toFixed(0)}×`,
          body: `${largest.quantity} @ ${s.format(largest.price)} · $${compact(largest.quoteVolume)}`,
          tone: largest.side,
        });
      }
    }

    // ── CVD divergence: on entering a divergent state ──
    if (s.divergence !== this.lastDivergence) {
      const entered = s.divergence;
      this.lastDivergence = s.divergence;
      if (entered && rules.cvdDivergence) {
        fire("cvdDivergence", cooldown, {
          rule: "cvdDivergence",
          title: `${entered === "bullish" ? "Bullish" : "Bearish"} CVD divergence`,
          headline: `${entered === "bullish" ? "Bullish" : "Bearish"} divergence`,
          body: entered === "bullish" ? "1m: price down, CVD up" : "1m: price up, CVD down",
          tone: entered === "bullish" ? "buy" : "sell",
        });
      }
    }

    // ── Large liquidation ──
    if (rules.liquidation && s.newLiquidations.length) {
      let largest: NormalizedLiquidation | null = null;
      for (const l of s.newLiquidations) {
        if (l.quoteVolume >= settings.liquidationNotional && (!largest || l.quoteVolume > largest.quoteVolume)) largest = l;
      }
      if (largest) {
        fire("liquidation", EVENT_COOLDOWN_MS, {
          rule: "liquidation",
          title: `${largest.side === "long" ? "Long" : "Short"} liquidation $${compact(largest.quoteVolume)}`,
          headline: `${largest.side === "long" ? "Long" : "Short"} liquidated`,
          figure: `$${compact(largest.quoteVolume)}`,
          body: `${largest.quantity} @ ${s.format(largest.price)}`,
          tone: largest.side === "long" ? "sell" : "buy",
        });
      }
    }

    // ── Absorption / iceberg detections ──
    for (const ev of s.newMicro) {
      const rule: AlertRuleId = ev.kind;
      if (!rules[rule]) continue;
      const held = ev.side === "bid" ? "bid" : "offer";
      fire(`${rule}:${ev.side}:${ev.price}`, cooldown, {
        rule,
        title: `${ev.kind === "absorption" ? "Absorption" : "Iceberg"} at the ${held} ${s.format(ev.price)}`,
        headline: `${ev.side === "bid" ? "Bid" : "Offer"} ${ev.kind === "absorption" ? "absorbing" : "refilling"}`,
        figure: s.format(ev.price),
        body: ev.kind === "absorption"
          ? `${compact(ev.volume)} hit the level · ${ev.ratio.toFixed(1)}× avg window`
          : `${ev.ratio.toFixed(1)}× its displayed size traded · $${compact(ev.notional)}`,
        tone: ev.side === "bid" ? "buy" : "sell",
      });
    }

    return out;
  }
}

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

/**
 * Divergence between the 1-minute change in price and in CVD, from 1-second
 * flow bars. Both moves must be meaningful: price by at least `minTicks`
 * ticks and CVD by at least `minCvdShare` of the minute's volume.
 */
export function cvdDivergence(
  bars: FlowBar[],
  tickSize: number,
  windowBars = 60,
  minTicks = 2,
  minCvdShare = 0.1
): "bullish" | "bearish" | null {
  if (bars.length <= windowBars) return null;
  const last = bars[bars.length - 1];
  const first = bars[bars.length - 1 - windowBars];
  const priceMove = last.close - first.close;
  const cvdMove = last.cvd - first.cvd;
  let volume = 0;
  for (let i = bars.length - windowBars; i < bars.length; i++) volume += bars[i].volume;
  if (Math.abs(priceMove) < tickSize * minTicks || volume <= 0 || Math.abs(cvdMove) < volume * minCvdShare) return null;
  if (priceMove < 0 && cvdMove > 0) return "bullish";
  if (priceMove > 0 && cvdMove < 0) return "bearish";
  return null;
}
