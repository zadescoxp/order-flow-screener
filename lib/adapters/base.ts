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
  protected reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  protected lastHeartbeat = 0;
  protected staleThresholdMs = 30_000;
  public symbol: string;
  protected status: VenueConnection["status"] = "connecting";
  protected errorMessage: string | undefined;
  private intentionallyOffline = false;

  constructor(symbol: string) {
    super();
    this.symbol = symbol;
  }

  connect(): void {
    this.intentionallyOffline = false;
    this.clearReconnectTimer();
    this.stopPingInterval();
    this.setStatus("connecting");

    const ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.errorMessage = undefined;
      this.setStatus("live");
      this.startPingInterval();
      this.subscribe();
    };
    ws.onmessage = (event: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      if (this.status !== "live") this.setStatus("live");
      try {
        this.handleMessage(JSON.parse(event.data as string));
      } catch (error) {
        this.reportError(
          `Unable to parse ${this.venue} message: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    };
    ws.onerror = () => this.reportError(`${this.venue} WebSocket error`);
    ws.onclose = () => {
      this.stopPingInterval();
      this.ws = null;
      if (!this.intentionallyOffline) {
        this.setStatus("connecting");
        this.reconnect();
      }
    };
  }

  disconnect(): void {
    this.intentionallyOffline = true;
    this.clearReconnectTimer();
    this.stopPingInterval();
    this.setStatus("offline");
    this.ws?.close();
    this.ws = null;
  }

  protected abstract buildWsUrl(): string;
  protected subscribe(): void {
    throw new Error(`${this.venue} adapter does not implement subscribe()`);
  }
  protected abstract handleMessage(raw: unknown): void;
  protected abstract sendPing(): void;

  protected reconnect(): void {
    if (this.intentionallyOffline || this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus("offline");
      return;
    }
    const delay = Math.min(
      this.reconnectDelay * 2 ** this.reconnectAttempts,
      30_000
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  protected setStatus(s: VenueConnection["status"]): void {
    this.status = s;
    const conn: VenueConnection = {
      venue: this.venue,
      status: s,
      lastHeartbeat: this.lastHeartbeat,
      reconnectAttempts: this.reconnectAttempts,
      error: this.errorMessage,
    };
    this.emit("status", conn);
  }

  protected reportError(message: string): void {
    this.errorMessage = message;
    this.setStatus("error");
  }

  protected requestResubscribe(): void {
    this.setStatus("stale");
    this.ws?.close();
  }

  protected startPingInterval(intervalMs = 10_000): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (Date.now() - this.lastHeartbeat > this.staleThresholdMs) {
        this.setStatus("stale");
        this.ws?.close();
        return;
      }
      this.sendPing();
    }, intervalMs);
  }

  protected stopPingInterval(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
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
      error: this.errorMessage,
    };
  }
}
