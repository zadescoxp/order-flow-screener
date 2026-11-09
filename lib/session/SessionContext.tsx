"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { MarketSession, type SessionStore } from "./MarketSession";

const SessionContext = createContext<MarketSession | null>(null);

export function MarketSessionProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new MarketSession());

  useEffect(() => {
    const onVisibilityChange = () => {
      // A hidden tab normally pauses the feed; recording, replay and browser
      // notifications need it to keep running.
      if (document.hidden) {
        if (!session.keepAliveWhenHidden()) session.pause();
      } else session.resume();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      session.dispose();
    };
  }, [session]);

  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

export function useMarketSession(): MarketSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useMarketSession must be used inside MarketSessionProvider");
  return session;
}

export function useSessionStore<T>(selector: (state: ReturnType<SessionStore["getState"]>) => T): T {
  return useStore(useMarketSession().store, selector);
}

export function useSessionStoreApi(): SessionStore {
  return useMarketSession().store;
}
