// ============================================================
// SESSION RECORDER
// Receives every event the manager accepts and writes it to storage in
// ~1-second chunks. Order-book snapshots and derivatives updates are
// throttled per venue; trades and liquidations are kept in full.
// ============================================================

import type { MarketEventSink } from "@/lib/managers/marketDataManager";
import type {
  DerivativesSnapshot,
  NormalizedLiquidation,
  NormalizedOrderBook,
  NormalizedTrade,
} from "@/lib/types/market";
import type { RecordedDepth, RecordedEvent, RecordingChunk, RecordingMeta, RecordingStatus, RecordingStorage } from "./types";

export const BOOK_INTERVAL_MS = 500;
export const BOOK_LEVELS = 100; // enough to rebuild the liquidity heatmap on replay
export const DERIVATIVES_INTERVAL_MS = 1000;
export const CHUNK_INTERVAL_MS = 1000;
export const MAX_CHUNK_EVENTS = 5000;
export const MAX_RECORDING_MS = 2 * 60 * 60 * 1000;

export interface RecorderOptions {
  storage: RecordingStorage;
  meta: Omit<RecordingMeta, "endedAt" | "events" | "chunks" | "bytes" | "complete">;
  onStatus: (status: RecordingStatus | null) => void;
  /** Called when the recording ends on its own (market change, size cap, storage error). */
  onEnd?: (reason: string) => void;
  now?: () => number;
}

export class SessionRecorder implements MarketEventSink {
  private readonly storage: RecordingStorage;
  private readonly onStatus: RecorderOptions["onStatus"];
  private readonly onEnd: RecorderOptions["onEnd"];
  private readonly now: () => number;
  private meta: RecordingMeta;
  private buffer: RecordedEvent[] = [];
  private seq = 0;
  private lastBook = new Map<string, number>();
  private lastDerivatives = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: RecorderOptions) {
    this.storage = options.storage;
    this.onStatus = options.onStatus;
    this.onEnd = options.onEnd;
    this.now = options.now ?? Date.now;
    this.meta = { ...options.meta, endedAt: options.meta.startedAt, events: 0, chunks: 0, bytes: 0, complete: false };
  }

  async start(): Promise<void> {
    await this.storage.putMeta(this.meta);
    this.timer = setInterval(() => void this.flush(), CHUNK_INTERVAL_MS);
    this.emitStatus();
  }

  get id(): string {
    return this.meta.id;
  }

  // ─── MarketEventSink ──────────────────────────────────────────
  seed(books: NormalizedOrderBook[], derivatives: DerivativesSnapshot[], at: number): void {
    for (const book of books) this.push([at, "b", trimBook(book)]);
    for (const snapshot of derivatives) this.push([at, "d", snapshot]);
  }

  trade(trade: NormalizedTrade, at: number): void {
    this.push([at, "t", trade]);
  }

  book(book: NormalizedOrderBook, at: number): void {
    const last = this.lastBook.get(book.venue) ?? 0;
    if (at - last < BOOK_INTERVAL_MS) return;
    this.lastBook.set(book.venue, at);
    this.push([at, "b", trimBook(book)]);
  }

  liquidation(liquidation: NormalizedLiquidation, at: number): void {
    this.push([at, "l", liquidation]);
  }

  derivatives(snapshot: DerivativesSnapshot, at: number): void {
    const last = this.lastDerivatives.get(snapshot.venue) ?? 0;
    if (at - last < DERIVATIVES_INTERVAL_MS) return;
    this.lastDerivatives.set(snapshot.venue, at);
    this.push([at, "d", snapshot]);
  }

  depth(snapshot: RecordedDepth, at: number): void {
    this.push([at, "h", snapshot]);
  }

  close(): void {
    void this.stop("market changed");
  }

  // ─── Lifecycle ────────────────────────────────────────────────
  private push(event: RecordedEvent): void {
    if (this.closed) return;
    this.buffer.push(event);
    if (this.buffer.length >= MAX_CHUNK_EVENTS) void this.flush();
  }

  /** Write buffered events as one chunk and update the meta record. */
  flush(): Promise<void> {
    if (this.buffer.length === 0) {
      if (!this.closed && this.now() - this.meta.startedAt > MAX_RECORDING_MS) void this.stop("2-hour limit reached");
      return this.writing;
    }
    const events = this.buffer;
    this.buffer = [];
    const chunk: RecordingChunk = {
      recordingId: this.meta.id,
      seq: this.seq++,
      start: events[0][0],
      end: events[events.length - 1][0],
      events,
    };
    this.meta = {
      ...this.meta,
      endedAt: Math.max(this.meta.endedAt, chunk.end),
      events: this.meta.events + events.length,
      chunks: this.seq,
      bytes: this.meta.bytes + estimateBytes(events),
    };
    const meta = this.meta;
    // Serialize writes so chunks land in order.
    this.writing = this.writing
      .then(() => this.storage.putChunk(chunk))
      .then(() => this.storage.putMeta(meta))
      .catch((error: unknown) => {
        void this.stop(`storage error: ${error instanceof Error ? error.message : String(error)}`);
      });
    this.emitStatus();
    if (this.now() - this.meta.startedAt > MAX_RECORDING_MS) void this.stop("2-hour limit reached");
    return this.writing;
  }

  async stop(reason?: string): Promise<RecordingMeta> {
    if (this.closed) {
      await this.writing;
      return this.meta;
    }
    await this.flush();
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.meta = { ...this.meta, complete: true };
    await this.writing;
    await this.storage.putMeta(this.meta).catch(() => undefined);
    this.onStatus(null);
    if (reason) this.onEnd?.(reason);
    return this.meta;
  }

  private emitStatus(): void {
    if (this.closed) return;
    this.onStatus({
      id: this.meta.id,
      startedAt: this.meta.startedAt,
      events: this.meta.events + this.buffer.length,
      bytes: this.meta.bytes,
    });
  }
}

function trimBook(book: NormalizedOrderBook): NormalizedOrderBook {
  return { ...book, bids: book.bids.slice(0, BOOK_LEVELS), asks: book.asks.slice(0, BOOK_LEVELS) };
}

/** Rough serialized size: enough for a size read-out without stringifying everything. */
function estimateBytes(events: RecordedEvent[]): number {
  let bytes = 0;
  for (const [, kind, payload] of events) {
    if (kind === "b") {
      const book = payload as NormalizedOrderBook;
      bytes += 120 + (book.bids.length + book.asks.length) * 40;
    } else if (kind === "h") bytes += 40 + (payload as RecordedDepth).index.length * 8;
    else bytes += kind === "t" ? 200 : 180;
  }
  return bytes;
}
