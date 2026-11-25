import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrandStateRefresher } from "@/components/use-brand-state";

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("brand state refresh", () => {
  const fetchState = vi.fn<typeof fetch>();
  const onState = vi.fn();
  const onFailure = vi.fn();
  let refresher: ReturnType<typeof createBrandStateRefresher>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchState.mockReset();
    onState.mockClear();
    onFailure.mockClear();
    vi.stubGlobal("fetch", fetchState);
    refresher = createBrandStateRefresher("brand-a", onState, onFailure);
  });

  afterEach(() => {
    refresher.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("batches a mutation refresh and nearby SSE notifications into one read", async () => {
    const snapshot = { lanes: [{ ownerId: "owner" }] };
    fetchState.mockResolvedValueOnce(Response.json(snapshot));

    const direct = refresher.refresh();
    await vi.advanceTimersByTimeAsync(60);
    expect(refresher.refresh()).toBe(direct);
    await vi.runAllTimersAsync();
    await direct;

    expect(fetchState).toHaveBeenCalledTimes(1);
    expect(fetchState).toHaveBeenCalledWith("/api/brands/brand-a/state", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(onState).toHaveBeenCalledExactlyOnceWith(snapshot);
  });

  it("serializes reads and discards a delayed snapshot if another change has arrived", async () => {
    const older = deferredResponse();
    const newer = { lanes: [{ ownerId: "current-owner" }] };
    fetchState.mockReturnValueOnce(older.promise).mockResolvedValueOnce(Response.json(newer));

    const first = refresher.refresh();
    await vi.runAllTimersAsync();
    expect(fetchState).toHaveBeenCalledTimes(1);
    const next = refresher.refresh();
    refresher.refresh();
    await vi.runAllTimersAsync();
    expect(fetchState).toHaveBeenCalledTimes(1);

    older.resolve(Response.json({ lanes: [{ ownerId: null }] }));
    await vi.runAllTimersAsync();
    await Promise.all([first, next]);

    expect(fetchState).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenCalledExactlyOnceWith(newer);
  });

  it("recovers from HTTP and network failures without a new refresh signal", async () => {
    const snapshot = { lanes: [{ ownerId: "owner" }] };
    fetchState.mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json(snapshot));

    const refresh = refresher.refresh();
    await vi.advanceTimersByTimeAsync(120);
    await refresh;
    expect(onFailure).toHaveBeenLastCalledWith(true);
    expect(onState).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(fetchState).toHaveBeenCalledTimes(3);
    expect(onState).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(onFailure).toHaveBeenLastCalledWith(false);
  });

  it("bounds automatic retries and allows a manual refresh to recover afterward", async () => {
    fetchState.mockImplementation(async () => new Response(null, { status: 503 }));
    void refresher.refresh();
    await vi.runAllTimersAsync();
    expect(fetchState).toHaveBeenCalledTimes(3);
    expect(onFailure).toHaveBeenLastCalledWith(true);

    fetchState.mockResolvedValueOnce(Response.json({ lanes: [] }));
    void refresher.refresh();
    await vi.runAllTimersAsync();
    expect(fetchState).toHaveBeenCalledTimes(4);
    expect(onFailure).toHaveBeenLastCalledWith(false);
  });

  it("cancels a scheduled retry on disposal", async () => {
    fetchState.mockResolvedValueOnce(new Response(null, { status: 503 }));
    void refresher.refresh();
    await vi.advanceTimersByTimeAsync(120);
    refresher.dispose();
    await vi.runAllTimersAsync();
    expect(fetchState).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight read and ignores its result on disposal", async () => {
    const response = deferredResponse();
    fetchState.mockReturnValueOnce(response.promise);
    const refresh = refresher.refresh();
    await vi.runAllTimersAsync();
    const signal = fetchState.mock.calls[0][1]?.signal;

    refresher.dispose();
    await refresh;
    expect(signal?.aborted).toBe(true);
    response.resolve(Response.json({ lanes: [] }));
    await vi.runAllTimersAsync();
    expect(onState).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });
});
