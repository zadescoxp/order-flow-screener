"use client";

import React, { useMemo } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { resampleBars, rollingRealizedVolatility, rollingVolumeZScores, secondsPerYear } from "@/lib/engine/analytics";
import { formatCompact, formatPercent, formatPriceValue, formatSigned, priceDecimals, VENUE_LABEL } from "@/lib/format";
import { Stat } from "@/components/ui/Primitives";
import { AssetLogo } from "@/components/AssetLogo";
import { assetFor } from "@/lib/config/instruments";
import { zTone } from "./VolumeZScorePanel";
import { regimeTone } from "./OpenInterestPanel";
import { useMarketNow } from "@/hooks/useMarketNow";
import { OI_REGIME_HINT, OI_REGIME_LABEL, annualizeFunding, fundingRate8h, oiWindowChange, type OIWindowChange } from "@/lib/engine/derivatives";
import type { DerivativesAggregate } from "@/lib/types/market";

const REGIME_WINDOW_MS = 5 * 60_000;

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":");
}

const pct = (rate: number, digits = 4) => (rate >= 0 ? "+" : "") + (rate * 100).toFixed(digits) + "%";

// ─── Market KPI strip ────────────────────────────────────────────
// Session-level read-outs derived from the same normalized stream
// that drives the charts.

export default function MarketStatsBar() {
  const session = useSessionStore((s) => s.session);
  const ticker = useSessionStore((s) => s.ticker);
  const tickSize = useSessionStore((s) => s.tickSize);
  const flowBars = useSessionStore((s) => s.flowBars);
  const liveBar = useSessionStore((s) => s.liveBar);
  const profile = useSessionStore((s) => s.volumeProfile);
  const marketType = useSessionStore((s) => s.marketType);
  const symbol = useSessionStore((s) => s.symbol);
  const venue = useSessionStore((s) => s.venue);
  const derivatives = useSessionStore((s) => s.derivatives);
  const oiHistory = useSessionStore((s) => s.oiHistory);
  const selectedVenues = useSessionStore((s) => s.selectedVenues);
  const isPerp = marketType === "perpetual";
  const now = useMarketNow(1000);
  const oiChange = useMemo(() => (isPerp ? oiWindowChange(oiHistory, REGIME_WINDOW_MS) : null), [isPerp, oiHistory]);

  const studies = useMemo(() => {
    const bars = liveBar ? [...flowBars, liveBar] : flowBars;
    const last10 = bars.slice(-11, -1);
    const tradesPerSec = last10.length ? last10.reduce((s, b) => s + b.trades, 0) / last10.length : 0;
    const bars5 = resampleBars(bars.slice(-900), 5);
    const rv = rollingRealizedVolatility(bars5, 60, 5, secondsPerYear(marketType)).at(-1)?.value ?? null;
    const z = rollingVolumeZScores(bars5, 20).at(-1)?.z ?? null;
    return { tradesPerSec, rv, z };
  }, [flowBars, liveBar, marketType]);

  const last = ticker?.price ?? session?.last ?? 0;
  const decimals = priceDecimals(tickSize, last);
  const px = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "—" : formatPriceValue(v, decimals));
  const change = session ? last - session.open : 0;
  const changePct = session && session.open ? (change / session.open) * 100 : 0;
  const rangeBp = session && session.low ? ((session.high - session.low) / session.low) * 10_000 : 0;
  const vwapDist = session && session.vwap ? ((last - session.vwap) / session.vwap) * 100 : 0;
  const vwapSigma = session && session.vwapStd > 0 ? (last - session.vwap) / session.vwapStd : 0;
  const delta = session ? session.buyVolume - session.sellVolume : 0;
  const buyShare = session && session.volume ? (session.buyVolume / session.volume) * 100 : 50;
  const base = marketType === "forex" ? symbol.split("/")[0] : symbol.replace(/USDT?$|USDC$/, "");
  const assetName = marketType === "forex" ? undefined : assetFor(symbol)?.name;
  const venueLabel = marketType === "forex" ? "FX feed" : VENUE_LABEL[venue] ?? venue;
  const quote = marketType === "forex" ? "" : symbol.endsWith("USDT") ? "$" : "";

  return (
    <section className="hero" aria-label="Session statistics">
      <div className="hero-main" title={session ? `${formatSigned(change, 2)} since session open` : undefined}>
        <div className="hero-id">
          <AssetLogo symbol={symbol} size={30} />
          <div>
            <strong>{marketType === "forex" ? symbol : `${base}/USDT`}</strong>
            <small>{assetName ?? venueLabel} · {marketType === "perpetual" ? "Perp" : marketType === "spot" ? "Spot" : "FX"}</small>
          </div>
        </div>
        <span className={`hero-price-value ${change >= 0 ? "is-up" : "is-down"}`}>{px(last || undefined)}</span>
        <span className={`change-pill ${change >= 0 ? "up" : "down"}`}>
          {change >= 0 ? "▲" : "▼"} {formatPercent(Math.abs(changePct), 2, false)}
        </span>
      </div>
      <div className="hero-stats">
        {/* One row. Lower-priority stats drop out as the strip narrows (see .hero-stats in globals.css). */}
        <Stat
          label="Range"
          value={session ? `${rangeBp.toFixed(0)} bp` : "—"}
          sub={session ? `${px(session.low)} – ${px(session.high)}` : undefined}
          title={session ? `Session high ${px(session.high)} · low ${px(session.low)}` : "Session high – low"}
        />
        <Stat
          label="VWAP"
          value={px(session?.vwap)}
          sub={session ? `${vwapSigma >= 0 ? "+" : ""}${vwapSigma.toFixed(1)}σ · ${formatPercent(vwapDist, 2)}` : undefined}
          tone="vwap"
          title="Session volume-weighted average price; σ is the volume-weighted standard deviation of traded prices"
        />
        <Stat label="POC" value={px(profile?.poc)} sub={profile ? `VA ${px(profile.val)} – ${px(profile.vah)}` : undefined} tone="poc" />
        <Stat
          label="Delta"
          value={session ? formatSigned(delta) : "—"}
          sub={session ? `${buyShare.toFixed(1)}% buy` : undefined}
          tone={delta >= 0 ? "buy" : "sell"}
        />
        {isPerp && <DerivativesStats derivatives={derivatives} oiChange={oiChange} now={now} base={base} multiVenue={selectedVenues.length > 1} />}
        <Stat
          className="stat-p2"
          label={marketType === "forex" ? "Ticks" : "Volume"}
          value={session ? formatCompact(session.volume) : "—"}
          sub={session && marketType !== "forex" ? `${quote}${formatCompact(session.notional)}` : undefined}
        />
        <Stat
          className="stat-p2"
          label="Realized vol"
          value={studies.rv === null ? "—" : `${studies.rv.toFixed(1)}%`}
          sub="5m ann."
          tone="warn"
          title="Annualized realized volatility from 60 × 5-second log returns"
        />
        <Stat
          className="stat-p3"
          label="Trades / s"
          value={studies.tradesPerSec.toFixed(1)}
          sub={session ? `${formatCompact(session.trades)} total` : undefined}
        />
        <Stat
          className="stat-p3"
          label="Volume z"
          value={studies.z === null ? "—" : `${studies.z >= 0 ? "+" : ""}${studies.z.toFixed(2)}σ`}
          sub="5s vs 20"
          tone={zTone(studies.z)}
          title="Volume in the current 5-second bar versus the previous 20 bars"
        />
      </div>
    </section>
  );
}

