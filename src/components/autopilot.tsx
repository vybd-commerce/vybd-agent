"use client";

import { useEffect, useState } from "react";
import { AUTOPILOT_CYCLES, AUTOPILOT_DUTIES, AUTOPILOT_HOURS, type AutopilotView } from "@/lib/autopilot";

export function AutopilotIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function hoursLeft(endsAt?: string) {
  if (!endsAt) return AUTOPILOT_HOURS;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 3_600_000));
}

/** Re-render once a minute so the countdown stays honest. */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
}

/** Confirm sheet: what Autopilot will do, then start the 24h clock. */
export function AutopilotSheet({ brandName, onStart, onClose }: { brandName: string; onStart: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Start Autopilot"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] rounded-t-2xl border border-line bg-bg p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-ok uppercase">
              <AutopilotIcon size={12} /> Reward · free
            </p>
            <h2 className="mt-1 text-[22px] font-display font-normal tracking-[-0.015em]">{AUTOPILOT_HOURS} hours of Autopilot</h2>
            <p className="mt-1 text-[13px] text-ink-2">
              The agent works on {brandName} by itself, {AUTOPILOT_CYCLES} times over the next day. The clock starts when you tap Start, so pick a day you’ll check in.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 shrink-0 rounded-md text-ink-3 hover:bg-subtle">
            ✕
          </button>
        </div>

        <ol className="mt-4 space-y-2.5">
          {AUTOPILOT_DUTIES.map((d, i) => (
            <li key={d.title} className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-subtle font-mono text-[11px] text-ink-2">{i + 1}</span>
              <div>
                <p className="text-[13px] font-medium">{d.title}</p>
                <p className="text-[12px] text-ink-2">{d.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-4 rounded-lg bg-subtle px-3 py-2 text-[12px] text-ink-2">
          Never spends money, never approves jobs, never changes the brief without you. Stop it any time.
        </p>

        <button onClick={onStart} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink font-medium text-white hover:opacity-90">
          <AutopilotIcon /> Start Autopilot
        </button>
      </div>
    </div>
  );
}

/** Strip under the header while a run is live, and a quiet one after it ends. */
export function AutopilotBanner({ autopilot, onStop, onReview }: { autopilot: AutopilotView; onStop: () => void; onReview: () => void }) {
  useMinuteTick();
  if (autopilot.status === "active") {
    const left = hoursLeft(autopilot.endsAt);
    const cycle = autopilot.cyclesRun ?? 0;
    const elapsed = 1 - left / AUTOPILOT_HOURS;
    return (
      <div className="relative flex items-center gap-3 overflow-hidden border-b border-divider bg-panel px-4 py-2 text-[13px] md:px-6" role="status">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
        </span>
        <p className="min-w-0 flex-1 truncate">
          <span className="font-medium">Autopilot is on</span>
          <span className="text-ink-2">
            {" "}
            · {left}h left · cycle {Math.min(cycle + 1, AUTOPILOT_CYCLES)} of {AUTOPILOT_CYCLES}
          </span>
        </p>
        <button onClick={onStop} className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-subtle hover:text-ink">
          Stop
        </button>
        <span className="absolute bottom-0 left-0 h-0.5 bg-ok/60" style={{ width: `${elapsed * 100}%` }} aria-hidden />
      </div>
    );
  }
  if (autopilot.status === "done") {
    return (
      <div className="flex items-center gap-3 border-b border-divider bg-panel px-4 py-2 text-[13px] md:px-6" role="status">
        <AutopilotIcon />
        <p className="min-w-0 flex-1 truncate text-ink-2">
          <span className="font-medium text-ink">Autopilot finished.</span> Its summary and suggestions are in the thread.
        </p>
        <button onClick={onReview} className="shrink-0 text-[12px] font-medium text-accent-text hover:underline">
          Review
        </button>
      </div>
    );
  }
  return null;
}

/** Small tag above messages that an Autopilot cycle posted. */
export function AutopilotTag({ cycle, of }: { cycle: number; of: number }) {
  return (
    <p className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-ink-3 uppercase">
      <AutopilotIcon size={12} /> Autopilot · {cycle} of {of}
    </p>
  );
}

/** Final wrap-up: what the run did, as counts. */
export function AutopilotSummaryCard({ items }: { items: { label: string; count: number }[] }) {
  return (
    <div className="rounded-xl border border-line bg-bg px-4 py-3.5">
      <p className="flex items-center gap-1.5 font-medium">
        <AutopilotIcon /> What Autopilot did
      </p>
      <ul className="mt-2.5 grid grid-cols-2 gap-2">
        {items.map((i) => (
          <li key={i.label} className="rounded-lg bg-subtle px-3 py-2">
            <p className="font-mono text-[18px] font-semibold">{i.count}</p>
            <p className="text-[12px] text-ink-2">{i.label}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
