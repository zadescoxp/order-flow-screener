// ============================================================
// REPLAY PLAYER
// Streams a recording back through the market-data manager on a virtual
// clock at 1×, 5× or 20×. Chunks are loaded from storage on demand.
// Seeking backwards resets the manager and fast-forwards from the start.
// ============================================================

import type { MarketDataManager } from "@/lib/managers/marketDataManager";
import type { RecordedEvent, RecordingChunk, RecordingMeta, RecordingStorage, ReplaySpeed, ReplayStatus } from "./types";

export const TICK_MS = 50;
const STATUS_MS = 200;
/** Events processed per slice while fast-forwarding, before yielding to the UI. */
const FAST_FORWARD_SLICE = 20_000;

export interface PlayerOptions {
  storage: RecordingStorage;
  manager: Pick<MarketDataManager, "beginReplay" | "ingest" | "advanceClock" | "flushNow">;
  meta: RecordingMeta;
  onStatus: (status: ReplayStatus) => void;
  /** Overridable for tests. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  wallNow?: () => number;
}

export class ReplayPlayer {
  private readonly storage: RecordingStorage;
  private readonly manager: PlayerOptions["manager"];
  readonly meta: RecordingMeta;
  private readonly onStatus: PlayerOptions["onStatus"];
  private readonly schedule: NonNullable<PlayerOptions["schedule"]>;
  private readonly cancel: NonNullable<PlayerOptions["cancel"]>;
  private readonly wallNow: () => number;

  private position: number;
  private speed: ReplaySpeed = 1;
  private playing = false;
  private ended = false;
  private seeking = false;
  private handle: unknown = null;
  private lastWall = 0;
  private lastStatus = 0;
  private disposed = false;

  // Event cursor
  private chunk: RecordingChunk | null = null;
  private nextSeq = 0;
  private index = 0;
  private prefetch: Promise<RecordingChunk | undefined> | null = null;

  constructor(options: PlayerOptions) {
    this.storage = options.storage;
    this.manager = options.manager;
    this.meta = options.meta;
    this.onStatus = options.onStatus;
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.wallNow = options.wallNow ?? (() => performance.now());
    this.position = options.meta.startedAt;
  }

  /** Reset the manager to the recording's market and load the first chunk. */
  async load(): Promise<void> {
    this.resetCursor();
    this.manager.beginReplay(
      {
        venue: this.meta.venue,
        symbol: this.meta.symbol,
        marketType: this.meta.marketType,
        timeframe: this.meta.timeframe,
        imbalanceThreshold: this.meta.imbalanceThreshold,
        selectedVenues: this.meta.selectedVenues,
      },
      this.meta.startedAt
    );
    this.position = this.meta.startedAt;
    this.ended = false;
    await this.ensureChunk();
    this.emit(true);
  }

  play(): void {
    if (this.disposed || this.playing || this.seeking) return;
    if (this.ended) {
      void this.seek(this.meta.startedAt).then(() => this.play());
      return;
    }
    this.playing = true;
    this.lastWall = this.wallNow();
    this.loop();
    this.emit(true);
  }

  pause(): void {
    this.playing = false;
    if (this.handle !== null) this.cancel(this.handle);
    this.handle = null;
    this.manager.flushNow();
    this.emit(true);
  }

  setSpeed(speed: ReplaySpeed): void {
    this.speed = speed;
    this.emit(true);
  }

  /** Jump to a virtual time. Backwards jumps replay from the start without delays. */
  async seek(target: number): Promise<void> {
    if (this.disposed) return;
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    target = Math.min(Math.max(target, this.meta.startedAt), this.meta.endedAt);
    this.seeking = true;
    this.emit(true);
    if (target < this.position) await this.load();
    // Fast-forward in slices so the page stays responsive.
    for (;;) {
      const processed = await this.deliverUntil(target, FAST_FORWARD_SLICE);
      if (this.disposed) return;
      if (processed < FAST_FORWARD_SLICE) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this.position = target;
    this.manager.advanceClock(target);
    this.manager.flushNow();
    this.seeking = false;
    this.ended = target >= this.meta.endedAt;
    this.emit(true);
    if (wasPlaying && !this.ended) this.play();
  }

  dispose(): void {
    this.disposed = true;
    this.playing = false;
    if (this.handle !== null) this.cancel(this.handle);
    this.handle = null;
  }

  status(): ReplayStatus {
    return {
      meta: this.meta,
      position: this.position,
      playing: this.playing,
      speed: this.speed,
      ended: this.ended,
      seeking: this.seeking,
    };
  }

  // ─── Internals ────────────────────────────────────────────────
  private loop(): void {
    this.handle = this.schedule(() => void this.step(), TICK_MS);
  }

  private async step(): Promise<void> {
    this.handle = null;
    if (!this.playing || this.disposed) return;
    const wall = this.wallNow();
    // Clamp the elapsed time so a throttled background tab doesn't jump minutes ahead.
    const elapsed = Math.min(wall - this.lastWall, 1000);
    this.lastWall = wall;
    const target = Math.min(this.position + elapsed * this.speed, this.meta.endedAt);
    await this.deliverUntil(target, Infinity);
    if (!this.playing || this.disposed) return;
    this.position = target;
    this.manager.advanceClock(target);
    if (target >= this.meta.endedAt && this.exhausted()) {
      this.playing = false;
      this.ended = true;
      this.manager.flushNow();
      this.emit(true);
      return;
    }
    this.emit(false);
    this.loop();
  }

  /** Deliver events with arrival time ≤ target; returns how many were delivered. */
  private async deliverUntil(target: number, limit: number): Promise<number> {
    let delivered = 0;
    while (delivered < limit) {
      const event = await this.peek();
      if (!event || event[0] > target) break;
      this.manager.ingest(event[1], event[2], event[0]);
      this.index++;
      delivered++;
    }
    return delivered;
  }

  private async peek(): Promise<RecordedEvent | undefined> {
    if (this.chunk && this.index < this.chunk.events.length) {
      // Start loading the next chunk before this one runs out.
      if (!this.prefetch && this.chunk.events.length - this.index < 500 && this.nextSeq < this.meta.chunks) {
        this.prefetch = this.storage.getChunk(this.meta.id, this.nextSeq);
      }
      return this.chunk.events[this.index];
    }
    if (!(await this.ensureChunk())) return undefined;
    return this.chunk!.events[this.index];
  }

  /** Make `this.chunk` a chunk with events left; false at the end of the recording. */
  private async ensureChunk(): Promise<boolean> {
    while (!this.chunk || this.index >= this.chunk.events.length) {
      if (this.nextSeq >= this.meta.chunks) return false;
      const next = this.prefetch ? await this.prefetch : await this.storage.getChunk(this.meta.id, this.nextSeq);
      this.prefetch = null;
      this.nextSeq++;
      if (!next) continue; // a chunk lost to an interrupted write — skip it
      this.chunk = next;
      this.index = 0;
    }
    return true;
  }

  private exhausted(): boolean {
    return (!this.chunk || this.index >= this.chunk.events.length) && this.nextSeq >= this.meta.chunks;
  }

  private resetCursor(): void {
    this.chunk = null;
    this.nextSeq = 0;
    this.index = 0;
    this.prefetch = null;
  }

  private emit(force: boolean): void {
    const wall = this.wallNow();
    if (!force && wall - this.lastStatus < STATUS_MS) return;
    this.lastStatus = wall;
    this.onStatus(this.status());
  }
}
