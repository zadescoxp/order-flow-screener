"use client";

import React, { useMemo } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { useMarketNow } from "@/hooks/useMarketNow";
import { venueSummary } from "@/lib/engine/venues";
import { formatCompact, formatPriceValue, formatSigned, priceDecimals, VENUE_LABEL } from "@/lib/format";
import { VenueLogo } from "@/components/AssetLogo";
import { Icon } from "@/components/ui/Icons";
import { Panel, Stat } from "@/components/ui/Primitives";

// ─── Cross-venue ─────────────────────────────────────────────────
// Each venue's price against the others, its share of the last minute's
// volume and delta, and whether its price tends to move first.

function leadLabel(ms: number | null): string {
  if (ms === null) return "—";
  if (ms === 0) return "in sync";
  return ms > 0 ? `leads ${ms} ms` : `lags ${-ms} ms`;
}

export default function VenuesPanel() {
  const buckets = useSessionStore((s) => s.venueBuckets);
  const selected = useSessionStore((s) => s.selectedVenues);
  const tickSize = useSessionStore((s) => s.tickSize);
  const now = useMarketNow(1000);

  const summary = useMemo(() => (now ? venueSummary(buckets, now) : { stats: [], leader: null }), [buckets, now]);
  const decimals = priceDecimals(tickSize, summary.stats[0]?.last);
  const maxShare = Math.max(0.01, ...summary.stats.map((s) => s.share));
  const leader = summary.leader;

  return (
    <Panel
      title="Venues" icon={<Icon.Network />}
      subtitle={selected.length > 1 ? "price, flow and lead / lag by venue" : "needs two or more venues"}
      value={leader ? <span className="tone-accent">{VENUE_LABEL[leader.venue] ?? leader.venue} leads</span> : undefined}
      className="venues-panel"
      footer={
        <div className="study-stats">
          <Stat
            label="Leader"
            value={leader ? VENUE_LABEL[leader.venue] ?? leader.venue : "—"}
            sub={leader ? `${leader.leadMs} ms · ρ ${leader.leadCorr!.toFixed(2)}` : "no clear lead"}
            tone={leader ? "accent" : "muted"}
            title="Venue whose 250 ms price changes best predict the other venues' (lagged correlation over the last 2.5 minutes)"
          />
          <Stat
            label="Widest gap"
            value={summary.stats.length > 1 ? `${Math.max(...summary.stats.map((s) => Math.abs(s.premiumBps))).toFixed(1)} bp` : "—"}
            sub="vs median venue"
            title="Largest distance of any venue's last price from the median venue price"
          />
        </div>
      }
    >
      {selected.length < 2 ? (
        <div className="empty-state">Choose All perps or All spot to compare venues.</div>
      ) : summary.stats.length === 0 ? (
        <div className="empty-state">Waiting for trades…</div>
      ) : (
        <div className="venues-table" role="table" aria-label="Venue comparison">
          <div className="venues-row venues-head" role="row">
            <span role="columnheader">Venue</span>
            <span role="columnheader">Last</span>
            <span role="columnheader" title="Last price vs the median venue, basis points">vs mid</span>
            <span role="columnheader" title="Share of the last minute's volume">Vol 1m</span>
            <span role="columnheader" title="Aggressive buy − sell volume over the last minute">Δ 1m</span>
            <span role="columnheader" title="Lag at which this venue's price changes best match the other venues'">Lead</span>
          </div>
          {summary.stats.map((s) => (
            <div key={s.venue} className={`venues-row ${leader?.venue === s.venue ? "is-leader" : ""}`} role="row">
              <span className="venues-name" role="cell">
                <VenueLogo venue={s.venue} size={16} />
                {VENUE_LABEL[s.venue] ?? s.venue}
              </span>
              <span role="cell">{formatPriceValue(s.last, decimals)}</span>
              <span role="cell" className={Math.abs(s.premiumBps) < 0.5 ? "tone-muted" : s.premiumBps > 0 ? "tone-buy" : "tone-sell"}>
                {s.premiumBps >= 0 ? "+" : ""}{s.premiumBps.toFixed(1)}
              </span>
              <span role="cell" className="venues-share" title={`${formatCompact(s.volume, 3)} traded`}>
                <i style={{ width: `${(s.share / maxShare) * 100}%` }} />
                <b>{(s.share * 100).toFixed(0)}%</b>
              </span>
              <span role="cell" className={s.delta >= 0 ? "tone-buy" : "tone-sell"}>{formatSigned(s.delta)}</span>
              <span
                role="cell"
                className={s.leadMs !== null && s.leadMs > 0 ? "tone-accent" : "tone-muted"}
                title={s.leadCorr !== null ? `Correlation ${s.leadCorr.toFixed(2)} at this lag` : "Not enough co-movement to estimate"}
              >
                {leadLabel(s.leadMs)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
