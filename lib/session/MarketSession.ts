"use client";

import { createTerminalStore, type TerminalStore } from "@/lib/store/terminalStore";
import { MarketDataManager } from "@/lib/managers/marketDataManager";
import { SessionRecorder } from "@/lib/recording/recorder";
import { ReplayPlayer } from "@/lib/recording/player";
import { recordingStorage } from "@/lib/recording/storage";
import type { RecordingMeta, RecordingStorage, ReplaySpeed } from "@/lib/recording/types";
import { alertsNeedBackground } from "@/lib/store/alertStore";
import type { MarketType, Timeframe, Venue, VenueSelection } from "@/lib/types/market";

type MarketSettings = {
  symbol: string;
  venue: VenueSelection;
  selectedVenues: Venue[];
  marketType: MarketType;
  timeframe: Timeframe;
};

export class MarketSession {
  readonly store = createTerminalStore();
  readonly manager = new MarketDataManager(this.store);
  private recorder: SessionRecorder | null = null;
  private player: ReplayPlayer | null = null;
  private liveSettings: MarketSettings | null = null;
  /** Last reason a recording ended on its own (shown in the recordings menu). */
  recordingNotice: string | null = null;

  constructor(private readonly storageFactory: () => RecordingStorage | null = recordingStorage) {}

  pause(): void {
    this.manager.pause();
  }

  resume(): void {
    this.manager.resume();
  }

  /** Keep processing while the tab is hidden: recording, replaying, or notifying. */
  keepAliveWhenHidden(): boolean {
    return this.recorder !== null || this.player !== null || alertsNeedBackground();
  }

  dispose(): void {
    void this.recorder?.stop();
    this.player?.dispose();
    this.manager.disconnect();
  }

  get storage(): RecordingStorage | null {
    return this.storageFactory();
  }

  // ─── Recording ─────────────────────────────────────────────────
  async startRecording(): Promise<void> {
    const storage = this.storage;
    if (!storage || this.recorder || this.player) return;
    const s = this.store.getState();
    this.recordingNotice = null;
    const recorder = new SessionRecorder({
      storage,
      meta: {
        id: `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        symbol: s.symbol,
        venue: s.venue,
        selectedVenues: [...s.selectedVenues],
        marketType: s.marketType,
        timeframe: s.timeframe,
        imbalanceThreshold: s.imbalanceThreshold,
        startedAt: Date.now(),
      },
      onStatus: (recording) => this.store.setState({ recording }),
      onEnd: (reason) => {
        this.recordingNotice = `Recording stopped: ${reason}`;
        if (this.recorder === recorder) {
          this.recorder = null;
          this.manager.setRecorder(null);
        }
      },
    });
    this.recorder = recorder;
    await recorder.start();
    this.manager.setRecorder(recorder);
  }

  async stopRecording(): Promise<RecordingMeta | null> {
    const recorder = this.recorder;
    if (!recorder) return null;
    this.recorder = null;
    this.manager.setRecorder(null);
    return recorder.stop();
  }

  // ─── Replay ────────────────────────────────────────────────────
  async startReplay(meta: RecordingMeta): Promise<void> {
    const storage = this.storage;
    if (!storage) return;
    if (this.recorder) await this.stopRecording();
    this.player?.dispose();
    const s = this.store.getState();
    if (!this.player) {
      this.liveSettings = { symbol: s.symbol, venue: s.venue, selectedVenues: s.selectedVenues, marketType: s.marketType, timeframe: s.timeframe };
    }
    const player = new ReplayPlayer({
      storage,
      manager: this.manager,
      meta,
      onStatus: (replay) => {
        if (this.player === player) this.store.setState({ replay });
      },
    });
    this.player = player;
    // The manager must be in replay mode before the settings change, so the
    // live subscription effect that follows is ignored.
    await player.load();
    this.store.setState({
      symbol: meta.symbol,
      venue: meta.venue,
      selectedVenues: [...meta.selectedVenues],
      marketType: meta.marketType,
      timeframe: meta.timeframe,
      orderBookMode: meta.selectedVenues.length > 1 ? "aggregated" : "single",
    });
    player.play();
  }

  replayPlay(): void { this.player?.play(); }
  replayPause(): void { this.player?.pause(); }
  replaySpeed(speed: ReplaySpeed): void { this.player?.setSpeed(speed); }
  replaySeek(time: number): Promise<void> { return this.player?.seek(time) ?? Promise.resolve(); }

  /** Leave replay and reconnect the live feed with the settings from before the replay. */
  exitReplay(): void {
    const player = this.player;
    if (!player) return;
    player.dispose();
    this.player = null;
    this.manager.endReplay();
    const live = this.liveSettings;
    this.liveSettings = null;
    this.store.setState({ replay: null, ...(live ?? {}) });
    const s = this.store.getState();
    this.manager.subscribe(s.venue, s.symbol, s.marketType, s.timeframe, s.tickSize, s.imbalanceThreshold, s.selectedVenues);
  }
}

export type SessionStore = typeof MarketSession.prototype.store;
export type SessionState = TerminalStore;
