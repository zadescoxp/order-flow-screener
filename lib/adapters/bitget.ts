// ============================================================
// BITGET ADAPTERS (Siebly `bitget-api`, v2 public channels)
// ============================================================

import type { BitgetInstTypeV2, WebsocketClientV2, WsPublicTopicV2 } from "bitget-api";
import { num } from "./base";
import { applyLevels, emitBook, parseBitgetTrades } from "./book";
import { quietLogger, SieblyAdapter, type AckResult } from "./siebly";
import type { Venue } from "@/lib/types/market";

type BitgetTopic = { instType: BitgetInstTypeV2; topic: WsPublicTopicV2; instId: string };
type BitgetMessage = { arg: { channel: string }; action?: string; data: unknown[] };

abstract class BitgetAdapter extends SieblyAdapter<WebsocketClientV2, BitgetTopic> {
  protected abstract readonly instType: BitgetInstTypeV2;
  protected abstract readonly marketType: "perpetual" | "spot";
  protected abstract readonly tradeIdPrefix: string;
  protected channels(): WsPublicTopicV2[] { return ["trade", "books"]; }

  protected async createClient(): Promise<WebsocketClientV2> {
    const { WebsocketClientV2 } = await import("bitget-api");
    return new WebsocketClientV2({ pingInterval: 10_000, pongTimeout: 5_000, reconnectTimeout: 1_000 }, quietLogger("bitget-api"));
  }

  private topic(topic: WsPublicTopicV2): BitgetTopic { return { instType: this.instType, topic, instId: this.symbol }; }
  protected topics(): BitgetTopic[] { return this.channels().map((c) => this.topic(c)); }
  protected bookTopics(): BitgetTopic[] { return [this.topic("books")]; }
  protected subscribeTopics(client: WebsocketClientV2, topics: BitgetTopic[]) {
    return topics.map((t) => client.subscribeTopic(t.instType, t.topic, t.instId));
  }
  protected unsubscribeTopics(client: WebsocketClientV2, topics: BitgetTopic[]) {
    return topics.map((t) => client.unsubscribeTopic(t.instType, t.topic, t.instId));
  }

  protected ackOf(response: unknown): AckResult {
    const res = response as { event?: string; msg?: string };
    if (res.event === "subscribe") return { ok: true };
    if (res.event === "error") return { ok: false, reason: res.msg ?? "unknown reason" };
    return null;
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as BitgetMessage;
    if (!msg.arg || !msg.data) return;
    const channel = msg.arg.channel;
    if (channel === "trade") {
      // The first push is a snapshot of recent trades; skip it so old prints don't back-date the footprint.
      if (msg.action === "snapshot") return;
      for (const t of parseBitgetTrades(msg.data)) {
        const price = parseFloat(t.price), qty = parseFloat(t.size);
        this.emitTrade({ id: `${this.tradeIdPrefix}-${t.tradeId}`, venue: this.venue, symbol: this.symbol, timestamp: parseInt(t.ts), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side === "buy" ? "buy" : "sell", marketType: this.marketType });
      }
    } else if (channel === "books") {
      if (msg.action === "snapshot") {
        this.bids.clear();
        this.asks.clear();
        this.awaitingSnapshot = false;
      } else if (this.awaitingSnapshot) {
        return;
      }
      for (const d of msg.data as Array<{ bids: [string, string][]; asks: [string, string][] }>) {
        applyLevels(this.bids, d.bids, 1);
        applyLevels(this.asks, d.asks, 1);
      }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    } else if (channel === "ticker") {
      this.handleTicker?.(msg.data as Array<Record<string, string | undefined>>);
    }
  }

  protected handleTicker?(rows: Array<Record<string, string | undefined>>): void;
}

export class BitgetFuturesAdapter extends BitgetAdapter {
  readonly venue: Venue = "bitget-futures";
  protected readonly instType = "USDT-FUTURES";
  protected readonly marketType = "perpetual";
  protected readonly tradeIdPrefix = "bg";

  constructor(symbol: string) { super(symbol.toUpperCase().replace("_UMCBL", "")); }

  protected channels(): WsPublicTopicV2[] { return ["trade", "books", "ticker"]; }

  protected handleTicker(rows: Array<Record<string, string | undefined>>): void {
    // holdingAmount is open interest in base units. Bitget has no public liquidation stream.
    for (const t of rows) {
      this.emitDerivatives({
        openInterest: num(t.holdingAmount),
        fundingRate: num(t.fundingRate),
        nextFundingTime: num(t.nextFundingTime),
        markPrice: num(t.markPrice),
        indexPrice: num(t.indexPrice),
        timestamp: num(t.ts),
      });
    }
  }
}

export class BitgetSpotAdapter extends BitgetAdapter {
  readonly venue: Venue = "bitget-spot";
  protected readonly instType = "SPOT";
  protected readonly marketType = "spot";
  protected readonly tradeIdPrefix = "bgs";

  constructor(symbol: string) { super(symbol.toUpperCase()); }
}
