// Venue badges drawn on canvas next to footprint bubbles, so a big print or
// liquidation in an aggregated view shows which exchange it happened on.
//
// Each badge is a disc in the exchange's brand colour with a single-colour
// glyph on top (no white backgrounds), ringed in the panel colour so it reads
// against both buy (green) and sell (red) bubbles.

import type { Palette } from "@/hooks/useCanvas";

interface BadgeStyle {
  tile: string; // brand colour of the disc
  ink: string; // glyph colour
  glyph?: string; // single-colour mark under /public/venues/mono
  letter?: string; // fallback when there is no glyph
  scale?: number; // glyph size relative to the badge width
  aspect?: number; // width / height; wordmarks use a pill instead of a disc
}

const STYLES: Record<string, BadgeStyle> = {
  binance: { tile: "#F0B90B", ink: "#181A20", glyph: "/venues/mono/binance.svg" },
  bybit: { tile: "#F7A600", ink: "#15161A", glyph: "/venues/mono/bybit.svg", aspect: 2.1, scale: 1.05 },
  okx: { tile: "#34353D", ink: "#FFFFFF", glyph: "/venues/mono/okx.svg", aspect: 1.9, scale: 1.0 },
  bitget: { tile: "#00D7E4", ink: "#05161B", glyph: "/venues/mono/bitget.svg" },
  coinbase: { tile: "#0052FF", ink: "#FFFFFF", glyph: "/venues/mono/coinbase.svg" },
  deribit: { tile: "#1C55F5", ink: "#FFFFFF", glyph: "/venues/mono/deribit.png" },
  hyperliquid: { tile: "#97FCE4", ink: "#062A24", letter: "H" },
};

/** "binance-futures" → "binance"; venues without a suffix map to themselves. */
export function venueBrand(venue: string): string {
  return venue.replace(/-(futures|spot)$/, "");
}

export function badgeStyle(venue: string): BadgeStyle {
  return STYLES[venueBrand(venue)] ?? { tile: "#3A3B42", ink: "#FFFFFF", letter: venue.slice(0, 1).toUpperCase() };
}

const GLYPH_PX = 96; // glyphs are recoloured once at this size and cached
const images = new Map<string, HTMLImageElement>();
const tinted = new Map<string, HTMLCanvasElement>();
const listeners = new Set<() => void>();

function glyphImage(src: string): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
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

/** The glyph filled with a single ink colour (alpha-masked), cached per brand. */
function tintedGlyph(style: BadgeStyle): HTMLCanvasElement | null {
  if (!style.glyph || typeof document === "undefined") return null;
  const key = `${style.glyph}|${style.ink}`;
  const cached = tinted.get(key);
  if (cached) return cached;
  const img = glyphImage(style.glyph);
  if (!img) return null;
  const canvas = document.createElement("canvas");
  canvas.width = GLYPH_PX;
  canvas.height = GLYPH_PX;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.drawImage(img, 0, 0, GLYPH_PX, GLYPH_PX);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = style.ink;
  g.fillRect(0, 0, GLYPH_PX, GLYPH_PX);
  tinted.set(key, canvas);
  return canvas;
}

/** Subscribe to glyph loads (to repaint once images are ready). Returns an unsubscribe. */
export function onVenueLogosReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Badge diameter for a bubble of radius `r`: large enough to recognise at a glance. */
export function badgeSize(r: number): number {
  return Math.round(Math.min(24, Math.max(18, 13 + r * 0.6)));
}

const RING = 2; // panel-coloured ring around the badge

/**
 * Badge centre and outer radius (including its ring) for a bubble at (x, y)
 * with radius r. Pills (aspect > 1) extend to the right of the same anchor;
 * the returned radius covers their full width for overlap checks.
 */
export function badgePosition(x: number, y: number, r: number, aspect = 1): { x: number; y: number; r: number } {
  const size = badgeSize(r);
  const outer = size / 2 + RING;
  // Anchor on the bubble's 45° edge, pushed out so it covers at most a small part of the bubble.
  const offset = (Math.max(r, 5) + outer * 0.45) * Math.SQRT1_2;
  const extra = (size * aspect - size) / 2;
  return { x: x + offset + extra, y: y - offset, r: outer + extra };
}

/** Smallest big-print bubble that gets a badge; smaller ones name the venue in the tooltip only. */
export const MIN_TRADE_BADGE_RADIUS = 7;

/**
 * Pick which bubbles get a badge: liquidations first, then big prints from
 * largest to smallest, skipping any badge that would overlap one already
 * placed. Keeps the biggest events legible in crowded candles.
 */
export function selectBadged<T extends { x: number; y: number; r: number; kind: "trade" | "liquidation" }>(
  bubbles: T[],
  venueOf?: (bubble: T) => string
): T[] {
  const candidates = bubbles
    .filter((b) => b.kind === "liquidation" || b.r >= MIN_TRADE_BADGE_RADIUS)
    .sort((a, b) => (a.kind === b.kind ? b.r - a.r : a.kind === "liquidation" ? -1 : 1));
  const placed: { x: number; y: number; r: number }[] = [];
  const chosen: T[] = [];
  for (const bubble of candidates) {
    const spot = badgePosition(bubble.x, bubble.y, bubble.r, venueOf ? badgeStyle(venueOf(bubble)).aspect : 1);
    if (placed.some((o) => Math.hypot(o.x - spot.x, o.y - spot.y) < o.r + spot.r)) continue;
    placed.push(spot);
    chosen.push(bubble);
  }
  return chosen;
}

/**
 * Draw a venue badge on the top-right edge of a bubble centred at (x, y)
 * with radius r. Returns the badge's centre and outer radius for hit-testing.
 */
export function drawVenueBadge(
  ctx: CanvasRenderingContext2D,
  venue: string,
  x: number,
  y: number,
  r: number,
  p: Palette
): { x: number; y: number; r: number } {
  const style = badgeStyle(venue);
  const size = badgeSize(r);
  const w = size * (style.aspect ?? 1);
  const { x: cx, y: cy, r: hitR } = badgePosition(x, y, r, style.aspect);

  ctx.save();
  // Panel-coloured ring separates the badge from the bubble underneath.
  ctx.beginPath();
  ctx.roundRect(cx - w / 2 - RING, cy - size / 2 - RING, w + RING * 2, size + RING * 2, size / 2 + RING);
  ctx.fillStyle = p.bgPanel;
  ctx.fill();

  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - size / 2, w, size, size / 2);
  ctx.fillStyle = style.tile;
  ctx.fill();

  const glyph = tintedGlyph(style);
  if (glyph) {
    ctx.clip();
    // Glyph boxes have built-in padding; scale so the mark fills most of the badge.
    const g = w * (style.scale ?? 0.92);
    ctx.drawImage(glyph, cx - g / 2, cy - g / 2, g, g);
  } else {
    ctx.fillStyle = style.ink;
    ctx.font = `800 ${Math.round(size * 0.56)}px Geist, ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(style.letter ?? venue.slice(0, 1).toUpperCase(), cx, cy + 0.5);
  }
  ctx.restore();
  return { x: cx, y: cy, r: hitR };
}

/** Warm the image cache so the first bubbles already have glyphs. */
export function preloadVenueLogos(venues: readonly string[]): void {
  for (const venue of venues) {
    const style = badgeStyle(venue);
    if (style.glyph) glyphImage(style.glyph);
  }
}
