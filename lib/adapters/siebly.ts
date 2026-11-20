// ============================================================
// SIEBLY ADAPTER BASE
//
// Every Siebly exchange SDK (bybit-api, okx-api, binance, …) shares one
// WebSocket client design: it owns the socket, sends heartbeats with pong
// timeouts, reconnects and resubscribes, and emits "update" (topic data),
// "response" (command replies, incl. subscription acks), "reconnect",
// "reconnected", "close" and "exception". This base maps that lifecycle onto
// the adapter contract; venues only describe their topics, acks and payloads.
//
// SDKs are loaded with a dynamic import so each one ships in its own chunk
// and only downloads when its venue is used.
// ============================================================

import { BaseExchangeAdapter } from "./base";

/** Every Siebly WebsocketClient is an event emitter. */
export interface SieblyEmitter {
  // Typed per SDK (event maps differ), so only the shape is required here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: any, listener: any): unknown;
  removeAllListeners(): unknown;
}

/** The parts of a classic Siebly WebsocketClient the shutdown sweep relies on. */
export interface SieblyClient extends SieblyEmitter {
  close(wsKey: never, force?: boolean): void;
  isConnected(wsKey: never): boolean;
  getWsStore(): { getKeys(): unknown[] };
}

/** Keep SDK chatter out of the console; surface only its errors. */
export function quietLogger(tag: string) {
  return {
    trace: () => {},
    info: () => {},
    error: (...params: unknown[]) => console.warn(`[${tag}]`, ...params),
  };
}

/**
 * Shut a client down for good.
 *
 * The Siebly WS base only honours close() on a settled connection: closing
 * while a socket is still opening (or from a "reconnected" listener) is
 * overwritten to CONNECTED by its onWsOpen, leaving an orphan socket or a
 * reconnect loop (seen with bybit-api 4.8.5). So close whatever is connected
 * now, and keep checking until the SDK has dropped every connection key (an
 * intentional close deletes the key).
 */
export function disposeSieblyClient(client: SieblyClient): void {
  client.removeAllListeners();
  client.on("exception", () => {}); // late events from closing sockets
  const store = client.getWsStore();
  let checks = 0;
  const sweep = () => {
    const keys = store.getKeys() as never[];
    for (const key of keys) if (client.isConnected(key)) client.close(key, true);
    if (keys.length === 0 || ++checks > 120) clearInterval(timer);
  };
  const timer = setInterval(sweep, 250);
  sweep();
}

/** Outcome of a command reply: a subscription ack, a rejection, or unrelated. */
export type AckResult = { ok: true } | { ok: false; reason: string } | null;

/**
 * Event names differ between SDK generations: the classic base emits "update"
 * and "reconnect"; the newer one (e.g. @siebly/hyperliquid-api) emits
 * "message" and "reconnecting".
 */
export interface SieblyEventNames {
  data: string;
  reconnecting: string;
}

export abstract class SieblyAdapter<C extends SieblyEmitter, T> extends BaseExchangeAdapter {
  /** Build the SDK client (dynamic import + options). */
  protected abstract createClient(): Promise<C>;
  /** Every topic this adapter needs. */
  protected abstract topics(): T[];
  /** Topics that rebuild the order book (resubscribed after a sequence gap). */
  protected abstract bookTopics(): T[];
  protected abstract subscribeTopics(client: C, topics: T[]): unknown;
  protected abstract unsubscribeTopics(client: C, topics: T[]): unknown;
  /** Classify a "response" event. */
  protected abstract ackOf(response: unknown): AckResult;
  protected readonly events: SieblyEventNames = { data: "update", reconnecting: "reconnect" };
  /** Shut a client down for good; classic clients need the sweep. */
  protected disposeClient(client: C): void {
    disposeSieblyClient(client as unknown as SieblyClient);
  }

  private client: C | null = null;
  private offline = false;
  private generation = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** True until a book snapshot arrives; deltas before it would build a partial book. */
  protected awaitingSnapshot = true;

  /** Transport is owned by the SDK. */
  protected buildWsUrl(): string { return ""; }
  /** The SDK sends pings and drops the socket when a pong is late. */
  protected sendPing(): void {}

