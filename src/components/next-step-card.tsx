import type { NextStep } from "@/lib/types";

/** Next-step card: title, one line, chevron. Opens the job flow in chat. */
export function NextStepCard({ step, onPick, disabled }: { step: NextStep; onPick: (s: NextStep) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onPick(step)}
      disabled={disabled}
      className="group flex w-full items-center gap-3 rounded-xl border border-line px-3.5 py-3 text-left hover:border-accent disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{step.title}</span>
        <span className="block text-[13px] text-ink-2">{step.description}</span>
      </span>
      <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-ink-3 group-hover:text-accent">
        <path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export const NEXT_STEP_PROMPTS: Record<NextStep["kind"], string> = {
  market_snapshot: "Let's run a market snapshot.",
  share_page: "Make me a share page so I can get feedback.",
  find_suppliers: "Let's find suppliers.",
};
