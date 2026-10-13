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
    const trade: NormalizedTrade = {
      id,
      venue: this.venue,
      symbol: this.symbol,
      timestamp,
      localTimestamp: Date.now(),
      price,
      quantity: Number.isFinite(size) && size > 0 ? size : 1,
      quoteVolume: price * (Number.isFinite(size) && size > 0 ? size : 1),
      side: price >= ask ? "buy" : "sell",
      marketType: this.marketType,
    };
    this.emitTrade(trade);
    const book: NormalizedOrderBook = {
      venue: this.venue,
      symbol: this.symbol,
      timestamp,
      localTimestamp: Date.now(),
      bids: [{ price: bid, size: 1, venue: this.venue }],
      asks: [{ price: ask, size: 1, venue: this.venue }],
    };
    this.emitOrderBook(book);
  }

}

export class MassiveForexAdapter extends ForexAdapter {
  readonly venue: Venue = "massive-forex";
  private readonly baseUrl = VENUE_CONFIG[this.venue]!.websocketUrl;
  private authenticated = false;

  protected buildWsUrl(): string { return this.baseUrl; }

  protected subscribe(): void {
    const key = process.env.NEXT_PUBLIC_MASSIVE_API_KEY;
    if (!key) {
      this.reportError("Missing NEXT_PUBLIC_MASSIVE_API_KEY");
      return;
    }
    this.authenticated = false;
    this.ws?.send(JSON.stringify({ action: "auth", params: key }));
  }

  protected handleMessage(raw: unknown): void {
    const messages = Array.isArray(raw) ? raw : [raw];
    for (const item of messages) {
      const message = item as {
        ev?: string;
        status?: string;
        message?: string;
        p?: string;
        b?: number;
        a?: number;
        t?: number;
      };
      if (message.ev === "status") {
        if (message.status === "auth_success") {
          this.authenticated = true;
          this.ws?.send(JSON.stringify({
            action: "subscribe",
            params: `C.${VENUE_CONFIG[this.venue]!.formatSymbol(this.symbol)}`,
          }));
        } else if (message.status === "auth_failed") {
          this.reportError(message.message ?? "Massive authentication failed");
        }
        continue;
      }
      if (message.ev !== "C" || !this.authenticated) continue;
      this.emitQuote(Number(message.b), Number(message.a), Number(message.t), 1, `${this.venue}-${message.p}-${message.t}`);
    }
  }

  protected sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("2");
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

export class MT5ForexAdapter extends ForexAdapter {
  readonly venue: Venue = "mt5-forex";
  protected buildWsUrl(): string { return VENUE_CONFIG[this.venue]!.websocketUrl; }

  protected subscribe(): void {
    this.ws?.send(JSON.stringify({ action: "subscribe", symbol: VENUE_CONFIG[this.venue]!.formatSymbol(this.symbol) }));
  }

  protected handleMessage(raw: unknown): void {
    const message = raw as {
      bid?: number; ask?: number; price?: number; volume?: number; size?: number; time?: number; timestamp?: number;
    };
    const price = Number(message.price);
    const bid = Number(message.bid ?? (price > 0 ? price - price * 0.00005 : NaN));
    const ask = Number(message.ask ?? (price > 0 ? price + price * 0.00005 : NaN));
    this.emitQuote(bid, ask, Number(message.timestamp ?? message.time ?? Date.now()), Number(message.volume ?? message.size));
  }

  protected sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "ping" }));
  }
}
