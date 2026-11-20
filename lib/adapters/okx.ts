// ============================================================
// OKX ADAPTERS (Siebly `okx-api`)
// ============================================================

import type { WebsocketClient, WsChannelSubUnSubRequestArg } from "okx-api";
import { num } from "./base";
import { applyLevels, emitBook } from "./book";
import { quietLogger, SieblyAdapter, type AckResult } from "./siebly";
import type { Venue } from "@/lib/types/market";

type OkxArg = WsChannelSubUnSubRequestArg;
type OkxBookRow = { bids: [string, string, string, string][]; asks: [string, string, string, string][]; ts: string; seqId?: number; prevSeqId?: number };
type OkxMessage = { arg: { channel: string }; action?: string; data: unknown[] };

/** BTCUSDT → BTC-USDT (spot) or BTC-USDT-SWAP (perpetual); dashed ids pass through. */
export function okxInstId(symbol: string, swap: boolean): string {
  const s = symbol.toUpperCase();
  if (s.includes("-")) return s;
  const base = s.replace("USDT", "").replace("USD", "");
  return swap ? `${base}-USDT-SWAP` : `${base}-USDT`;
}

abstract class OkxAdapter extends SieblyAdapter<WebsocketClient, OkxArg> {
  protected abstract readonly marketType: "perpetual" | "spot";
  protected abstract readonly tradeIdPrefix: string;
  protected contractValue = 1;
  private lastSeq = -1;

  protected async createClient(): Promise<WebsocketClient> {
    const { WebsocketClient } = await import("okx-api");
    return new WebsocketClient({ market: "prod", pingInterval: 10_000, pongTimeout: 5_000, reconnectTimeout: 1_000 }, quietLogger("okx-api"));
  }

  protected bookTopics(): OkxArg[] { return [{ channel: "books", instId: this.symbol } as OkxArg]; }
  protected subscribeTopics(client: WebsocketClient, topics: OkxArg[]) { return client.subscribe(topics); }
  protected unsubscribeTopics(client: WebsocketClient, topics: OkxArg[]) { return client.unsubscribe(topics); }

  /** Rejections arrive as `event: "error"` exceptions, which the base reports. */
  protected ackOf(response: unknown): AckResult {
    return (response as { event?: string }).event === "subscribe" ? { ok: true } : null;
  }

  protected onBookReset(): void { this.lastSeq = -1; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as OkxMessage;
    if (!msg.arg || !msg.data) return;
    const channel = msg.arg.channel;
    if (channel === "trades") {
      for (const t of msg.data as Array<{ tradeId: string; instId: string; px: string; sz: string; side: "buy" | "sell"; ts: string }>) {
        const price = parseFloat(t.px), qty = parseFloat(t.sz) * this.contractValue;
        this.emitTrade({ id: `${this.tradeIdPrefix}-${t.tradeId}`, venue: this.venue, symbol: t.instId, timestamp: parseInt(t.ts), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side, marketType: this.marketType });
      }
    } else if (channel === "books") {
      // One "snapshot", then "update" deltas chained by prevSeqId → seqId; a size of 0 removes the level.
      const rows = msg.data as OkxBookRow[];
      if (msg.action === "snapshot") {
        this.bids.clear();
        this.asks.clear();
        this.awaitingSnapshot = false;
      } else if (this.awaitingSnapshot) {
        return;
      }
      for (const d of rows) {
        if (msg.action !== "snapshot" && this.lastSeq >= 0 && d.prevSeqId !== undefined && d.prevSeqId !== this.lastSeq) {
          this.requestResubscribe();
          return;
        }
        applyLevels(this.bids, d.bids, this.contractValue);
        applyLevels(this.asks, d.asks, this.contractValue);
        if (d.seqId !== undefined) this.lastSeq = d.seqId;
      }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    } else {
      this.handleExtraChannel?.(channel, msg.data);
    }
  }

  protected handleExtraChannel?(channel: string, data: unknown[]): void;
}

export class OKXFuturesAdapter extends OkxAdapter {
  readonly venue: Venue = "okx-futures";
  protected readonly marketType = "perpetual";
  protected readonly tradeIdPrefix = "okx";

  constructor(symbol: string) { super(okxInstId(symbol, true)); }

  protected topics(): OkxArg[] {
    const instId = this.symbol;
    return [
      { channel: "trades", instId },
      { channel: "books", instId },
      { channel: "open-interest", instId },
      { channel: "funding-rate", instId },
      { channel: "mark-price", instId },
      { channel: "index-tickers", instId: instId.replace(/-SWAP$/, "") },
      // Liquidations are only published for the whole instrument type.
      { channel: "liquidation-orders", instType: "SWAP" },
    ] as OkxArg[];
  }

  /** Swap sizes are in contracts; load the base-asset size of one contract first. */
  protected async prepare(): Promise<void> {
    try {
      const response = await fetch(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${encodeURIComponent(this.symbol)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { data?: Array<{ ctVal?: string }> };
      const value = Number(body.data?.[0]?.ctVal);
      if (Number.isFinite(value) && value > 0) this.contractValue = value;
    } catch (error) {
      this.reportError(`Unable to load OKX contract value: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  protected handleExtraChannel(channel: string, data: unknown[]): void {
    if (channel === "open-interest") {
      for (const d of data as Array<{ oiCcy?: string; ts?: string }>) this.emitDerivatives({ openInterest: num(d.oiCcy), timestamp: num(d.ts) });
    } else if (channel === "funding-rate") {
      for (const d of data as Array<{ fundingRate?: string; fundingTime?: string; nextFundingTime?: string }>) {
        const next = num(d.fundingTime);
        const after = num(d.nextFundingTime);
        this.emitDerivatives({
          fundingRate: num(d.fundingRate),
          nextFundingTime: next,
          fundingIntervalHours: next && after && after > next ? (after - next) / 3_600_000 : undefined,
        });
      }
    } else if (channel === "mark-price") {
      for (const d of data as Array<{ markPx?: string }>) this.emitDerivatives({ markPrice: num(d.markPx) });
    } else if (channel === "index-tickers") {
      for (const d of data as Array<{ idxPx?: string }>) this.emitDerivatives({ indexPrice: num(d.idxPx) });
    } else if (channel === "liquidation-orders") {
      for (const item of data as Array<{ instId: string; details: Array<{ side: "buy" | "sell"; posSide: string; bkPx: string; sz: string; ts: string }> }>) {
        if (item.instId !== this.symbol) continue;
        for (const d of item.details ?? []) {
          // A forced sell (posSide long, or net mode) closes a long.
          const side = d.posSide === "long" || (d.posSide !== "short" && d.side === "sell") ? "long" : "short";
          this.emitLiquidation({ id: `okxl-${item.instId}-${d.ts}-${d.sz}`, symbol: item.instId, timestamp: parseInt(d.ts), price: parseFloat(d.bkPx), quantity: parseFloat(d.sz) * this.contractValue, side });
        }
      }
    }
  }
}

export class OKXSpotAdapter extends OkxAdapter {
  readonly venue: Venue = "okx-spot";
  protected readonly marketType = "spot";
  protected readonly tradeIdPrefix = "okxs";

  constructor(symbol: string) { super(okxInstId(symbol, false)); }

  protected topics(): OkxArg[] {
    return [{ channel: "trades", instId: this.symbol }, { channel: "books", instId: this.symbol }] as OkxArg[];
  }
}
