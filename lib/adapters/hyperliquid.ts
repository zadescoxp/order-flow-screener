// ============================================================
// HYPERLIQUID ADAPTER (Siebly `@siebly/hyperliquid-api`)
//
// Built on the newer Siebly WebSocket base: data arrives as "message",
// drops emit "reconnecting", and closeAll() also releases sockets that are
// still opening, so no shutdown sweep is needed.
// ============================================================

import type { WebsocketClient, WebsocketSubscription } from "@siebly/hyperliquid-api";
import { num } from "./base";
import { emitBook } from "./book";
import { quietLogger, SieblyAdapter, type AckResult, type SieblyEventNames } from "./siebly";
import type { Venue } from "@/lib/types/market";

export class HyperliquidAdapter extends SieblyAdapter<WebsocketClient, WebsocketSubscription> {
  readonly venue: Venue = "hyperliquid";
  protected readonly events: SieblyEventNames = { data: "message", reconnecting: "reconnecting" };

  constructor(symbol: string) {
    // Accept BTCUSDT or BTC — normalize to BTC
    let s = symbol.toUpperCase();
    if (s.endsWith("USDT")) s = s.replace("USDT", "");
    super(s);
  }

  protected async createClient(): Promise<WebsocketClient> {
    const { WebsocketClient } = await import("@siebly/hyperliquid-api");
    return new WebsocketClient({ pingInterval: 10_000, pongTimeout: 5_000, reconnectTimeout: 1_000 }, quietLogger("hyperliquid-api"));
  }

  protected disposeClient(client: WebsocketClient): void {
    client.removeAllListeners();
    client.on("exception", () => {});
    client.closeAll();
  }

  protected topics(): WebsocketSubscription[] {
    const coin = this.symbol;
    return [{ type: "trades", coin }, { type: "l2Book", coin }, { type: "activeAssetCtx", coin }];
  }
  /** l2Book pushes full snapshots, so a resubscribe is never needed for gaps. */
  protected bookTopics(): WebsocketSubscription[] { return [{ type: "l2Book", coin: this.symbol }]; }
  protected subscribeTopics(client: WebsocketClient, topics: WebsocketSubscription[]) { return client.subscribe(topics); }
  protected unsubscribeTopics(client: WebsocketClient, topics: WebsocketSubscription[]) { return client.unsubscribe(topics); }

  protected ackOf(response: unknown): AckResult {
    const res = response as { channel?: string; data?: { method?: string } };
    return res.channel === "subscriptionResponse" && res.data?.method === "subscribe" ? { ok: true } : null;
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { channel: string; data: unknown };
    if (msg.channel === "trades") {
      for (const t of msg.data as Array<{ coin: string; side: "A" | "B"; px: string; sz: string; time: number; tid: number }>) {
        const price = parseFloat(t.px), qty = parseFloat(t.sz);
        this.emitTrade({ id: `hl-${t.tid}`, venue: this.venue, symbol: t.coin, timestamp: t.time, localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side === "B" ? "buy" : "sell", marketType: "perpetual" });
      }
    } else if (msg.channel === "l2Book") {
      const book = msg.data as { coin: string; time: number; levels: [{ px: string; sz: string }[] | [string, string][], { px: string; sz: string }[] | [string, string][]] };
      if (book.coin !== this.symbol) return;
      this.bids.clear();
      this.asks.clear();
      fillSide(this.bids, book.levels[0]);
      fillSide(this.asks, book.levels[1]);
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    } else if (msg.channel === "activeAssetCtx") {
      // Hyperliquid funds hourly, on the hour; oraclePx is its spot index.
      const { coin, ctx } = msg.data as { coin: string; ctx: { funding?: string; openInterest?: string; markPx?: string; oraclePx?: string } };
      if (coin !== this.symbol || !ctx) return;
      const hour = 3_600_000;
      this.emitDerivatives({
        openInterest: num(ctx.openInterest),
        fundingRate: num(ctx.funding),
        fundingIntervalHours: 1,
        nextFundingTime: Math.floor(Date.now() / hour) * hour + hour,
        markPrice: num(ctx.markPx),
        indexPrice: num(ctx.oraclePx),
      });
    }
  }
}

/** l2Book levels are { px, sz, n } objects on the wire; older fixtures use [px, sz] pairs. */
function fillSide(side: Map<number, number>, levels: ReadonlyArray<{ px: string; sz: string } | [string, string]>): void {
  for (const level of levels) {
    const [p, q] = Array.isArray(level) ? level : [level.px, level.sz];
    const price = parseFloat(p), qty = parseFloat(q);
    if (Number.isFinite(price) && qty > 0) side.set(price, qty);
  }
}