function DerivativesStats({
  derivatives: d,
  oiChange,
  now,
  base,
  multiVenue,
}: {
  derivatives: DerivativesAggregate | null;
  oiChange: OIWindowChange | null;
  now: number;
  base: string;
  multiVenue: boolean;
}) {
  // A single venue shows its native funding rate; an aggregate shows the OI-weighted 8h-equivalent.
  const fundingRate = multiVenue ? d?.fundingRate8h ?? null : d?.primaryFundingRate ?? null;
  const fundingHours = multiVenue ? 8 : d?.fundingIntervalHours ?? 8;
  const fundingTone = fundingRate === null ? undefined : fundingRate > 0 ? "buy" : fundingRate < 0 ? "sell" : "muted";
  const countdown = d?.nextFundingTime && now ? formatCountdown(d.nextFundingTime - now) : null;
  const perVenue = (d?.venues ?? []).flatMap((v) => {
    const rate = fundingRate8h(v);
    if (rate === undefined) return [];
    const label = VENUE_LABEL[v.venue] ?? v.venue;
    return [`${label}: ${pct(v.fundingRate ?? 0)} / ${v.fundingIntervalHours ?? 8}h (${pct(rate)} 8h)`];
  });
  const oiPerVenue = (d?.venues ?? []).flatMap((v) =>
    v.openInterest === undefined ? [] : [`${VENUE_LABEL[v.venue] ?? v.venue}: ${formatCompact(v.openInterest, 2)} ${base}`]
  );
  const regime = oiChange?.regime;
  const nl = String.fromCharCode(10);

  return (
    <>
      <Stat
        label="Open interest"
        value={d?.openInterestValue ? `$${formatCompact(d.openInterestValue, 2)}` : "—"}
        sub={
          oiChange ? (
            <>
              {formatPercent(oiChange.oiChange * 100, 2)} ·{" "}
              <span className={`tone-${regimeTone(regime)}`}>{regime ? OI_REGIME_LABEL[regime] : "—"}</span>
            </>
          ) : d?.openInterest ? (
            `${formatCompact(d.openInterest, 2)} ${base}`
          ) : undefined
        }
        tone="accent"
        title={[
          `Open contracts: ${d?.openInterest ? `${formatCompact(d.openInterest, 2)} ${base}` : "—"}`,
          ...oiPerVenue,
          "",
          regime && oiChange
            ? `5m positioning: ${OI_REGIME_LABEL[regime]} (price ${formatPercent(oiChange.priceChange * 100, 2)}, OI ${formatPercent(oiChange.oiChange * 100, 2)}). ${OI_REGIME_HINT[regime]}`
            : "5m positioning: needs open-interest history",
        ].join(nl)}
      />
      <Stat
        label={multiVenue ? "Funding 8h avg" : `Funding ${fundingHours}h`}
        value={fundingRate === null ? "—" : pct(fundingRate)}
        sub={
          fundingRate === null
            ? undefined
            : countdown ? `in ${countdown}` : d?.nextFundingTime ? "in —" : "continuous"
        }
        tone={fundingTone}
        title={[
          "Positive funding: longs pay shorts. Negative: shorts pay longs.",
          fundingRate === null ? "" : `Annualized: ${formatPercent(annualizeFunding(fundingRate, fundingHours) * 100, 1)}`,
          ...perVenue,
        ].join(nl)}
      />
      <Stat
        className="stat-p2"
        label="Basis"
        value={d?.basisBps == null ? "—" : `${d.basisBps >= 0 ? "+" : ""}${d.basisBps.toFixed(1)} bp`}
        sub={d?.markPrice && d.indexPrice ? "vs index" : undefined}
        tone={d?.basisBps == null ? undefined : d.basisBps >= 0 ? "buy" : "sell"}
        title="Perpetual mark price relative to the venue's spot index. Positive: the perp trades at a premium."
      />
    </>
  );
}
