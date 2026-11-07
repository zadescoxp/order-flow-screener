"use client";

import React, { useMemo, useState } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { formatCompact, formatPriceValue, inferDecimals, priceDecimals, VENUE_LABEL } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Panel, Segmented } from "@/components/ui/Primitives";
import { showTooltip, hideTooltip } from "./GlobalTooltip";
import type { OrderBookLevel } from "@/lib/types/market";

// ─── Order Book Ladder ───────────────────────────────────────────
// Price ladder with per-level size bars, cumulative depth shading,
// liquidity-wall highlighting and a top-of-book imbalance meter.

const LEVELS_PER_SIDE = 24;
const GROUPS = [0, 1, 5, 25] as const; // multiples of the footprint tick; 0 = raw book
type Group = (typeof GROUPS)[number];

interface Row {
  price: number;
  size: number;
  cum: number;
}

function groupLevels(levels: OrderBookLevel[], step: number, side: "bid" | "ask", decimals: number): Row[] {
  const map = new Map<number, number>();
  for (const level of levels) {
    const key = step > 0
      ? Number(((side === "ask" ? Math.ceil(level.price / step - 1e-9) : Math.floor(level.price / step + 1e-9)) * step).toFixed(decimals + 2))
      : level.price;
    map.set(key, (map.get(key) ?? 0) + level.size);
  }
  const rows = [...map.entries()]
    .sort((a, b) => (side === "ask" ? a[0] - b[0] : b[0] - a[0]))
    .slice(0, LEVELS_PER_SIDE);
  let cum = 0;
  return rows.map(([price, size]) => ({ price, size, cum: (cum += size) }));
}

