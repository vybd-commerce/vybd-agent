"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-render the server page whenever the given SSE endpoint reports a change. */
export function LiveRefresh({ url }: { url: string }) {
  const router = useRouter();
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      es = new EventSource(url);
      es.onmessage = (e) => {
        if (JSON.parse(e.data).type === "ping") return;
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 150);
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
      clearTimeout(timer);
    };
  }, [url, router]);
  return null;
}
