import type { JobStep } from "@/lib/jobs/types";

/** Vertical steps: done = filled dot with check, current = accent ring, upcoming = grey ring. */
export function ProgressList({
  steps,
  reached,
  finished,
  notes = {},
}: {
  steps: JobStep[];
  reached: number;
  finished?: boolean;
  notes?: Record<string, string>;
}) {
  return (
    <ol className="space-y-0">
      {steps.map((step, i) => {
        const state = i <= reached ? "done" : i === reached + 1 && !finished ? "current" : "upcoming";
        return (
          <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 && (
              <span aria-hidden className={`absolute top-5 left-[7px] h-[calc(100%-16px)] w-px ${i < reached ? "bg-accent" : "bg-line"}`} />
            )}
            <span aria-hidden className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
              {state === "done" ? (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent">
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5.2 4.1 7.3 8 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              ) : state === "current" ? (
                <span className="h-4 w-4 rounded-full border-2 border-accent" />
              ) : (
                <span className="h-4 w-4 rounded-full border-[1.5px] border-line" />
              )}
            </span>
            <div className="min-w-0">
              <p className={state === "upcoming" ? "text-ink-3" : "text-ink"}>
                {step.label}
                <span className="sr-only"> ({state})</span>
              </p>
              {notes[step.key] && <p className="text-[12px] text-ink-3">{notes[step.key]}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
