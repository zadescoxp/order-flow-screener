"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { MarketSession, type SessionStore } from "./MarketSession";

const SessionContext = createContext<MarketSession | null>(null);

export function MarketSessionProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<MarketSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new MarketSession();

  useEffect(() => {
    const session = sessionRef.current!;
    const onVisibilityChange = () => {
      if (document.hidden) session.pause();
      else session.resume();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      session.dispose();
    };
  }, []);

  return (
    <SessionContext.Provider value={sessionRef.current}>
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
