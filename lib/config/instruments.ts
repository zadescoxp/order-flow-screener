// Instrument catalog: crypto coins (from measured venue activity), precious
// metals traded as USDT perpetuals, and helpers for logos and venue coverage.

import type { MarketType, Venue } from "@/lib/types/market";
import { COIN_LISTINGS } from "./coinListings";

export interface CryptoAsset {
  base: string; // e.g. "BTC"
  name: string;
  color: string; // brand colour, used for the monogram fallback
  logo: boolean; // /coins/<base>.svg is bundled
  kind: "coin" | "metal";
  perp: readonly Venue[]; // venues with an active BASEUSDT perpetual
  spot: readonly Venue[]; // venues with an active BASEUSDT spot market
}

// Brand colours for well-known coins; others get a stable colour from their ticker.
const BRAND_COLORS: Record<string, string> = {
  BTC: "#F7931A", ETH: "#627EEA", XRP: "#23292F", BNB: "#F3BA2F", SOL: "#9945FF", DOGE: "#C2A633",
  TRX: "#FF060A", ADA: "#0033AD", HYPE: "#97FCE4", LINK: "#2A5ADA", SUI: "#4DA2FF", AVAX: "#E84142",
  BCH: "#8DC351", LTC: "#345D9D", DOT: "#E6007A", UNI: "#FF007A", NEAR: "#00C08B", APT: "#2ED8A7",
  AAVE: "#B6509E", ETC: "#328332", ENA: "#7C7C7C", ATOM: "#6F7390", ARB: "#28A0F0", OP: "#FF0420",
  INJ: "#0082FA", FIL: "#0090FF", SEI: "#9E1F19", TIA: "#7B2BF9", WIF: "#C69C6D", PEPE: "#3D9A3A",
  ZEC: "#ECB244", XMR: "#FF6600", XLM: "#14B6E7", TON: "#0098EA", SHIB: "#E42D04", BONK: "#F8A10B",
  TAO: "#2B2B2B", WLD: "#1B1B1B", ONDO: "#1A44C4", HBAR: "#3A3A3A", ICP: "#29ABE2", TRUMP: "#C9A13B",
};

function colorFor(base: string): string {
  if (BRAND_COLORS[base]) return BRAND_COLORS[base];
  let h = 0;
  for (const ch of base) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
}

const COINS: CryptoAsset[] = COIN_LISTINGS.map((c) => ({
  base: c.base,
  name: c.name,
  color: colorFor(c.base),
  logo: c.logo,
  kind: "coin",
  perp: c.perp as readonly Venue[],
  spot: c.spot as readonly Venue[],
}));

// Gold and silver as USDT perpetuals: real aggressor-side trades with deep
// volume (measured live), unlike the sparse spot-FX quote feed.
const METAL_VENUES: readonly Venue[] = ["binance-futures", "bybit-futures", "okx-futures", "bitget-futures"];
export const METALS: CryptoAsset[] = [
  { base: "XAU", name: "Gold", color: "#C9A227", logo: false, kind: "metal", perp: METAL_VENUES, spot: [] },
  { base: "XAG", name: "Silver", color: "#9AA3AD", logo: false, kind: "metal", perp: METAL_VENUES, spot: [] },
];

export const CRYPTO_ASSETS: CryptoAsset[] = COINS;
export const ALL_ASSETS: CryptoAsset[] = [...METALS, ...COINS];

/** Every USDT symbol the app can show (coins and metals). */
export const CRYPTO_SYMBOLS = ALL_ASSETS.map((asset) => `${asset.base}USDT`);
export const PERP_SYMBOLS = ALL_ASSETS.filter((a) => a.perp.length > 0).map((a) => `${a.base}USDT`);
export const SPOT_SYMBOLS = ALL_ASSETS.filter((a) => a.spot.length > 0).map((a) => `${a.base}USDT`);

const BY_BASE = new Map(ALL_ASSETS.map((asset) => [asset.base, asset]));

export function baseOf(symbol: string): string {
  if (symbol.includes("/")) return symbol.split("/")[0].toUpperCase();
  return symbol.toUpperCase().replace(/(USDT|USDC|USD)$/, "");
}

export function assetFor(symbol: string): CryptoAsset | undefined {
  return BY_BASE.get(baseOf(symbol));
}

export function isMetal(symbol: string): boolean {
  return assetFor(symbol)?.kind === "metal";
}

/** Venues with live data for this symbol and market type. */
export function venuesWithData(symbol: string, marketType: MarketType): readonly Venue[] {
  const asset = assetFor(symbol);
  if (!asset || symbol.toUpperCase() !== `${asset.base}USDT`) return [];
  if (marketType === "perpetual") return asset.perp;
  if (marketType === "spot") return asset.spot;
  return [];
}

export const VENUE_LOGOS: Partial<Record<string, string>> = {
  "binance-futures": "/venues/binance.svg",
  "binance-spot": "/venues/binance.svg",
  "bybit-futures": "/venues/bybit.svg",
  "bybit-spot": "/venues/bybit.svg",
  "okx-futures": "/venues/okx.svg",
  "okx-spot": "/venues/okx.svg",
  "bitget-futures": "/venues/bitget.svg",
  "bitget-spot": "/venues/bitget.svg",
  "coinbase-spot": "/venues/coinbase.svg",
};
