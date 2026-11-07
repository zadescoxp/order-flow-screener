"use client";

import React, { useMemo, useState } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { formatClock, formatCompact, formatPriceValue, priceDecimals, VENUE_SHORT } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Panel, Segmented } from "@/components/ui/Primitives";

// ─── Time & Sales ────────────────────────────────────────────────
// Executed prints, newest first. Size is compared to the session's
// average print so block trades stand out.

const FILTERS = [
  { value: 0, label: "All" },
  { value: 2, label: "≥2×" },
  { value: 5, label: "≥5×" },
  { value: 10, label: "≥10×" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];
const MAX_ROWS = 120;

export default function TimeAndSales() {
  const trades = useSessionStore((s) => s.recentTrades);
  const session = useSessionStore((s) => s.session);
  const tickSize = useSessionStore((s) => s.tickSize);
  const selectedVenues = useSessionStore((s) => s.selectedVenues);
  const marketType = useSessionStore((s) => s.marketType);
  const [filter, setFilter] = useState<Filter>(0);

  const avg = session && session.trades ? session.volume / session.trades : 0;
  const decimals = priceDecimals(tickSize, trades[0]?.price);
  const showVenue = selectedVenues.length > 1;

  const rows = useMemo(() => {
    const threshold = avg * filter;
    const out = [];
    for (let i = 0; i < trades.length && out.length < MAX_ROWS; i++) {
      const trade = trades[i];
      if (filter && trade.quantity < threshold) continue;
      const prev = trades[i + 1];
      const tick = prev ? Math.sign(trade.price - prev.price) : 0;
      out.push({ trade, tick, ratio: avg ? trade.quantity / avg : 1 });
    }
    return out;
  }, [trades, avg, filter]);

  const recentBuy = trades.slice(0, 200).reduce((s, t) => s + (t.side === "buy" ? t.quantity : 0), 0);
  const recentTotal = trades.slice(0, 200).reduce((s, t) => s + t.quantity, 0);
  const buyShare = recentTotal ? recentBuy / recentTotal : 0.5;

  return (
    <Panel
      title="Time & Sales" icon={<Icon.Tape />}
      subtitle={avg ? `avg print ${formatCompact(avg, 3)}` : "executed prints"}
      className="tape-panel"
      actions={<Segmented size="xs" value={filter} onChange={setFilter} options={FILTERS} ariaLabel="Minimum size vs average" />}
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
          {rows.length === 0 && <div className="empty-state">{trades.length ? "No prints match the filter" : "Waiting for trades…"}</div>}
          {rows.map(({ trade, tick, ratio }) => {
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
