"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { renameBrandAction } from "@/app/actions";
import type { ChatEvent } from "@/lib/agent/orchestrator";
import type { BrandState } from "@/lib/services/brand-state";
import { AUTOPILOT_HOURS, type AutopilotView } from "@/lib/autopilot";
import type { NextStep } from "@/lib/types";
import { BriefTab } from "./brief-tab";
import { Composer, MessageList, toolActivity, type StreamingReply } from "./conversation";
import { JobsTab } from "./jobs-tab";
import { NEXT_STEP_PROMPTS } from "./next-step-card";
import { AutopilotBanner, AutopilotSheet } from "./autopilot";
import { ScoreCard } from "./score-card";
import { ShareSheet, type ShareMode } from "./share-sheet";
import { SnapshotTab } from "./snapshot-tab";
import { StageStepper } from "./stage-stepper";
import { TeamTab } from "./team-tab";
import { useBrandState } from "./use-brand-state";
import { AgentAvatar } from "./wordmark";

type Tab = "brief" | "snapshot" | "team" | "jobs";

const RESUME_STARTERS = ["What's missing from my brief?", "What should I do next?"];

const STARTERS = [
  "A refillable scalp oil for women with thinning hair",
  "Protein snacks for kids who refuse breakfast",
  "Minimal travel gear for people who only carry on",
];

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" />
    </svg>
  );
}

function InviteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6" />
    </svg>
  );
}

function MemberStack({ members }: { members: BrandState["members"] }) {
  if (members.length < 2) return null;
  return (
    <div className="hidden -space-x-1.5 sm:flex" aria-label={`${members.length} people on the team`}>
      {members.slice(0, 4).map((m) =>
        m.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={m.userId} src={m.image} alt={m.name} title={m.name} className="h-7 w-7 rounded-full border-2 border-bg object-cover" />
        ) : (
          <span key={m.userId} title={m.name} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg bg-subtle text-[11px] font-semibold text-ink-2">
            {m.name.slice(0, 1).toUpperCase()}
          </span>
        ),
      )}
      {members.length > 4 && (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg bg-subtle text-[11px] text-ink-2">+{members.length - 4}</span>
      )}
    </div>
  );
}

function BrandName({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [, start] = useTransition();
  const router = useRouter();
  const save = () => {
    setEditing(false);
    if (value.trim() && value !== name)
      start(async () => {
        await renameBrandAction(id, value);
        router.refresh();
      });
  };
  return editing ? (
    <input
      autoFocus
      value={value}
      aria-label="Brand name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") {
          setValue(name);
          setEditing(false);
        }
      }}
      className="w-full max-w-[260px] rounded-md border border-focus px-1.5 text-[16px] font-semibold outline-none"
    />
  ) : (
    <button onClick={() => setEditing(true)} className="truncate text-[16px] font-semibold hover:text-accent-text" title="Rename">
      {name}
    </button>
  );
}

