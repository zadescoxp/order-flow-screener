// Crypto instrument catalog. Venue coverage was checked against each
// exchange's public instruments endpoint; coins without a bundled logo fall
// back to a monogram badge in their brand colour.

export interface CryptoAsset {
  base: string; // e.g. "BTC"
  name: string;
  color: string; // brand colour, used for monogram fallback
  logo: boolean; // /coins/<base>.svg is bundled
}

export const CRYPTO_ASSETS: CryptoAsset[] = [
  { base: "BTC", name: "Bitcoin", color: "#F7931A", logo: true },
  { base: "ETH", name: "Ethereum", color: "#627EEA", logo: true },
  { base: "XRP", name: "XRP", color: "#23292F", logo: true },
  { base: "BNB", name: "BNB", color: "#F3BA2F", logo: true },
  { base: "SOL", name: "Solana", color: "#9945FF", logo: true },
  { base: "DOGE", name: "Dogecoin", color: "#C2A633", logo: true },
  { base: "TRX", name: "TRON", color: "#FF060A", logo: true },
  { base: "ADA", name: "Cardano", color: "#0033AD", logo: true },
  { base: "HYPE", name: "Hyperliquid", color: "#97FCE4", logo: false },
  { base: "LINK", name: "Chainlink", color: "#2A5ADA", logo: true },
  { base: "SUI", name: "Sui", color: "#4DA2FF", logo: true },
  { base: "AVAX", name: "Avalanche", color: "#E84142", logo: true },
  { base: "BCH", name: "Bitcoin Cash", color: "#8DC351", logo: true },
  { base: "LTC", name: "Litecoin", color: "#345D9D", logo: true },
  { base: "DOT", name: "Polkadot", color: "#E6007A", logo: true },
  { base: "UNI", name: "Uniswap", color: "#FF007A", logo: true },
  { base: "NEAR", name: "NEAR", color: "#00C08B", logo: true },
  { base: "APT", name: "Aptos", color: "#2ED8A7", logo: true },
  { base: "AAVE", name: "Aave", color: "#B6509E", logo: true },
  { base: "ETC", name: "Ethereum Classic", color: "#328332", logo: true },
  { base: "ENA", name: "Ethena", color: "#7C7C7C", logo: false },
  { base: "ATOM", name: "Cosmos", color: "#6F7390", logo: true },
  { base: "ARB", name: "Arbitrum", color: "#28A0F0", logo: true },
  { base: "OP", name: "Optimism", color: "#FF0420", logo: true },
  { base: "INJ", name: "Injective", color: "#0082FA", logo: false },
  { base: "FIL", name: "Filecoin", color: "#0090FF", logo: true },
  { base: "SEI", name: "Sei", color: "#9E1F19", logo: true },
  { base: "TIA", name: "Celestia", color: "#7B2BF9", logo: true },
  { base: "WIF", name: "dogwifhat", color: "#C69C6D", logo: false },
];

export const CRYPTO_SYMBOLS = CRYPTO_ASSETS.map((asset) => `${asset.base}USDT`);

const BY_BASE = new Map(CRYPTO_ASSETS.map((asset) => [asset.base, asset]));

export function baseOf(symbol: string): string {
  if (symbol.includes("/")) return symbol.split("/")[0].toUpperCase();
  return symbol.toUpperCase().replace(/(USDT|USDC|USD)$/, "");
}

export function assetFor(symbol: string): CryptoAsset | undefined {
  return BY_BASE.get(baseOf(symbol));
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
