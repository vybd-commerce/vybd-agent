"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BrandState } from "@/lib/services/brand-state";

/**
 * Brand screen state, kept live: the server pushes a notification for every change to the brand
 * (from this tab, another tab, MCP, the worker or an operator) and we refetch.
 */
export function useBrandState(initial: BrandState) {
  const [state, setState] = useState(initial);
  const [flash, setFlash] = useState<{ keys: string[]; at: number }>({ keys: [], at: 0 });
  const brandId = initial.brand.id;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/brands/${brandId}/state`, { cache: "no-store" });
    if (res.ok) setState(await res.json());
  }, [brandId]);

  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(refresh, 120);
  }, [refresh]);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      es = new EventSource(`/api/brands/${brandId}/events`);
      es.onmessage = (e) => {
        const event = JSON.parse(e.data) as { type: string; changed?: string[] };
        if (event.type === "ping") return;
        if (event.type === "ready") return scheduleRefresh(); // catch up after (re)connect
        if (event.type === "brief" && event.changed?.length) setFlash({ keys: event.changed, at: Date.now() });
        scheduleRefresh();
      };
      es.onerror = () => {
        es?.close();
        retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      es?.close();
      clearTimeout(retry);
    };
  }, [brandId, scheduleRefresh]);

  return { state, refresh, flash };
}
