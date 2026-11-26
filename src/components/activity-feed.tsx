"use client";

import { useState, useTransition } from "react";
import { applyProposedEditAction } from "@/app/actions";
import { BRIEF_LABELS, formatValue, type BriefFieldKey } from "@/lib/brief";
import type { Message } from "@/lib/services/conversations";
import type { JobView } from "@/lib/services/jobs";
import type { MessageAttachments } from "@/lib/types";
import { JobCard } from "./job-cards";
import { NEXT_STEP_PROMPTS, NextStepCard } from "./next-step-card";
import { AutopilotIcon, AutopilotSummaryCard, AutopilotTag } from "./autopilot";
import { AgentAvatar } from "./wordmark";

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] rounded-2xl bg-subtle px-3.5 py-2.5 whitespace-pre-wrap">{content}</p>
    </div>
  );
}

export type Author = { userId: string; name: string; image: string | null };

/** A teammate's message on a shared brand: left-aligned with avatar and name, no bubble. */
function MemberMessage({ content, author }: { content: string; author: Author | undefined }) {
  const name = author?.name ?? "Former member";
  return (
    <div className="flex gap-3">
      {author?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={author.image} alt="" className="h-[26px] w-[26px] shrink-0 rounded-full object-cover" />
      ) : (
        <span aria-hidden className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-subtle text-[12px] font-semibold text-ink-2">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 pt-0.5">
        <p className="text-[13px] font-medium">{name}</p>
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

function UnlockCard({ score, onStart }: { score: number; onStart?: () => void }) {
  return (
    <div className="brief-flash rounded-xl border border-ok/40 bg-bg px-4 py-3.5">
      <p className="font-mono text-[11px] tracking-wide text-ok uppercase">Bar cleared · Brand Score {score}</p>
      <p className="mt-1 font-medium">Free 24h Autopilot run earned</p>
      <p className="mt-0.5 text-[13px] text-ink-2">The agent keeps working on the brand while you’re away. Start it when you’re ready.</p>
      {onStart && (
        <button onClick={onStart} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-medium text-white hover:opacity-90">
          <AutopilotIcon /> Start Autopilot
        </button>
      )}
    </div>
  );
}

function SystemNote({ content }: { content: string }) {
  return <p className="text-center text-[12px] text-ink-3">{content}</p>;
}

/** A teammate's agent changed something over MCP: who, which agent, what. Quieter than chat. */
function ActivityEntry({ content, client, author }: { content: string; client: string; author: Author | undefined }) {
  const name = author?.name ?? "Former member";
  return (
    <div className="flex items-start gap-3 text-[13px] text-ink-2">
      <span aria-hidden className="flex h-[26px] w-[26px] shrink-0 items-center justify-center">
        {author?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={author.image} alt="" className="h-5 w-5 rounded-full object-cover" />
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-subtle text-[10px] font-semibold">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <p className="min-w-0 pt-0.5">
        <span className="font-medium text-ink">{name}</span> via {client}
        <span className="ml-1.5 font-mono text-[11px] tracking-wide text-ink-3 uppercase">MCP</span>
        <span className="block">{content}</span>
      </p>
    </div>
  );
}

function BriefDiffChips({ diff }: { diff: NonNullable<MessageAttachments["briefDiff"]> }) {
  const keys = Object.keys(diff) as BriefFieldKey[];
  if (!keys.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Brief updates">
      {keys.map((k) => (
        <li key={k} className="max-w-full truncate rounded-md bg-accent-soft px-2 py-0.5 text-[12px] text-accent-text" title={formatValue(diff[k]?.to)}>
          {BRIEF_LABELS[k]} updated
        </li>
      ))}
    </ul>
  );
}

function ProposedEdits({ messageId, edits }: { messageId: string; edits: NonNullable<MessageAttachments["proposedEdits"]> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <p className="mb-1.5 text-[13px] text-ink-2">Suggested brief edits</p>
      <ul className="flex flex-wrap gap-1.5">
        {edits.map((e, i) => (
          <li key={i}>
            {e.applied ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-[13px] text-accent-text">
                <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5.2 4.1 7.3 8 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                {e.label}
              </span>
            ) : (
              <button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await applyProposedEditAction(messageId, i);
                    setError(res.ok ? null : res.error);
                  })
                }
                className="rounded-full border border-line px-3 py-1 text-[13px] hover:border-focus hover:text-accent-text"
                title={Object.entries(e.patch).map(([k, v]) => `${BRIEF_LABELS[k as BriefFieldKey] ?? k}: ${formatValue(v)}`).join("\n")}
              >
                Apply: {e.label}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

function AgentMessage(props: {
  id?: string;
  content: string;
  attachments: MessageAttachments;
  jobs: JobView[];
  /** Latest agent message: its suggested next steps show as "ask your assistant" cards. */
  latest: boolean;
  onAsk: (prompt: string) => void;
  onViewJob: (id: string) => void;
  onEditSpec: (id: string) => void;
  onStartAutopilot?: () => void;
}) {
  const a = props.attachments;
  const jobs = (a.jobRefs ?? []).map((id) => props.jobs.find((j) => j.id === id)).filter((j): j is JobView => Boolean(j));
  return (
    <div className="flex gap-3">
      <AgentAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5">
        {a.autopilot && <AutopilotTag cycle={a.autopilot.cycle} of={a.autopilot.of} />}
        {props.content && <p className="whitespace-pre-wrap">{props.content}</p>}
        {a.error && <p className="text-[13px] text-danger">{a.error}</p>}
        {a.briefDiff && <BriefDiffChips diff={a.briefDiff} />}
        {jobs.map((j) => (
          <JobCard key={j.id} job={j} onView={props.onViewJob} onEditSpec={props.onEditSpec} />
        ))}
        {a.unlock ? <UnlockCard score={a.unlock.score} onStart={props.onStartAutopilot} /> : null}
        {a.autopilotSummary ? (
          <div data-autopilot-summary>
            <AutopilotSummaryCard items={a.autopilotSummary.items} />
          </div>
        ) : null}
        {a.proposedEdits?.length && props.id ? <ProposedEdits messageId={props.id} edits={a.proposedEdits} /> : null}
        {props.latest && a.nextSteps?.length ? (
          <div className="space-y-2">
            {a.nextSteps.map((s) => (
              <NextStepCard key={s.kind} step={s} onPick={(st) => props.onAsk(NEXT_STEP_PROMPTS[st.kind])} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The brand's thread, read-only: what each person's assistant did over MCP, job deliveries with
 * suggested brief edits, operator notes, and older messages. Vybd has no chat of its own.
 */
export function ActivityFeed(props: {
  messages: Message[];
  /** Everyone on the brand; teammates' messages render with their name once there is more than one. */
  members?: Author[];
  viewerId?: string;
  /** Set while an earned Autopilot run is waiting to be started; shows Start on the unlock card. */
  onStartAutopilot?: () => void;
  jobs: JobView[];
  onAsk: (prompt: string) => void;
  onViewJob: (id: string) => void;
  onEditSpec: (id: string) => void;
}) {
  const lastAgentIdx = props.messages.findLastIndex((m) => m.role !== "user" && m.role !== "system");
  const shared = (props.members?.length ?? 0) > 1;
  const authors = new Map(props.members?.map((m) => [m.userId, m]));

  if (!props.messages.length) {
    return <p className="text-[13px] text-ink-3">Nothing yet. Changes your assistant makes show up here, along with your teammates’.</p>;
  }

  // Newest first: this is a log to scan, not a conversation to read top to bottom.
  const ordered = props.messages.map((m, i) => ({ m, i })).reverse();
  return (
    <div className="flex flex-col gap-[18px]">
      {ordered.map(({ m, i }) =>
        m.role === "system" ? (
          m.attachments.mcpActivity ? (
            <ActivityEntry
              key={m.id}
              content={m.content}
              client={m.attachments.mcpActivity.client}
              author={m.authorId ? authors.get(m.authorId) : undefined}
            />
          ) : (
            <SystemNote key={m.id} content={m.content} />
          )
        ) : m.role === "user" ? (
          shared && m.authorId !== props.viewerId ? (
            <MemberMessage key={m.id} content={m.content} author={m.authorId ? authors.get(m.authorId) : undefined} />
          ) : (
            <UserMessage key={m.id} content={m.content} />
          )
        ) : (
          <AgentMessage
            key={m.id}
            id={m.id}
            content={m.role === "operator" ? `Operator: ${m.content}` : m.content}
            attachments={m.attachments}
            jobs={props.jobs}
            latest={i === lastAgentIdx}
            onAsk={props.onAsk}
            onViewJob={props.onViewJob}
            onEditSpec={props.onEditSpec}
            onStartAutopilot={props.onStartAutopilot}
          />
        ),
      )}
    </div>
  );
}