export function BrandWorkspace({ initial }: { initial: BrandState }) {
  const { state, refresh, refreshFailed, flash } = useBrandState(initial);
  const searchParams = useSearchParams();
  // Returning from checkout (?job=…) opens that job.
  const [tab, setTab] = useState<Tab>(() => (searchParams.get("job") ? "jobs" : "brief"));
  const [mobilePanel, setMobilePanel] = useState(false);
  const [share, setShare] = useState<ShareMode | null>(null);
  const [autopilotSheet, setAutopilotSheet] = useState(false);
  // UI only: nothing runs or persists yet, so Start/Stop just switch what this tab shows.
  const [localAutopilot, setLocalAutopilot] = useState<AutopilotView | null>(null);
  const autopilot = localAutopilot ?? state.autopilot;
  const openAutopilot = autopilot.status === "available" ? () => setAutopilotSheet(true) : undefined;
  const [selectedJob, setSelectedJob] = useState<string | null>(() => searchParams.get("job"));
  const [editingSpec, setEditingSpec] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<StreamingReply | null>(null);
  const [error, setError] = useState<{ text: string; retry: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = Boolean(streaming || pendingUser);
  const brandId = state.brand.id;

  const viewJob = useCallback((id: string) => {
    setSelectedJob(id);
    setEditingSpec(false);
    setTab("jobs");
    setMobilePanel(true);
  }, []);

  const editSpec = useCallback((id: string) => {
    setSelectedJob(id);
    setEditingSpec(true);
    setTab("jobs");
    setMobilePanel(true);
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (busy) return;
      setError(null);
      setPendingUser(text);
      setMobilePanel(false);
      const controller = new AbortController();
      abort.current = controller;
      const reply: StreamingReply = { text: "", chips: [], nextSteps: [], jobRefs: [], activity: null };
      setStreaming({ ...reply });
      let failed: string | null = null;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brandId, text }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          failed = (await res.json().catch(() => null))?.error ?? "Couldn't reach the agent.";
        } else {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              if (!part.startsWith("data: ")) continue;
              const e = JSON.parse(part.slice(6)) as ChatEvent;
              switch (e.type) {
                case "user_message":
                  setPendingUser(null);
                  break;
                case "text":
                  reply.text += e.delta;
                  reply.activity = null;
                  break;
                case "tool":
                  reply.activity = e.status === "start" ? toolActivity(e.name) : null;
                  if (e.status !== "start" && reply.text && !reply.text.endsWith("\n")) reply.text += "\n\n";
                  break;
                case "job":
                  if (!reply.jobRefs.includes(e.jobId)) reply.jobRefs.push(e.jobId);
                  void refresh();
                  break;
                case "chips":
                  reply.chips = e.chips;
                  break;
                case "next_steps":
                  reply.nextSteps = e.steps;
                  break;
                case "error":
                  failed = e.error;
                  break;
              }
              setStreaming({ ...reply });
            }
          }
        }
      } catch {
        if (!controller.signal.aborted) failed = "Connection lost.";
      }
      await refresh();
      setPendingUser(null);
      setStreaming(null);
      abort.current = null;
      if (failed && !controller.signal.aborted) setError({ text: failed, retry: text });
    },
    [brandId, busy, refresh],
  );

  const onNextStep = useCallback((s: NextStep) => (s.kind === "invite" ? setShare("invite") : send(NEXT_STEP_PROMPTS[s.kind])), [send]);
  const empty = state.messages.length === 0 && !pendingUser && !streaming;
  const hasBrief = state.brief.version > 0;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "brief", label: "Brief" },
    { key: "snapshot", label: "Snapshot" },
    { key: "team", label: "Team" },
    { key: "jobs", label: "Jobs", count: state.jobs.filter((j) => !["cancelled", "accepted"].includes(j.status)).length },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-4 py-3.5 md:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3.5">
          <BrandName key={state.brand.name} id={brandId} name={state.brand.name} />
          <StageStepper stage={state.brand.stage} />
        </div>
        <div className="flex items-center gap-2">
          <MemberStack members={state.members} />
          <button
            onClick={() => setShare("invite")}
            className="flex min-h-9 items-center gap-1.5 rounded-full bg-accent px-3 text-[13px] font-medium text-accent-ink hover:bg-accent-hover"
          >
            <InviteIcon />
            Invite
          </button>
          <button
            onClick={() => setShare("feedback")}
            className="flex min-h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] font-medium hover:text-accent-text"
          >
            <ShareIcon />
            Share
          </button>
          <button onClick={() => setMobilePanel(true)} aria-expanded={mobilePanel} aria-controls="brand-panel" className="flex min-h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] font-medium lg:hidden">
            Brand panel
          </button>
        </div>
      </header>
      <AutopilotBanner
        autopilot={autopilot}
        onStop={() => setLocalAutopilot({ status: "done" })}
        onReview={() => document.querySelector("[data-autopilot-summary]")?.scrollIntoView({ behavior: "smooth", block: "center" })}
      />
      <div className="flex min-h-0 flex-1">
        {/* Conversation */}
        <section className={`${mobilePanel ? "hidden" : "flex"} min-w-0 flex-1 flex-col lg:flex`} aria-label="Conversation">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[640px] px-4 pt-8 pb-4 md:px-6">
              {empty ? (
                <div className="pt-[12vh]">
                  <div className="flex gap-3">
                    <AgentAvatar />
                    <div className="pt-0.5">
                      <p className="text-[18px] leading-snug font-semibold tracking-[-0.01em]">
                        {hasBrief ? "Pick up where you left off" : "What are you thinking of making?"}
                      </p>
                      <p className="mt-1.5 text-ink-2">
                        {hasBrief
                          ? "This brand already has a brief, maybe started from another app. Tell me what to work on next, or keep shaping it."
                          : "Describe the idea in your own words, rough is fine. I'll ask a few questions and build the brief on the right as we go."}
                      </p>
                      <div className="mt-5 flex flex-wrap gap-2">
                        {(hasBrief ? RESUME_STARTERS : STARTERS).map((s) => (
                          <button key={s} onClick={() => send(s)} className="min-h-[34px] rounded-full border border-line-strong bg-bg px-3 text-[13px] hover:border-focus hover:text-accent-text">
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <MessageList
                  messages={state.messages}
                  members={state.members}
                  viewerId={state.viewerId}
                  onStartAutopilot={openAutopilot}
                  pendingUser={pendingUser}
                  streaming={streaming}
                  error={error}
                  jobs={state.jobs}
                  busy={busy}
                  onSend={send}
                  onViewJob={viewJob}
                  onEditSpec={editSpec}
                />
              )}
            </div>
          </div>
          <div className="mx-auto w-full max-w-[640px] px-4 pb-6 md:px-6">
            <Composer onSend={send} busy={busy} onStop={() => abort.current?.abort()} autoFocus={empty} />
          </div>
        </section>

        {/* Brand panel */}
        <aside
          id="brand-panel"
          className={`${mobilePanel ? "flex" : "hidden"} min-h-0 w-full flex-col border-divider bg-panel lg:flex lg:w-[380px] lg:shrink-0 lg:border-l`}
          aria-label="Brand panel"
        >
          <div className="px-4 pt-3 lg:px-6 lg:pt-5">
            <button onClick={() => setMobilePanel(false)} className="mb-1 min-h-10 text-[13px] text-ink-2 lg:hidden">
              ‹ Chat
            </button>
            <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Brand workspace">
              {tabs.map((t, index) => (
                <button
                  key={t.key}
                  id={`brand-tab-${t.key}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  aria-controls="brand-tab-content"
                  tabIndex={tab === t.key ? 0 : -1}
                  onClick={() => setTab(t.key)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const offset = event.key === "ArrowRight" ? 1 : -1;
                    const next = tabs[(index + offset + tabs.length) % tabs.length];
                    setTab(next.key);
                    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#brand-tab-${next.key}`)?.focus();
                  }}
                  className={`min-h-10 rounded-lg px-2.5 py-1.5 text-[13px] lg:min-h-0 ${tab === t.key ? "bg-tab font-medium text-ink" : "text-ink-3 hover:text-ink"}`}
                >
                  {t.label}
                  {t.count ? <span className="ml-1.5 font-mono text-[11px] text-accent-text">{t.count}</span> : null}
                </button>
              ))}
            </div>
          </div>
          <div id="brand-tab-content" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-[22px] pb-7 lg:px-6" role="tabpanel" aria-labelledby={`brand-tab-${tab}`}>
            {tab === "brief" && (
              <>
                <ScoreCard
                  score={state.score}
                  autopilot={autopilot}
                  onStartAutopilot={() => setAutopilotSheet(true)}
                  busy={busy}
                  onPrompt={send}
                  onAction={(a) => setShare(a === "invite" ? "invite" : "feedback")}
                />
                <BriefTab state={state} flash={flash} onNextStep={onNextStep} busy={busy} />
              </>
            )}
            {tab === "snapshot" && <SnapshotTab jobs={state.jobs} onNextStep={onNextStep} busy={busy} />}
            {tab === "team" && <TeamTab state={state} onRefresh={refresh} onInvite={() => setShare("invite")} refreshFailed={refreshFailed} />}
            {tab === "jobs" && (
              <JobsTab
                jobs={state.jobs}
                selectedId={selectedJob}
                setSelectedId={(id) => {
                  setSelectedJob(id);
                  setEditingSpec(false);
                }}
                editingSpec={editingSpec}
                setEditingSpec={setEditingSpec}
                onOpenSnapshot={() => setTab("snapshot")}
              />
            )}
          </div>
        </aside>
      </div>
      {autopilotSheet && (
        <AutopilotSheet
          brandName={state.brand.name}
          onClose={() => setAutopilotSheet(false)}
          onStart={() => {
            const now = Date.now();
            setLocalAutopilot({
              status: "active",
              startedAt: new Date(now).toISOString(),
              endsAt: new Date(now + AUTOPILOT_HOURS * 3_600_000).toISOString(),
              cyclesRun: 0,
            });
            setAutopilotSheet(false);
          }}
        />
      )}
      {share && (
        <ShareSheet state={state} mode={share} onMode={setShare} onClose={() => setShare(null)} onChanged={refresh} />
      )}
    </div>
  );
}
