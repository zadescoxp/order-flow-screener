"use client";

import React, { useMemo, useState } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { formatClock, formatCompact, formatPriceValue, priceDecimals, VENUE_SHORT } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Panel, Segmented } from "@/components/ui/Primitives";
import type { NormalizedLiquidation, NormalizedTrade } from "@/lib/types/market";

// ─── Time & Sales ────────────────────────────────────────────────
// Executed prints, newest first. Size is compared to the session's
// average print so block trades stand out.

const FILTERS = [
  { value: 0, label: "All" },
  { value: 2, label: "≥2×" },
  { value: 5, label: "≥5×" },
  { value: 10, label: "≥10×" },
] as const;
const LIQ_FILTER = -1;
const PERP_FILTERS = [...FILTERS, { value: LIQ_FILTER, label: "Liq" }] as const;
type Filter = (typeof PERP_FILTERS)[number]["value"];
const MAX_ROWS = 120;

type TapeRow =
  | { kind: "trade"; trade: NormalizedTrade; tick: number; ratio: number }
  | { kind: "liq"; liq: NormalizedLiquidation };

export default function TimeAndSales() {
  const trades = useSessionStore((s) => s.recentTrades);
  const session = useSessionStore((s) => s.session);
  const tickSize = useSessionStore((s) => s.tickSize);
  const selectedVenues = useSessionStore((s) => s.selectedVenues);
  const marketType = useSessionStore((s) => s.marketType);
  const liquidations = useSessionStore((s) => s.liquidations);
  const [filter, setFilter] = useState<Filter>(0);
  const isPerp = marketType === "perpetual";
  const activeFilter: Filter = !isPerp && filter === LIQ_FILTER ? 0 : filter;

  const avg = session && session.trades ? session.volume / session.trades : 0;
  const decimals = priceDecimals(tickSize, trades[0]?.price);
  const showVenue = selectedVenues.length > 1;

  const rows = useMemo(() => {
    const out: TapeRow[] = [];
    if (activeFilter === LIQ_FILTER) {
      for (let i = liquidations.length - 1; i >= 0 && out.length < MAX_ROWS; i--) out.push({ kind: "liq", liq: liquidations[i] });
      return out;
    }
    // Liquidations are interleaved by time, limited to the span the tape covers.
    const oldestTrade = trades[trades.length - 1]?.timestamp ?? Infinity;
    let li = liquidations.length - 1;
    const threshold = avg * activeFilter;
    for (let i = 0; i < trades.length && out.length < MAX_ROWS; i++) {
      const trade = trades[i];
      while (li >= 0 && liquidations[li].timestamp >= trade.timestamp && out.length < MAX_ROWS) {
        if (liquidations[li].timestamp >= oldestTrade) out.push({ kind: "liq", liq: liquidations[li] });
        li--;
      }
      if (activeFilter && trade.quantity < threshold) continue;
      const prev = trades[i + 1];
      const tick = prev ? Math.sign(trade.price - prev.price) : 0;
      out.push({ kind: "trade", trade, tick, ratio: avg ? trade.quantity / avg : 1 });
    }
    return out;
  }, [trades, liquidations, avg, activeFilter]);

  const recentBuy = trades.slice(0, 200).reduce((s, t) => s + (t.side === "buy" ? t.quantity : 0), 0);
  const recentTotal = trades.slice(0, 200).reduce((s, t) => s + t.quantity, 0);
  const buyShare = recentTotal ? recentBuy / recentTotal : 0.5;

  return (
    <Panel
      title="Time & Sales" icon={<Icon.Tape />}
      subtitle={avg ? `avg print ${formatCompact(avg, 3)}` : "executed prints"}
      className="tape-panel"
      actions={<Segmented size="xs" value={activeFilter} onChange={setFilter} options={isPerp ? PERP_FILTERS : FILTERS} ariaLabel="Minimum size vs average, or liquidations only" />}
      footer={
        <div className="book-imbalance" title="Aggressor split over the last 200 prints">
          <span className="tone-buy">Buy {(buyShare * 100).toFixed(0)}%</span>
          <div className="imbalance-track">
            <div className="imbalance-bid" style={{ width: `${buyShare * 100}%` }} />
          </div>
          <span className="tone-sell">Sell {((1 - buyShare) * 100).toFixed(0)}%</span>
        </div>
      }
    >
      <div className={`tape ${showVenue ? "with-venue" : ""}`}>
        <div className="tape-head">
          <span>Time</span>
          <span>Price</span>
          <span>Size</span>
          {showVenue && <span>Venue</span>}
        </div>
        <div className="tape-body">
          {rows.length === 0 && (
            <div className="empty-state">
              {activeFilter === LIQ_FILTER ? "No liquidations yet this session" : trades.length ? "No prints match the filter" : "Waiting for trades…"}
            </div>
          )}
          {rows.map((row) => {
            if (row.kind === "liq") {
              const { liq } = row;
              // A long liquidation is a forced sell; a short liquidation a forced buy.
              const side = liq.side === "long" ? "sell" : "buy";
              return (
                <div
                  key={liq.id}
                  className={`tape-row ${side} is-liq`}
                  title={`${liq.side === "long" ? "Long" : "Short"} liquidated: ${liq.quantity} @ ${liq.price} ($${formatCompact(liq.quoteVolume, 2)}) on ${VENUE_SHORT[liq.venue] ?? liq.venue}`}
                >
                  <span className="tape-time">
                    <b className="liq-tag">LIQ {liq.side === "long" ? "L" : "S"}</b>
                    {formatClock(liq.timestamp)}
                  </span>
                  <span className="tape-price">{formatPriceValue(liq.price, decimals)}</span>
                  <span className="tape-size">${formatCompact(liq.quoteVolume, 1)}</span>
                  {showVenue && <span className="tape-venue">{VENUE_SHORT[liq.venue] ?? liq.venue}</span>}
                </div>
              );
            }
            const { trade, tick, ratio } = row;
            const heat = Math.min(1, Math.max(0, (ratio - 1) / 9));
            return (
              <div
                key={trade.id + trade.timestamp}
                className={`tape-row ${trade.side} ${ratio >= 5 ? "is-block" : ""}`}
                style={{ "--heat": heat.toFixed(3) } as React.CSSProperties}
                title={`${trade.side === "buy" ? "Buy" : "Sell"} ${trade.quantity} @ ${trade.price} · ${ratio.toFixed(1)}× average${marketType === "forex" ? " (tick)" : ""}`}
              >
                <span className="tape-time">{formatClock(trade.timestamp, true)}</span>
                <span className="tape-price">
                  {formatPriceValue(trade.price, decimals)}
                  <i className={`tick-arrow ${tick > 0 ? "up" : tick < 0 ? "down" : ""}`} />
                </span>
                <span className="tape-size">{formatCompact(trade.quantity, 3)}</span>
                {showVenue && <span className="tape-venue">{VENUE_SHORT[trade.venue] ?? trade.venue}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
