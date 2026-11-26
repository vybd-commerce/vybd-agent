import type { NextStep } from "@/lib/types";

/** Next-step card: title, one line, chevron. Picking it copies a prompt for the founder's own assistant. */
export function NextStepCard({ step, onPick, disabled }: { step: NextStep; onPick: (s: NextStep) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onPick(step)}
      disabled={disabled}
      className="group flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3.5 py-3 text-left hover:border-focus disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{step.title}</span>
        <span className="block text-[12px] text-ink-3">{step.description}</span>
      </span>
      <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-ink-3 group-hover:text-accent-text">
        <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export const NEXT_STEP_PROMPTS: Record<NextStep["kind"], string> = {
  market_snapshot: "Let's run a market snapshot.",
  share_page: "Make me a share page so I can get feedback.",
  find_suppliers: "Let's find suppliers.",
  invite: "I want to invite a friend to build this with me.",
};