  /** Async setup that must finish before subscribing (e.g. contract sizes). */
  protected async prepare(): Promise<void> {}

  connect(): void {
    this.teardown();
    this.offline = false;
    this.resetBook();
    this.setStatus("connecting");
    const generation = ++this.generation;

    Promise.all([this.createClient(), this.prepare()])
      .then(([client]) => {
        if (generation !== this.generation || this.offline) {
          this.disposeClient(client);
          return;
        }
        this.client = client;
        this.wire(client);
        this.subscribeTopics(client, this.topics());
        this.watchdog = setInterval(() => this.checkStale(), 10_000);
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return;
        this.reportError(`${this.venue}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  disconnect(): void {
    this.offline = true;
    this.generation++;
    this.teardown();
    this.setStatus("offline");
  }

  private wire(client: C): void {
    const on = client.on.bind(client) as (event: string, listener: (arg: never) => void) => unknown;
    on(this.events.data, (msg: unknown) => {
      this.lastHeartbeat = Date.now();
      if (this.status !== "live") this.markLive();
      try {
        this.handleMessage(msg);
      } catch (error) {
        this.reportError(`Unable to parse ${this.venue} message: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    on("response", (res: unknown) => {
      const ack = this.ackOf(res);
      if (!ack) return;
      if (ack.ok) this.markLive();
      else this.reportError(`${this.venue} rejected subscription: ${ack.reason}`, "subscribe-rejected");
    });
    on(this.events.reconnecting, () => {
      if (this.offline) return;
      this.reconnectAttempts++;
      this.resetBook();
      this.setStatus("connecting");
    });
    on("close", () => { if (!this.offline) this.setStatus("connecting"); });
    on("exception", (err: unknown) => {
      if (this.offline) return;
      this.reportError(`${this.venue}: ${exceptionMessage(err)}`);
    });
  }

  /** A sequence gap: drop the book and resubscribe for a fresh snapshot, keeping the socket. */
  protected requestResubscribe(): void {
    this.resetBook();
    this.setStatus("stale");
    this.resubscribe(this.bookTopics());
  }

  private markLive(): void {
    this.reconnectAttempts = 0;
    this.lastHeartbeat = Date.now();
    this.errorMessage = undefined;
    this.stateFlag = undefined;
    if (this.status !== "live") this.setStatus("live");
  }

  /** The socket answers pings but no topic data has arrived for a while. */
  private checkStale(): void {
    if (this.status !== "live" || Date.now() - this.lastHeartbeat <= this.staleThresholdMs) return;
    this.resetBook();
    this.setStatus("stale");
    this.resubscribe(this.topics());
  }

  private resubscribe(topics: T[]): void {
    const client = this.client;
    if (!client || topics.length === 0) return;
    swallow(this.unsubscribeTopics(client, topics));
    swallow(this.subscribeTopics(client, topics));
  }

  protected resetBook(): void {
    this.bids.clear();
    this.asks.clear();
    this.awaitingSnapshot = true;
    this.onBookReset();
  }

  /** Clear venue-specific book state (sequence numbers). */
  protected onBookReset(): void {}

  private teardown(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    const client = this.client;
    this.client = null;
    if (client) this.disposeClient(client);
  }
}

/** Best-effort text from the different exception shapes the SDKs emit. */
function exceptionMessage(err: unknown): string {
  const e = err as { ret_msg?: string; msg?: string; message?: string; data?: unknown; event?: unknown } | undefined;
  const nested = e?.event as { msg?: string; message?: string; data?: unknown } | undefined;
  const text = e?.ret_msg ?? e?.msg ?? e?.message ?? nested?.msg ?? nested?.message ?? nested?.data ?? e?.data;
  return typeof text === "string" && text ? text : "WebSocket exception";
}

/** SDK subscribe calls may return promises (or arrays of them) that reject on reconnect. */
function swallow(result: unknown): void {
  const items = Array.isArray(result) ? result : [result];
  for (const item of items) if (item instanceof Promise) item.catch(() => {});
}
