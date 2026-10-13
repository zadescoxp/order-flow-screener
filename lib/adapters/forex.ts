import { BaseExchangeAdapter } from "./base";
import { VENUE_CONFIG } from "@/lib/config/venues";
import type {
  NormalizedOrderBook,
  NormalizedTrade,
  Venue,
} from "@/lib/types/market";

export function isForexMarketOpen(date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  if (weekday === "Sat") return false;
  if (weekday === "Sun") return hour >= 17;
  if (weekday === "Fri") return hour < 17;
  return true;
}

abstract class ForexAdapter extends BaseExchangeAdapter {
  protected readonly marketType = "forex" as const;
  private previousPrice: number | null = null;
  private previousSide: "buy" | "sell" = "buy";
  private flowBias = 0;

  protected emitQuote(
    bid: number,
    ask: number,
    timestamp = Date.now(),
    size = 1,
    id = `${this.venue}-${timestamp}`,
  ): void {
    if (!isForexMarketOpen(new Date(timestamp))) {
      this.reportError("MARKET CLOSED 🚫", "MARKET CLOSED 🚫");
      return;
    }
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) return;
    const price = (bid + ask) / 2;
    const side = this.previousPrice === null
      ? this.previousSide
      : price > this.previousPrice
        ? "buy"
        : price < this.previousPrice
          ? "sell"
          : this.previousSide;
    this.previousPrice = price;
    this.previousSide = side;
    this.flowBias = Math.max(-0.75, Math.min(0.75, this.flowBias + (side === "buy" ? 0.08 : -0.08)));
    const quantity = Number.isFinite(size) && size > 0 ? size : 1;
    const bidLiquidity = quantity * (1 + this.flowBias);
    const askLiquidity = quantity * (1 - this.flowBias);
    const trade: NormalizedTrade = {
      id,
      venue: this.venue,
      symbol: this.symbol,
      timestamp,
      localTimestamp: Date.now(),
      price,
      quantity,
      quoteVolume: price * quantity,
      side,
      marketType: this.marketType,
    };
    this.emitTrade(trade);
    const book: NormalizedOrderBook = {
      venue: this.venue,
      symbol: this.symbol,
      timestamp,
      localTimestamp: Date.now(),
      bids: [{ price: bid, size: bidLiquidity, venue: this.venue }],
      asks: [{ price: ask, size: askLiquidity, venue: this.venue }],
    };
    this.emitOrderBook(book);
  }

}

export class FinnhubForexAdapter extends ForexAdapter {
  readonly venue: Venue = "finnhub-forex";
  protected buildWsUrl(): string {
    const token = process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
    return `${VENUE_CONFIG[this.venue]!.websocketUrl}?token=${encodeURIComponent(token ?? "")}`;
  }

  protected subscribe(): void {
    if (!process.env.NEXT_PUBLIC_FINNHUB_API_KEY) {
      this.reportError("Missing NEXT_PUBLIC_FINNHUB_API_KEY");
      return;
    }
    this.ws?.send(JSON.stringify({ type: "subscribe", symbol: VENUE_CONFIG[this.venue]!.formatSymbol(this.symbol) }));
  }

  protected handleMessage(raw: unknown): void {
    const message = raw as { type?: string; data?: Array<{ p: number; t: number; v?: number }> };
    if (message.type !== "trade" || !message.data) return;
    for (const tick of message.data) {
      const price = Number(tick.p);
      const spread = Math.max(price * 0.00005, 0.00001);
      this.emitQuote(price - spread, price + spread, Number(tick.t), Number(tick.v));
    }
  }

  protected sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "ping" }));
  }
}
