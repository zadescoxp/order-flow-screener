/* eslint-disable @next/next/no-img-element -- small static SVGs from /public; no optimisation needed */
import { assetFor, baseOf, VENUE_LOGOS } from "@/lib/config/instruments";

export function AssetLogo({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const asset = assetFor(symbol);
  const base = baseOf(symbol);
  if (asset?.logo) {
    return <img className="asset-logo" src={`/coins/${base.toLowerCase()}.svg`} alt="" width={size} height={size} />;
  }
  // Monogram fallback (FX pairs and coins without a bundled logo).
  const color = asset?.color ?? "var(--bg-active)";
  return (
    <span
      className="asset-logo asset-monogram"
      style={{ width: size, height: size, fontSize: Math.max(7, size * 0.38), background: color }}
      aria-hidden
    >
      {base.slice(0, base.length > 3 ? 2 : 3)}
    </span>
  );
}

export function VenueLogo({ venue, size = 16 }: { venue: string; size?: number }) {
  const src = VENUE_LOGOS[venue];
  if (venue === "hyperliquid") {
    return (
      <span className="asset-logo asset-monogram venue-monogram" style={{ width: size, height: size, fontSize: size * 0.5, background: "#97FCE4", color: "#062a24" }} aria-hidden>
        H
      </span>
    );
  }
  if (!src) {
    return (
      <span className="asset-logo asset-monogram venue-monogram" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden>
        {venue === "deribit" ? "D" : venue.startsWith("all") ? "∑" : venue.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img className="asset-logo venue-logo" src={src} alt="" width={size} height={size} />;
}
