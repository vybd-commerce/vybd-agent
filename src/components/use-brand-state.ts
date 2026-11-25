"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BrandState } from "@/lib/services/brand-state";

const REFRESH_DELAY = 120;
const RETRY_DELAYS = [500, 1500];

export function createBrandStateRefresher(
  brandId: string,
  onState: (state: BrandState) => void,
  onFailure: (failed: boolean) => void,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let reading = false;
  let invalidated = false;
  let retries = 0;
  let pending: Promise<void> | undefined;
  let settle: (() => void) | undefined;

  function schedule(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(() => void read(), delay);
  }

  async function read() {
    reading = true;
    invalidated = false;
    let nextState: BrandState | undefined;
    let retryable = false;
    try {
      const response = await fetch(`/api/brands/${brandId}/state`, { cache: "no-store", signal: controller.signal });
      if (response.ok) nextState = await response.json();
      else retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    } catch {
      retryable = true;
    }
    reading = false;

    if (controller.signal.aborted) return;
    // A change during the read may only be visible in the next snapshot.
    if (invalidated) {
      schedule(REFRESH_DELAY);
      return;
    }

    if (nextState) onState(nextState);
    onFailure(!nextState);
    settle?.();
    settle = undefined;
    pending = undefined;

    if (!nextState && retryable && retries < RETRY_DELAYS.length) {
      schedule(RETRY_DELAYS[retries++]);
    }
  }

  function refresh() {
    if (controller.signal.aborted) return Promise.resolve();
    if (reading) invalidated = true;
    if (pending) return pending;

    pending = new Promise<void>((resolve) => { settle = resolve; });
    retries = 0;
    if (!reading) schedule(REFRESH_DELAY);
    return pending;
  }

  function dispose() {
    clearTimeout(timer);
    controller.abort();
    settle?.();
  }

  return { refresh, dispose };
}

/**
 * Brand screen state, kept live: the server pushes a notification for every change to the brand
 * (from this tab, another tab, MCP, the worker or an operator) and we refetch.
 */
export function useBrandState(initial: BrandState) {
  const [state, setState] = useState(initial);
  const [flash, setFlash] = useState<{ keys: string[]; at: number }>({ keys: [], at: 0 });
  const [refreshFailed, setRefreshFailed] = useState(false);
  const brandId = initial.brand.id;
  const refresher = useRef<{ brandId: string; refresh: () => Promise<void> } | null>(null);

  const refresh = useCallback(() => {
    const current = refresher.current;
    return current?.brandId === brandId ? current.refresh() : Promise.resolve();
  }, [brandId]);

  useEffect(() => {
    const { refresh, dispose } = createBrandStateRefresher(brandId, setState, setRefreshFailed);
    refresher.current = { brandId, refresh };
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const source = new EventSource(`/api/brands/${brandId}/events`);
      es = source;
      source.onmessage = (e) => {
        if (es !== source) return;
        const event = JSON.parse(e.data) as { type: string; changed?: string[] };
        if (event.type === "ping") return;
        if (event.type === "brief" && event.changed?.length) setFlash({ keys: event.changed, at: Date.now() });
        void refresh(); // Includes ready, to catch up after (re)connect.
      };
      source.onerror = () => {
        if (es !== source) return;
        source.close();
        es = null;
        retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      es?.close();
      es = null;
      clearTimeout(retry);
      refresher.current = null;
      dispose();
    };
  }, [brandId]);

  return { state, refresh, refreshFailed, flash };
}
