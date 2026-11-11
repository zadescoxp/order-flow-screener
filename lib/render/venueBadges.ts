// Venue badges drawn on canvas next to footprint bubbles, so a big print or
// liquidation in an aggregated view shows which exchange it happened on.

import { VENUE_LOGOS } from "@/lib/config/instruments";
import type { Palette } from "@/hooks/useCanvas";

// Exchanges without a bundled logo get a monogram in their brand colour.
const MONOGRAMS: Record<string, { letter: string; bg: string; fg: string }> = {
  hyperliquid: { letter: "H", bg: "#97FCE4", fg: "#062a24" },
  deribit: { letter: "D", bg: "#13B2A4", fg: "#ffffff" },
};

const images = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

function imageFor(venue: string): HTMLImageElement | null {
  const src = VENUE_LOGOS[venue];
  if (!src || typeof Image === "undefined") return null;
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.onload = () => listeners.forEach((fn) => fn());
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Subscribe to logo loads (to repaint once images are ready). Returns an unsubscribe. */
export function onVenueLogosReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Badge diameter for a bubble of radius `r`: readable on small bubbles, not overpowering large ones. */
export function badgeSize(r: number): number {
  return Math.round(Math.min(16, Math.max(12, 8 + r * 0.45)));
}

/** Badge centre and outer radius (including its ring) for a bubble at (x, y) with radius r. */
export function badgePosition(x: number, y: number, r: number): { x: number; y: number; r: number } {
  // Sit on the bubble's 45° edge; small bubbles push the badge clear of the disc.
  const offset = Math.max(r, 5) * 0.72 + 1;
  return { x: x + offset, y: y - offset, r: badgeSize(r) / 2 + 1.5 };
}

/** Smallest big-print bubble that gets a badge; smaller ones name the venue in the tooltip only. */
export const MIN_TRADE_BADGE_RADIUS = 7;

/**
 * Pick which bubbles get a badge: liquidations first, then big prints from
 * largest to smallest, skipping any badge that would overlap one already
 * placed. Keeps the biggest events legible in crowded candles.
 */
export function selectBadged<T extends { x: number; y: number; r: number; kind: "trade" | "liquidation" }>(
  bubbles: T[]
): T[] {
  const candidates = bubbles
    .filter((b) => b.kind === "liquidation" || b.r >= MIN_TRADE_BADGE_RADIUS)
    .sort((a, b) => (a.kind === b.kind ? b.r - a.r : a.kind === "liquidation" ? -1 : 1));
  const placed: { x: number; y: number; r: number }[] = [];
  const chosen: T[] = [];
  for (const bubble of candidates) {
    const spot = badgePosition(bubble.x, bubble.y, bubble.r);
    if (placed.some((o) => Math.hypot(o.x - spot.x, o.y - spot.y) < o.r + spot.r)) continue;
    placed.push(spot);
    chosen.push(bubble);
  }
  return chosen;
}

/**
 * Draw a circular venue badge pinned to the top-right edge of a bubble
 * centred at (x, y) with radius r. Returns the badge's centre and radius
 * so callers can hit-test it.
 */
export function drawVenueBadge(
  ctx: CanvasRenderingContext2D,
  venue: string,
  x: number,
  y: number,
  r: number,
  p: Palette
): { x: number; y: number; r: number } {
  const size = badgeSize(r);
  const br = size / 2;
  const { x: cx, y: cy } = badgePosition(x, y, r);

  ctx.save();
  // Ring in the panel colour separates the badge from the bubble underneath.
  ctx.beginPath();
  ctx.arc(cx, cy, br + 1.5, 0, Math.PI * 2);
  ctx.fillStyle = p.bgPanel;
  ctx.fill();

  const mono = MONOGRAMS[venue];
  const img = mono ? null : imageFor(venue);
  ctx.beginPath();
  ctx.arc(cx, cy, br, 0, Math.PI * 2);
  ctx.fillStyle = mono ? mono.bg : "#ffffff";
  ctx.fill();

  if (img) {
    ctx.clip();
    const pad = size * 0.16;
    ctx.drawImage(img, cx - br + pad, cy - br + pad, size - pad * 2, size - pad * 2);
  } else {
    const letter = mono?.letter ?? venue.slice(0, 1).toUpperCase();
    ctx.fillStyle = mono?.fg ?? "#111215";
    ctx.font = `700 ${Math.round(size * 0.58)}px Geist, ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, cx, cy + 0.5);
  }
  ctx.restore();
  return { x: cx, y: cy, r: br + 1.5 };
}

/** Warm the image cache so the first bubbles already have logos. */
export function preloadVenueLogos(venues: readonly string[]): void {
  for (const venue of venues) imageFor(venue);
}
