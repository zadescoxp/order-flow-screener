// ============================================================
// BASE EXCHANGE ADAPTER
// All exchange adapters extend this abstract class
// ============================================================

import { EventEmitter } from "events";
import type {
  DerivativesSnapshot,
  NormalizedLiquidation,
  NormalizedTrade,
  NormalizedOrderBook,
  VenueConnection,
  Venue,
} from "@/lib/types/market";

export type AdapterEvent = "trade" | "orderbook" | "status" | "liquidation" | "derivatives";

/** Parse an exchange numeric field; undefined when missing or not finite. */
export function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

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
  protected stateFlag: string | undefined;
  private intentionallyOffline = false;
  /** Full in-memory book (price → size). Adapters with incremental books maintain these. */
  protected bids = new Map<number, number>();
  protected asks = new Map<number, number>();

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
      this.stateFlag = undefined;
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
      stateFlag: this.stateFlag,
    };
    this.emit("status", conn);
  }

  protected reportError(message: string, stateFlag?: string): void {
    this.errorMessage = message;
    this.stateFlag = stateFlag;
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
    if (
      !Number.isFinite(trade.timestamp) ||
      !Number.isFinite(trade.price) ||
      trade.price <= 0 ||
      !Number.isFinite(trade.quantity) ||
      trade.quantity <= 0
    ) {
      this.reportError(`Invalid ${this.venue} trade payload`);
      return;
    }
    this.emit("trade", trade);
  }

  protected emitOrderBook(book: NormalizedOrderBook): void {
    const isValidLevel = (level: NormalizedOrderBook["bids"][number]) =>
      Number.isFinite(level.price) &&
      level.price > 0 &&
      Number.isFinite(level.size) &&
      level.size > 0;
    const bids = book.bids.filter(isValidLevel);
    const asks = book.asks.filter(isValidLevel);
    // A momentarily one-sided book (e.g. while a delta stream is warming up)
    // is not a feed failure; skip it instead of flipping the venue to error.
    if (bids.length === 0 && asks.length === 0) {
      this.reportError(`Invalid ${this.venue} order book payload`);
      return;
    }
    if (bids.length === 0 || asks.length === 0) return;
    this.emit("orderbook", { ...book, bids, asks });
  }

  protected emitLiquidation(liquidation: Omit<NormalizedLiquidation, "venue" | "localTimestamp" | "quoteVolume">): void {
    const { price, quantity, timestamp } = liquidation;
    if (!(price > 0) || !(quantity > 0) || !Number.isFinite(timestamp)) return;
    this.emit("liquidation", {
      ...liquidation,
      venue: this.venue,
      localTimestamp: Date.now(),
      quoteVolume: price * quantity,
    } satisfies NormalizedLiquidation);
  }

  /** Emit a partial derivatives update; fields that failed to parse are dropped. */
  protected emitDerivatives(update: Omit<DerivativesSnapshot, "venue" | "timestamp"> & { timestamp?: number }): void {
    const clean: DerivativesSnapshot = { venue: this.venue, timestamp: update.timestamp ?? Date.now() };
    let any = false;
    for (const key of ["openInterest", "fundingRate", "fundingIntervalHours", "nextFundingTime", "markPrice", "indexPrice"] as const) {
      const value = update[key];
      if (value === undefined || !Number.isFinite(value)) continue;
      if (key !== "fundingRate" && value <= 0) continue;
      clean[key] = value;
      any = true;
    }
    if (any) this.emit("derivatives", clean);
  }

  /**
   * The deepest book this adapter holds, for the resting-liquidity heatmap.
   * Emitted books are capped for the ladder; this is not. Null if empty.
   */
  depthSides(): { bids: ReadonlyMap<number, number>; asks: ReadonlyMap<number, number> } | null {
    return this.bids.size || this.asks.size ? { bids: this.bids, asks: this.asks } : null;
  }

  getStatus(): VenueConnection {
    return {
      venue: this.venue,
      status: this.status,
      lastHeartbeat: this.lastHeartbeat,
      reconnectAttempts: this.reconnectAttempts,
      error: this.errorMessage,
      stateFlag: this.stateFlag,
    };
  }
}
