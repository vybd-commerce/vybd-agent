import { STAGES, type Stage } from "@/lib/types";

export function StageStepper({ stage }: { stage: Stage }) {
  return (
    <ol className="flex flex-wrap gap-1.5 font-mono text-[12px] text-ink-3" aria-label="Brand stage">
      {STAGES.map((s) => {
        const current = s.key === stage;
        return (
          <li
            key={s.key}
            aria-current={current ? "step" : undefined}
            className={`rounded-md px-2 py-[3px] ${current ? "bg-ink text-white" : ""}`}
          >
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}