export default function OrderBookPanel() {
  const orderBook = useSessionStore((s) => s.orderBook);
  const aggregatedBook = useSessionStore((s) => s.aggregatedBook);
  const mode = useSessionStore((s) => s.orderBookMode);
  const setMode = useSessionStore((s) => s.setOrderBookMode);
  const selectedVenues = useSessionStore((s) => s.selectedVenues);
  const tickSize = useSessionStore((s) => s.tickSize);
  const marketType = useSessionStore((s) => s.marketType);
  const lastTrade = useSessionStore((s) => s.ticker);
  const [group, setGroup] = useState<Group>(0);

  const multiVenue = selectedVenues.length > 1;
  const book = mode === "aggregated" || mode === "compact" ? aggregatedBook ?? orderBook : orderBook ?? aggregatedBook;
  const step = group === 0 ? 0 : tickSize * group;
  const rawDecimals = useMemo(
    () => (book ? inferDecimals([...book.bids.slice(0, 20), ...book.asks.slice(0, 20)].map((l) => l.price)) : 0),
    [book]
  );
  const decimals = step ? priceDecimals(step, lastTrade?.price) : Math.max(rawDecimals, priceDecimals(tickSize));

  const view = useMemo(() => {
    if (!book) return null;
    const asks = groupLevels(book.asks, step, "ask", decimals);
    const bids = groupLevels(book.bids, step, "bid", decimals);
    const sizes = [...asks, ...bids].map((r) => r.size).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] || 0;
    // A wall must be both far above the typical level and in the top decile.
    const wallSize = Math.max(median * 4, sizes[Math.floor(sizes.length * 0.9)] ?? Infinity);
    const maxSize = sizes[sizes.length - 1] || 1;
    const maxCum = Math.max(asks[asks.length - 1]?.cum ?? 0, bids[bids.length - 1]?.cum ?? 0) || 1;
    const bestBid = book.bids[0]?.price ?? 0;
    const bestAsk = book.asks[0]?.price ?? 0;
    const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
    const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
    const bidTotal = bids[bids.length - 1]?.cum ?? 0;
    const askTotal = asks[asks.length - 1]?.cum ?? 0;
    // Microprice: size-weighted mid that leans toward the thinner side.
    const bidSize = book.bids[0]?.size ?? 0;
    const askSize = book.asks[0]?.size ?? 0;
    const micro = bidSize + askSize > 0 ? (bestAsk * bidSize + bestBid * askSize) / (bidSize + askSize) : mid;
    return { asks, bids, median, wallSize, maxSize, maxCum, spread, mid, bidTotal, askTotal, micro };
  }, [book, step, decimals]);

  const groupOptions = GROUPS.map((g) => ({
    value: g,
    label: g === 0 ? "Raw" : formatPriceValue(tickSize * g, priceDecimals(tickSize * g)),
    title: g === 0 ? "Exchange price levels" : `Group levels into ${tickSize * g} buckets`,
  }));

  const sourceLabel = book && "venue" in book ? VENUE_LABEL[book.venue] ?? book.venue : "Consolidated";

  return (
    <Panel
      title="Order Book" icon={<Icon.Book />}
      subtitle={marketType === "forex" ? "quote proxy" : sourceLabel}
      className="orderbook-panel"
      actions={
        <>
          {multiVenue && (
            <Segmented
              size="xs"
              value={mode === "single" ? "single" : "aggregated"}
              onChange={(value) => setMode(value)}
              options={[
                { value: "aggregated", label: "Consolidated" },
                { value: "single", label: VENUE_LABEL[selectedVenues[0]]?.split(" ")[0] ?? "Primary" },
              ]}
              ariaLabel="Book source"
            />
          )}
          <Segmented size="xs" value={group} onChange={setGroup} options={groupOptions} ariaLabel="Price grouping" />
        </>
      }
      footer={
        view && (
          <div className="book-imbalance" title="Resting size within the displayed levels">
            <span className="tone-buy">{formatCompact(view.bidTotal)}</span>
            <div className="imbalance-track">
              <div
                className="imbalance-bid"
                style={{ width: `${(view.bidTotal / (view.bidTotal + view.askTotal || 1)) * 100}%` }}
              />
            </div>
            <span className="tone-sell">{formatCompact(view.askTotal)}</span>
            <strong>
              {(((view.bidTotal - view.askTotal) / (view.bidTotal + view.askTotal || 1)) * 100).toFixed(0)}%
            </strong>
          </div>
        )
      }
    >
      {!view ? (
        <div className="empty-state">Waiting for order book…</div>
      ) : (
        <div className="ladder">
          <div className="ladder-head">
            <span>Price</span>
            <span>Size</span>
            <span>Total</span>
          </div>
          <div className="ladder-side ladder-asks">
            {[...view.asks].reverse().map((row) => (
              <LadderRow key={`a${row.price}`} row={row} side="ask" view={view} decimals={decimals} />
            ))}
          </div>
          <div className="ladder-spread">
            <strong>{formatPriceValue(view.mid, decimals)}</strong>
            {view.spread < 0 ? (
              <span className="tone-warn" title="Consolidated best bid is above the best ask on another venue — an arbitrage gap between exchanges, not a tradeable spread on one book">
                Crossed {formatPriceValue(-view.spread, rawDecimals)}
              </span>
            ) : (
              <span title="Bid-ask spread">
                Spread {formatPriceValue(view.spread, rawDecimals)}
                {view.mid ? ` · ${((view.spread / view.mid) * 10_000).toFixed(2)} bp` : ""}
              </span>
            )}
            <span title="Microprice: top-of-book size-weighted mid">μ {formatPriceValue(view.micro, Math.max(rawDecimals, decimals) + 1)}</span>
          </div>
          <div className="ladder-side ladder-bids">
            {view.bids.map((row) => (
              <LadderRow key={`b${row.price}`} row={row} side="bid" view={view} decimals={decimals} />
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function LadderRow({
  row,
  side,
  view,
  decimals,
}: {
  row: Row;
  side: "bid" | "ask";
  view: { median: number; wallSize: number; maxSize: number; maxCum: number };
  decimals: number;
}) {
  const wall = view.median > 0 && row.size >= view.wallSize;
  return (
    <div
      className={`ladder-row ${side} ${wall ? "is-wall" : ""}`}
      onMouseMove={(e) =>
        showTooltip(
          `${side === "bid" ? "Bid" : "Ask"} ${formatPriceValue(row.price, decimals)}`,
          [
            `Size: ${formatCompact(row.size, 3)}`,
            `Cumulative: ${formatCompact(row.cum, 3)}`,
            `vs median level: ${view.median ? (row.size / view.median).toFixed(1) : "—"}×`,
            "",
            `What this means: Resting limit ${side === "bid" ? "buy" : "sell"} orders. ${wall ? "This level is a liquidity wall (≥4× the median level size)." : "Cumulative size is the liquidity that must be consumed to move price through this level."}`,
          ].join("\n"),
          e
        )
      }
      onMouseLeave={hideTooltip}
    >
      <i className="ladder-cum" style={{ width: `${(row.cum / view.maxCum) * 100}%` }} />
      <i className="ladder-bar" style={{ width: `${(row.size / view.maxSize) * 100}%` }} />
      <span className="ladder-price">{formatPriceValue(row.price, decimals)}</span>
      <span className="ladder-size">{formatCompact(row.size, 2)}</span>
      <span className="ladder-total">{formatCompact(row.cum, 1)}</span>
    </div>
  );
}
