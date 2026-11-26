"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { renameBrandAction } from "@/app/actions";
import type { BrandState } from "@/lib/services/brand-state";
import { AUTOPILOT_HOURS, type AutopilotView } from "@/lib/autopilot";
import { defaultLayout, type SectionId } from "@/lib/panel-layout";
import type { NextStep } from "@/lib/types";
import { NEXT_STEP_PROMPTS } from "./next-step-card";
import { AutopilotBanner, AutopilotSheet } from "./autopilot";
import { Section, type SectionProps } from "./panel/sections";
import { ShareSheet, type ShareMode } from "./share-sheet";
import { StageStepper } from "./stage-stepper";
import { useBrandState } from "./use-brand-state";

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

/** Shown until the viewer has connected an assistant: Vybd is driven from Claude, ChatGPT and the like. */
function ConnectBanner() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider bg-accent-soft px-4 py-3 md:px-6">
      <p className="text-[13px]">
        <span className="font-medium">Connect your assistant to work on this brand.</span>{" "}
        <span className="text-ink-2">Vybd runs inside Claude, ChatGPT and other AI tools you already use.</span>
      </p>
      <Link href="/connect" className="rounded-full bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:bg-accent-hover">
        Connect →
      </Link>
    </div>
  );
}

/** "Copied" toast after a prompt is copied for the founder's own assistant. */
function AskToast({ prompt, onDone }: { prompt: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [prompt, onDone]);
  return (
    <div role="status" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-[460px] rounded-xl bg-ink px-4 py-3 text-[13px] text-white shadow-lg">
      <p className="font-medium">Copied. Paste it into Claude, ChatGPT or your assistant:</p>
      <p className="mt-0.5 truncate opacity-80">“{prompt}”</p>
    </div>
  );
}

export function BrandWorkspace({ initial }: { initial: BrandState }) {
  const { state, refresh, flash } = useBrandState(initial);
  const searchParams = useSearchParams();
  const [share, setShare] = useState<ShareMode | null>(null);
  const [autopilotSheet, setAutopilotSheet] = useState(false);
  // UI only: nothing runs or persists yet, so Start/Stop just switch what this tab shows.
  const [localAutopilot, setLocalAutopilot] = useState<AutopilotView | null>(null);
  const autopilot = localAutopilot ?? state.autopilot;
  // Returning from checkout (?job=…) opens that job.
  const [selectedJob, setSelectedJob] = useState<string | null>(() => searchParams.get("job"));
  const [editingSpec, setEditingSpec] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const layout = defaultLayout();

  const scrollTo = useCallback((id: SectionId) => {
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const jumpedToJob = useRef(false);
  useEffect(() => {
    if (selectedJob && !jumpedToJob.current) {
      jumpedToJob.current = true;
      scrollTo("jobs");
    }
  }, [selectedJob, scrollTo]);

  const ask = useCallback((prompt: string) => {
    void navigator.clipboard?.writeText(prompt).catch(() => {});
    setAsked(prompt);
  }, []);
  const onNextStep = useCallback((s: NextStep) => (s.kind === "invite" ? setShare("invite") : ask(NEXT_STEP_PROMPTS[s.kind])), [ask]);
  const openJob = useCallback(
    (id: string, edit: boolean) => {
      setSelectedJob(id);
      setEditingSpec(edit);
      scrollTo("jobs");
    },
    [scrollTo],
  );

  const props: SectionProps = {
    state,
    flash,
    autopilot,
    selectedJob,
    setSelectedJob,
    editingSpec,
    setEditingSpec,
    ask,
    onNextStep,
    onShare: setShare,
    onStartAutopilot: () => setAutopilotSheet(true),
    onViewJob: (id) => openJob(id, false),
    onEditSpec: (id) => openJob(id, true),
    scrollTo,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-4 py-3.5 md:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3.5">
          <BrandName key={state.brand.name} id={state.brand.id} name={state.brand.name} />
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
        </div>
      </header>
      {!state.hasAssistant && <ConnectBanner />}
      <AutopilotBanner
        autopilot={autopilot}
        onStop={() => setLocalAutopilot({ status: "done" })}
        onReview={() => document.querySelector("[data-autopilot-summary]")?.scrollIntoView({ behavior: "smooth", block: "center" })}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1120px] gap-8 px-4 pt-6 pb-10 md:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-6">
            {layout.main.map((id) => (
              <Section key={id} id={id} props={props} />
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-8 lg:border-l lg:border-divider lg:pl-8">
            {layout.side.map((id) => (
              <Section key={id} id={id} props={props} />
            ))}
          </div>
        </div>
      </div>
      {asked && <AskToast prompt={asked} onDone={() => setAsked(null)} />}
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
      {share && <ShareSheet state={state} mode={share} onMode={setShare} onClose={() => setShare(null)} onChanged={refresh} />}
    </div>
  );
}
