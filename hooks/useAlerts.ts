"use client";

import { useEffect } from "react";
import { useSessionStoreApi } from "@/lib/session/SessionContext";
import { useAlertStore } from "@/lib/store/alertStore";
import { useUIStore } from "@/lib/store/uiStore";
import { AlertMonitor, cvdDivergence, type AlertSnapshot } from "@/lib/engine/alerts";
import { stackedRuns } from "@/lib/engine/imbalance";
import { resampleBars, rollingVolumeZScores } from "@/lib/engine/analytics";
import { formatPriceValue, priceDecimals } from "@/lib/format";
import { notify, playChime } from "@/lib/alerts/delivery";
import type { NormalizedLiquidation, NormalizedTrade } from "@/lib/types/market";
import type { MicroEvent } from "@/lib/engine/microstructure";
import type { TerminalStore } from "@/lib/store/terminalStore";

const EVALUATE_MS = 250;
const Z_BAR_SECONDS = 5;
const Z_WINDOW = 20;

// ─── useAlerts ───────────────────────────────────────────────────
// Watches the session store, builds a snapshot a few times a second and
// delivers whatever the monitor fires: toast (log), chime, notification.

export function useAlerts() {
  const store = useSessionStoreApi();

  useEffect(() => {
    const monitor = new AlertMonitor();
    let lastTrade: NormalizedTrade | undefined;
    let lastLiquidation: NormalizedLiquidation | undefined;
    let lastMicro: MicroEvent | undefined;
    let sessionStart: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const newTrades = (s: TerminalStore): NormalizedTrade[] => {
      const out: NormalizedTrade[] = [];
      for (const t of s.recentTrades) {
        if (lastTrade && t.id === lastTrade.id && t.timestamp === lastTrade.timestamp) break;
        out.push(t);
      }
      lastTrade = s.recentTrades[0] ?? lastTrade;
      return out;
    };

    const newLiquidations = (s: TerminalStore): NormalizedLiquidation[] => {
      const list = s.liquidations;
      // The list is capped and append-only, so locate the last seen record by identity.
      const index = lastLiquidation ? list.lastIndexOf(lastLiquidation) : -1;
      lastLiquidation = list[list.length - 1] ?? lastLiquidation;
      return list.slice(index + 1);
    };

    const evaluate = () => {
      timer = null;
      const s = store.getState();
      // A new market session (symbol / venue / timeframe change, replay) resets alert state.
      const start = s.session?.startTime ?? null;
      if (start !== sessionStart) {
        sessionStart = start;
        monitor.reset();
        lastTrade = s.recentTrades[0];
        lastLiquidation = s.liquidations[s.liquidations.length - 1];
        lastMicro = s.microEvents[s.microEvents.length - 1];
        return;
      }
      if (!s.session) return;

      const { settings } = useAlertStore.getState();
      const anyRule = Object.values(settings.rules).some(Boolean);
      const ind = useUIStore.getState().indicators;
      const price = s.ticker?.price ?? s.session.last;
      const decimals = priceDecimals(s.tickSize, price);

      // Latest completed 5-second volume bar vs the previous 20.
      let volumeZ: AlertSnapshot["volumeZ"] = null;
      const bars = s.flowBars;
      if (bars.length > Z_BAR_SECONDS * (Z_WINDOW + 1)) {
        const resampled = resampleBars(bars.slice(-Z_BAR_SECONDS * (Z_WINDOW + 3)), Z_BAR_SECONDS);
        const lastFlow = bars[bars.length - 1];
        const complete = (lastFlow.time + 1000) % (Z_BAR_SECONDS * 1000) === 0 ? resampled : resampled.slice(0, -1);
        const z = rollingVolumeZScores(complete, Z_WINDOW).at(-1);
        if (z && z.z !== null) volumeZ = { z: z.z, time: complete[complete.length - 1].time };
      }

      const candle = s.currentCandle;
      const snapshot: AlertSnapshot = {
        now: s.replay ? s.marketClock : Date.now(),
        price,
        vwap: s.session.vwap || null,
        vah: s.volumeProfile && s.volumeProfile.levels.length > 2 ? s.volumeProfile.vah : null,
        val: s.volumeProfile && s.volumeProfile.levels.length > 2 ? s.volumeProfile.val : null,
        sessionTrades: s.session.trades,
        averagePrint: s.session.trades ? s.session.volume / s.session.trades : 0,
        volumeZ,
        stacked: candle ? { candleOpen: candle.openTime, runs: stackedRuns(candle, ind.imbalanceRatio, ind.stackedLevels) } : null,
        divergence: cvdDivergence(bars, s.tickSize),
        newTrades: newTrades(s),
        newLiquidations: newLiquidations(s),
        newMicro: (() => {
          const list = s.microEvents;
          const index = lastMicro ? list.lastIndexOf(lastMicro) : -1;
          lastMicro = list[list.length - 1] ?? lastMicro;
          return list.slice(index + 1);
        })(),
        format: (p) => formatPriceValue(p, decimals),
      };
      const events = monitor.evaluate(snapshot, settings);
      if (!events.length || !anyRule) return;

      const replay = s.replay !== null;
      const symbol = s.symbol;
      useAlertStore.getState().push(events.map((e) => ({ ...e, symbol, replay })));
      const top = events[events.length - 1];
      if (settings.sound) playChime(top.tone);
      // System notifications are for live markets only.
      if (settings.notifications && !replay) {
        for (const e of events) notify(`${symbol} · ${e.title}`, e.body, e.rule, settings.sound);
      }
    };

    const unsubscribe = store.subscribe(() => {
      if (!timer) timer = setTimeout(evaluate, EVALUATE_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [store]);
}
