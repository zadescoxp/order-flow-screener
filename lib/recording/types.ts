// ============================================================
// SESSION RECORDING TYPES
// A recording is the normalized event stream of one market selection,
// stored in arrival order so a replay reproduces what the terminal saw.
// ============================================================

import type {
  DerivativesSnapshot,
  MarketType,
  NormalizedLiquidation,
  NormalizedOrderBook,
  NormalizedTrade,
  Timeframe,
  Venue,
  VenueSelection,
} from "@/lib/types/market";

/** [arrival time (ms), kind, payload] — compact tuples keep chunks small. */
export type RecordedEvent =
  | [number, "t", NormalizedTrade]
  | [number, "b", NormalizedOrderBook]
  | [number, "l", NormalizedLiquidation]
  | [number, "d", DerivativesSnapshot]
  | [number, "h", RecordedDepth];

/** A heatmap depth snapshot: tick-bucketed sizes, as typed arrays. */
export interface RecordedDepth {
  tick: number;
  index: Int32Array;
  size: Float32Array;
}

export interface RecordingMeta {
  id: string;
  symbol: string;
  venue: VenueSelection;
  selectedVenues: Venue[];
  marketType: MarketType;
  timeframe: Timeframe;
  imbalanceThreshold: number;
  startedAt: number;
  endedAt: number; // updated on every chunk flush, so an interrupted recording is still usable
  events: number;
  chunks: number;
  bytes: number; // approximate serialized size
  complete: boolean;
}

export interface RecordingChunk {
  recordingId: string;
  seq: number;
  start: number;
  end: number;
  events: RecordedEvent[];
}

/** Storage backend: IndexedDB in the browser, in-memory in tests. */
export interface RecordingStorage {
  putMeta(meta: RecordingMeta): Promise<void>;
  putChunk(chunk: RecordingChunk): Promise<void>;
  listMeta(): Promise<RecordingMeta[]>;
  getMeta(id: string): Promise<RecordingMeta | undefined>;
  getChunk(recordingId: string, seq: number): Promise<RecordingChunk | undefined>;
  delete(id: string): Promise<void>;
}

export interface RecordingStatus {
  id: string;
  startedAt: number;
  events: number;
  bytes: number;
}

export type ReplaySpeed = 1 | 5 | 20;

export interface ReplayStatus {
  meta: RecordingMeta;
  position: number; // virtual clock (ms)
  playing: boolean;
  speed: ReplaySpeed;
  ended: boolean;
  seeking: boolean;
}
