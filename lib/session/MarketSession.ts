"use client";

import { createTerminalStore, type TerminalStore } from "@/lib/store/terminalStore";
import { MarketDataManager } from "@/lib/managers/marketDataManager";

export class MarketSession {
  readonly store = createTerminalStore();
  readonly manager = new MarketDataManager(this.store);

  pause(): void {
    this.manager.pause();
  }

  resume(): void {
    this.manager.resume();
  }

  dispose(): void {
    this.manager.disconnect();
  }
}

export type SessionStore = typeof MarketSession.prototype.store;
export type SessionState = TerminalStore;
