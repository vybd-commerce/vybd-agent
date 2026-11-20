"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { applyProposedEditAction } from "@/app/actions";
import { BRIEF_LABELS, formatValue, type BriefFieldKey } from "@/lib/brief";
import type { Message } from "@/lib/services/conversations";
import type { JobView } from "@/lib/services/jobs";
import type { MessageAttachments, NextStep } from "@/lib/types";
import { JobCard } from "./job-cards";
import { NEXT_STEP_PROMPTS, NextStepCard } from "./next-step-card";
import { AutopilotIcon, AutopilotSummaryCard, AutopilotTag } from "./autopilot";
import { AgentAvatar } from "./wordmark";

export type StreamingReply = {
  text: string;
  chips: string[];
  nextSteps: NextStep[];
  jobRefs: string[];
  activity: string | null;
};

const TOOL_ACTIVITY: Record<string, string> = {
  update_brand_brief: "Updating the brief",
  quote_job: "Preparing a quote",
  approve_job: "Starting the job",
  create_share_page: "Publishing your share page",
  get_feedback: "Reading feedback",
  list_jobs: "Checking jobs",
  get_job: "Checking the job",
  get_brand_brief: "Reading the brief",
};

export function toolActivity(name: string) {
  return TOOL_ACTIVITY[name] ?? null;
}

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

function Chips({ chips, onPick, disabled }: { chips: string[]; onPick: (t: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <button
          key={c}
          disabled={disabled}
          onClick={() => onPick(c)}
          className="min-h-[34px] rounded-full border border-line-strong bg-bg px-3 text-[13px] hover:border-focus hover:text-accent-text disabled:opacity-50"
        >
          {c}
        </button>
      ))}
    </div>
  );
}

function AgentMessage(props: {
  id?: string;
  content: string;
  attachments: MessageAttachments;
  jobs: JobView[];
  streaming?: boolean;
  activity?: string | null;
  interactive: boolean;
  busy: boolean;
  onSend: (t: string) => void;
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
        {(props.content || props.streaming) && (
          <p className={`whitespace-pre-wrap ${props.streaming && !props.activity ? "streaming-caret" : ""}`}>
            {props.content}
          </p>
        )}
        {props.activity && <p className="text-[13px] text-ink-3 italic">{props.activity}…</p>}
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
        {props.interactive && a.nextSteps?.length ? (
          <div className="space-y-2">
            {a.nextSteps.map((s) => (
              <NextStepCard key={s.kind} step={s} disabled={props.busy} onPick={(st) => props.onSend(NEXT_STEP_PROMPTS[st.kind])} />
            ))}
          </div>
        ) : null}
        {props.interactive && a.chips?.length ? <Chips chips={a.chips} disabled={props.busy} onPick={props.onSend} /> : null}
      </div>
    </div>
  );
}

export function MessageList(props: {
  messages: Message[];
  /** Everyone on the brand; teammates' messages render with their name once there is more than one. */
  members?: Author[];
  viewerId?: string;
  /** Set while an earned Autopilot run is waiting to be started; shows Start on the unlock card. */
  onStartAutopilot?: () => void;
  pendingUser: string | null;
  streaming: StreamingReply | null;
  error: { text: string; retry: string } | null;
  jobs: JobView[];
  busy: boolean;
  onSend: (t: string) => void;
  onViewJob: (id: string) => void;
  onEditSpec: (id: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [props.messages.length, props.streaming?.text, props.pendingUser, props.streaming?.jobRefs.length]);

  const lastAgentIdx = props.messages.findLastIndex((m) => m.role !== "user" && m.role !== "system");
  const shared = (props.members?.length ?? 0) > 1;
  const authors = new Map(props.members?.map((m) => [m.userId, m]));
  // Join notes don't count as a turn, so they never hide the agent's chips.
  const lastIsAgent = lastAgentIdx === props.messages.findLastIndex((m) => m.role !== "system");

  return (
    <div className="flex flex-col gap-[22px]">
      {props.messages.map((m, i) =>
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
            interactive={i === lastAgentIdx && lastIsAgent && !props.streaming && !props.pendingUser}
            busy={props.busy}
            onSend={props.onSend}
            onViewJob={props.onViewJob}
            onEditSpec={props.onEditSpec}
            onStartAutopilot={props.onStartAutopilot}
          />
        ),
      )}
      {props.pendingUser && <UserMessage content={props.pendingUser} />}
      {props.streaming && (
        <AgentMessage
          content={props.streaming.text}
          attachments={{ chips: props.streaming.chips, nextSteps: props.streaming.nextSteps, jobRefs: props.streaming.jobRefs }}
          jobs={props.jobs}
          streaming
          activity={props.streaming.activity}
          interactive={false}
          busy
          onSend={props.onSend}
          onViewJob={props.onViewJob}
          onEditSpec={props.onEditSpec}
        />
      )}
      {props.error && (
        <div className="flex gap-3">
          <AgentAvatar />
          <div className="flex flex-wrap items-center gap-3 pt-0.5">
            <p className="text-danger">{props.error.text}</p>
            <button
              onClick={() => props.onSend(props.error!.retry)}
              className="rounded-lg border border-line px-3 py-1 text-[13px] font-medium hover:bg-subtle"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

export function Composer({ onSend, busy, onStop, autoFocus }: { onSend: (t: string) => void; busy: boolean; onStop: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 rounded-[14px] border border-line-strong bg-bg py-2 pr-2 pl-3.5 focus-within:border-focus"
    >
      <label htmlFor="composer" className="sr-only">
        Message Vybd
      </label>
      <textarea
        id="composer"
        ref={ref}
        rows={1}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Reply to Vybd…"
        className="max-h-[200px] min-h-9 flex-1 resize-none bg-transparent py-2 leading-snug outline-none placeholder:text-ink-3 focus-visible:outline-none"
      />
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-strong text-ink hover:bg-subtle"
        >
          <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-current" />
        </button>
      ) : (
        <button
          type="submit"
          aria-label="Send"
          disabled={!text.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      )}
    </form>
  );
}
