"use client";

import { useState } from "react";
import type { AutopilotView } from "@/lib/autopilot";
import { type BrandScore, GATE_RESPONSES, GATE_YES, type Quest, UNLOCK_SCORE } from "@/lib/score";
import { AutopilotIcon } from "./autopilot";

function Ring({ score, unlocked }: { score: number; unlocked: boolean }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const bar = (UNLOCK_SCORE / 100) * 360 - 90;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden className="shrink-0">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--subtle)" strokeWidth="5" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke={unlocked ? "var(--ok)" : "var(--accent)"}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform="rotate(-90 28 28)"
        style={{ transition: "stroke-dasharray 600ms ease-out" }}
      />
      {/* Tick at the unlock bar */}
      <line
        x1={28 + (r - 4) * Math.cos((bar * Math.PI) / 180)}
        y1={28 + (r - 4) * Math.sin((bar * Math.PI) / 180)}
        x2={28 + (r + 4) * Math.cos((bar * Math.PI) / 180)}
        y2={28 + (r + 4) * Math.sin((bar * Math.PI) / 180)}
        stroke="var(--ink-3)"
        strokeWidth="1.5"
      />
      <text x="28" y="32.5" textAnchor="middle" className="fill-ink font-mono text-[13px] font-semibold">
        {score}
      </text>
    </svg>
  );
}

function QuestRow({ q, fresh, onAct, busy }: { q: Quest; fresh: boolean; onAct: (q: Quest) => void; busy: boolean }) {
  const actionable = !q.done && (q.prompt || q.action);
  return (
    <li className={`rounded-lg px-2 py-2 ${fresh ? "brief-flash" : ""}`}>
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${q.done ? "bg-ok text-white" : "border border-line-strong"}`}
        >
          {q.done ? "✓" : ""}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={`text-[13px] font-medium ${q.done ? "text-ink-3" : ""}`}>{q.title}</p>
            <span className="shrink-0 font-mono text-[11px] text-ink-3">
              {Math.round(q.points * q.progress)}/{q.points}
            </span>
          </div>
          <p className="text-[12px] text-ink-3">{q.detail}</p>
          {!q.done && <p className="mt-1 text-[12px] leading-snug text-ink-2">{q.why}</p>}
          {actionable && (
            <button
              disabled={busy && !q.action}
              onClick={() => onAct(q)}
              className="mt-1.5 text-[12px] font-medium text-accent-text hover:underline disabled:opacity-50"
            >
              {q.action === "invite" ? "Invite someone" : q.action === "share" ? "Share the page" : "Work on this"} →
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function ScoreCard({
  score,
  autopilot,
  busy,
  onPrompt,
  onAction,
  onStartAutopilot,
}: {
  score: BrandScore;
  autopilot: AutopilotView;
  busy: boolean;
  onStartAutopilot: () => void;
  onPrompt: (text: string) => void;
  onAction: (a: "invite" | "share") => void;
}) {
  const [open, setOpen] = useState(false);
  // Quests already done when the card mounted don't flash; ones completed while you watch do.
  const [doneAtMount] = useState(() => new Set(score.quests.filter((q) => q.done).map((q) => q.key)));
  const act = (q: Quest) => (q.action ? onAction(q.action) : q.prompt && onPrompt(q.prompt));
  const doneCount = score.quests.filter((q) => q.done).length;
  const toBar = Math.max(0, UNLOCK_SCORE - score.score);

  return (
    <section className="mb-5 rounded-xl border border-line bg-bg p-3.5" aria-label="Brand Score">
      <div className="flex items-center gap-3">
        <Ring score={score.score} unlocked={score.unlocked} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Brand Score</p>
          <p className="text-[12px] leading-snug text-ink-2">
            {score.unlocked
              ? autopilot.status === "active"
                ? "Bar cleared. Autopilot is working on the brand now."
                : autopilot.status === "done"
                  ? "Bar cleared. Your Autopilot run is done; keep building."
                  : "Bar cleared. You earned a free 24h Autopilot run."
              : toBar > 0
                ? `${toBar} points to ${UNLOCK_SCORE} unlocks a free 24h Autopilot run.`
                : `Score's there. Now get ${GATE_RESPONSES} answers and ${GATE_YES} “would buy” to unlock Autopilot.`}
          </p>
        </div>
      </div>

      {autopilot.status === "available" && (
        <button
          onClick={onStartAutopilot}
          className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-ink text-[13px] font-medium text-white hover:opacity-90"
        >
          <AutopilotIcon /> Start your 24h Autopilot
        </button>
      )}

      {!score.unlocked && score.next && !open && (
        <div className="mt-3 rounded-lg bg-subtle px-3 py-2.5">
          <p className="text-[11px] tracking-wide text-ink-3 uppercase">Next quest</p>
          <p className="mt-0.5 text-[13px] font-medium">
            {score.next.title} <span className="font-normal text-ink-3">· {score.next.detail}</span>
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{score.next.why}</p>
          {(score.next.prompt || score.next.action) && (
            <button
              disabled={busy && !score.next.action}
              onClick={() => act(score.next!)}
              className="mt-1.5 text-[12px] font-medium text-accent-text hover:underline disabled:opacity-50"
            >
              Start →
            </button>
          )}
        </div>
      )}

      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-2.5 text-[12px] text-ink-2 hover:text-ink">
        {open ? "Hide quests" : `All quests · ${doneCount} of ${score.quests.length} done`}
      </button>
      {open && (
        <ul className="mt-1.5 -mx-2 space-y-0.5">
          {score.quests.map((q) => (
            <QuestRow key={`${q.key}-${q.done}`} q={q} fresh={q.done && !doneAtMount.has(q.key)} onAct={act} busy={busy} />
          ))}
        </ul>
      )}
    </section>
  );
}
