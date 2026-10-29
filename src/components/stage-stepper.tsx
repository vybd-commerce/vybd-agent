import { STAGES, type Stage } from "@/lib/types";

export function StageStepper({ stage }: { stage: Stage }) {
  const current = STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="flex items-center gap-1.5 overflow-x-auto" aria-label="Brand stage">
      {STAGES.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "upcoming";
        return (
          <li key={s.key} className="flex shrink-0 items-center gap-1.5">
            {i > 0 && <span aria-hidden className={`h-px w-3 ${i <= current ? "bg-accent" : "bg-line"}`} />}
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={`rounded-full px-2 py-0.5 text-[12px] ${
                state === "current"
                  ? "bg-accent text-white"
                  : state === "done"
                    ? "text-accent"
                    : "text-ink-3"
              }`}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
