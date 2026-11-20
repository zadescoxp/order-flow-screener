// ============================================================
// COINBASE SPOT ADAPTER (Siebly `coinbase-api`, Advanced Trade market data)
// ============================================================

import type { WebsocketClient } from "coinbase-api";
import { applyLevels, emitBook } from "./book";
import { quietLogger, SieblyAdapter, type AckResult } from "./siebly";
import type { Venue } from "@/lib/types/market";

type CoinbaseTopic = { topic: string; payload?: { product_ids: string[] } };
const MARKET_DATA = "advTradeMarketData";

/** BTCUSDT → BTC-USD; dashed product ids pass through. */
export function coinbaseProductId(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.includes("-")) return s;
  return `${s.replace("USDT", "").replace("USD", "")}-USD`;
}

export class CoinbaseSpotAdapter extends SieblyAdapter<WebsocketClient, CoinbaseTopic> {
  readonly venue: Venue = "coinbase-spot";

  constructor(symbol: string) { super(coinbaseProductId(symbol)); }

  protected async createClient(): Promise<WebsocketClient> {
    const { WebsocketClient } = await import("coinbase-api");
    const client = new WebsocketClient({ pingInterval: 10_000, pongTimeout: 5_000, reconnectTimeout: 1_000 }, quietLogger("coinbase-api"));
    // coinbase-api pings with ws.ping(), a Node-only protocol frame that throws
    // in the browser before the pong timer is armed. Skip it: the heartbeats
    // channel (one message a second) clears the pong timer instead, so a dead
    // socket still times out and reconnects.
    (client as unknown as { sendPingEvent: () => void }).sendPingEvent = () => {};
    return client;
  }

  private topic(topic: string): CoinbaseTopic { return { topic, payload: { product_ids: [this.symbol] } }; }
  protected topics(): CoinbaseTopic[] { return [this.topic("market_trades"), this.topic("level2"), { topic: "heartbeats" }]; }
  protected bookTopics(): CoinbaseTopic[] { return [this.topic("level2")]; }
  protected subscribeTopics(client: WebsocketClient, topics: CoinbaseTopic[]) { return client.subscribe(topics, MARKET_DATA); }
  protected unsubscribeTopics(client: WebsocketClient, topics: CoinbaseTopic[]) { return client.unsubscribe(topics, MARKET_DATA); }

  /** Coinbase confirms with a "subscriptions" message; errors arrive as exceptions. */
  protected ackOf(response: unknown): AckResult {
    const res = response as { channel?: string; type?: string };
    return res.channel === "subscriptions" || res.type === "subscriptions" ? { ok: true } : null;
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { channel?: string; events?: unknown[] };
    if (msg.channel === "market_trades") {
      for (const event of (msg.events ?? []) as Array<{ type?: string; trades?: Array<{ trade_id: string; product_id: string; price: string; size: string; side: string; time: string }> }>) {
        // The first push is a snapshot of recent trades; skip it so old prints don't back-date the footprint.
        if (event.type === "snapshot") continue;
        for (const tr of event.trades ?? []) {
          const price = parseFloat(tr.price), qty = parseFloat(tr.size);
          this.emitTrade({ id: `cb-${tr.trade_id}`, venue: this.venue, symbol: tr.product_id, timestamp: new Date(tr.time).getTime(), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: tr.side === "BUY" ? "buy" : "sell", marketType: "spot" });
        }
      }
    } else if (msg.channel === "l2_data") {
      for (const event of (msg.events ?? []) as Array<{ type: string; product_id?: string; updates?: Array<{ side: string; price_level: string; new_quantity: string }> }>) {
        if (event.product_id && event.product_id !== this.symbol) continue;
        if (event.type === "snapshot") {
          this.bids.clear();
          this.asks.clear();
          this.awaitingSnapshot = false;
        } else if (this.awaitingSnapshot) {
          continue;
        }
        const updates = event.updates ?? [];
        applyLevels(this.bids, updates.filter((u) => u.side === "bid").map((u) => [u.price_level, u.new_quantity]), 1);
        applyLevels(this.asks, updates.filter((u) => u.side !== "bid").map((u) => [u.price_level, u.new_quantity]), 1);
      }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    }
  }
}
