"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { renameBrandAction } from "@/app/actions";
import type { ChatEvent } from "@/lib/agent/orchestrator";
import type { BrandState } from "@/lib/services/brand-state";
import type { NextStep } from "@/lib/types";
import { BriefTab } from "./brief-tab";
import { Composer, MessageList, toolActivity, type StreamingReply } from "./conversation";
import { JobsTab } from "./jobs-tab";
import { NEXT_STEP_PROMPTS } from "./next-step-card";
import { SnapshotTab } from "./snapshot-tab";
import { StageStepper } from "./stage-stepper";
import { useBrandState } from "./use-brand-state";
import { AgentAvatar } from "./wordmark";

type Tab = "brief" | "snapshot" | "jobs";

const RESUME_STARTERS = ["What's missing from my brief?", "What should I do next?"];

const STARTERS = [
  "A refillable scalp oil for women with thinning hair",
  "Protein snacks for kids who refuse breakfast",
  "Minimal travel gear for people who only carry on",
];

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
      className="w-full max-w-[260px] rounded-md border border-accent px-1.5 text-[15px] font-semibold outline-none"
    />
  ) : (
    <button onClick={() => setEditing(true)} className="truncate text-[15px] font-semibold hover:text-accent" title="Rename">
      {name}
    </button>
  );
}

export function BrandWorkspace({ initial }: { initial: BrandState }) {
  const { state, refresh, flash } = useBrandState(initial);
  const searchParams = useSearchParams();
  // Returning from checkout (?job=…) opens that job.
  const [tab, setTab] = useState<Tab>(() => (searchParams.get("job") ? "jobs" : "brief"));
  const [mobilePanel, setMobilePanel] = useState(false);
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

  const onNextStep = useCallback((s: NextStep) => send(NEXT_STEP_PROMPTS[s.kind]), [send]);
  const empty = state.messages.length === 0 && !pendingUser && !streaming;
  const hasBrief = state.brief.version > 0;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "brief", label: "Brief" },
    { key: "snapshot", label: "Snapshot" },
    { key: "jobs", label: "Jobs", count: state.jobs.filter((j) => !["cancelled", "accepted"].includes(j.status)).length },
  ];

  return (
    <div className="flex h-full min-h-0">
      {/* Conversation */}
      <section className={`${mobilePanel ? "hidden" : "flex"} min-w-0 flex-1 flex-col lg:flex`} aria-label="Conversation">
        <header className="flex min-h-[57px] flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5 md:px-6">
          <div className="min-w-0 flex-1 basis-40">
            <BrandName key={state.brand.name} id={brandId} name={state.brand.name} />
          </div>
          <StageStepper stage={state.brand.stage} />
          <div className="flex items-center gap-2">
            {state.feedback.url ? (
              <a href={state.feedback.url} target="_blank" rel="noreferrer" className="h-8 rounded-lg border border-line px-3 text-[13px] leading-8 font-medium hover:bg-subtle">
                Share
              </a>
            ) : (
              <button
                disabled={busy}
                onClick={() => send(NEXT_STEP_PROMPTS.share_page)}
                className="h-8 rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-subtle disabled:opacity-50"
              >
                Share
              </button>
            )}
            <button onClick={() => setMobilePanel(true)} className="h-8 rounded-lg border border-line px-3 text-[13px] font-medium lg:hidden">
              Brief
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[640px] px-4 py-6 md:px-6">
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
                    <div className="mt-5 flex flex-wrap gap-1.5">
                      {(hasBrief ? RESUME_STARTERS : STARTERS).map((s) => (
                        <button key={s} onClick={() => send(s)} className="rounded-full border border-line px-3 py-1 text-[13px] hover:border-accent hover:text-accent">
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
        <div className="mx-auto w-full max-w-[640px] px-4 pb-4 md:px-6">
          <Composer onSend={send} busy={busy} onStop={() => abort.current?.abort()} autoFocus={empty} />
        </div>
      </section>

      {/* Brand panel */}
      <aside
        className={`${mobilePanel ? "flex" : "hidden"} min-h-0 w-full flex-col border-line lg:flex lg:w-[380px] lg:shrink-0 lg:border-l`}
        aria-label="Brand panel"
      >
        <div className="flex h-[57px] items-center gap-1 border-b border-line px-3" role="tablist">
          <button onClick={() => setMobilePanel(false)} className="mr-1 text-[13px] text-ink-2 lg:hidden">
            ‹ Chat
          </button>
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`h-8 rounded-lg px-3 text-[13px] font-medium ${tab === t.key ? "bg-subtle text-ink" : "text-ink-2 hover:text-ink"}`}
            >
              {t.label}
              {t.count ? <span className="ml-1.5 font-mono text-[11px] text-accent">{t.count}</span> : null}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" role="tabpanel">
          {tab === "brief" && <BriefTab state={state} flash={flash} onNextStep={onNextStep} busy={busy} />}
          {tab === "snapshot" && <SnapshotTab jobs={state.jobs} onNextStep={onNextStep} busy={busy} />}
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
  );
}
