// ============================================================
// BASE EXCHANGE ADAPTER
// All exchange adapters extend this abstract class
// ============================================================

import { EventEmitter } from "events";
import type { NormalizedTrade, NormalizedOrderBook, VenueConnection, Venue } from "@/lib/types/market";

export type AdapterEvent = "trade" | "orderbook" | "status";

export abstract class BaseExchangeAdapter extends EventEmitter {
  abstract readonly venue: Venue;
  protected ws: WebSocket | null = null;
  protected reconnectAttempts = 0;
  protected maxReconnectAttempts = 20;
  protected reconnectDelay = 1000;
  protected pingInterval: ReturnType<typeof setInterval> | null = null;
  protected lastHeartbeat = 0;
  protected staleThresholdMs = 30_000;
  public symbol: string;
  protected status: VenueConnection["status"] = "connecting";

  constructor(symbol: string) {
    super();
    this.symbol = symbol;
  }

  abstract connect(): void;
  abstract disconnect(): void;
  protected abstract buildWsUrl(): string;
  protected abstract handleMessage(raw: unknown): void;
  protected abstract sendPing(): void;

  protected reconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus("offline");
      return;
    }
    const delay = Math.min(
      this.reconnectDelay * 2 ** this.reconnectAttempts,
      30_000
    );
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), delay);
  }

  protected setStatus(s: VenueConnection["status"]): void {
    this.status = s;
    const conn: VenueConnection = {
      venue: this.venue,
      status: s,
      lastHeartbeat: this.lastHeartbeat,
      reconnectAttempts: this.reconnectAttempts,
    };
    this.emit("status", conn);
  }

  protected emitTrade(trade: NormalizedTrade): void {
    this.emit("trade", trade);
  }

  protected emitOrderBook(book: NormalizedOrderBook): void {
    this.emit("orderbook", book);
  }

  getStatus(): VenueConnection {
    return {
      venue: this.venue,
      status: this.status,
      lastHeartbeat: this.lastHeartbeat,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}
