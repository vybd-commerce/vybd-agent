"use client";

import type { ReactNode } from "react";
import type { AutopilotView } from "@/lib/autopilot";
import type { SectionId } from "@/lib/panel-layout";
import type { BrandState } from "@/lib/services/brand-state";
import type { NextStep } from "@/lib/types";
import { ActivityFeed } from "../activity-feed";
import { BriefTab } from "../brief-tab";
import { JobsTab } from "../jobs-tab";
import { ScoreCard } from "../score-card";
import { SnapshotTab } from "../snapshot-tab";

/** Everything a section may need. Sections take what they use and ignore the rest. */
export type SectionProps = {
  state: BrandState;
  flash: { keys: string[]; at: number };
  autopilot: AutopilotView;
  selectedJob: string | null;
  setSelectedJob: (id: string | null) => void;
  editingSpec: boolean;
  setEditingSpec: (v: boolean) => void;
  /** Copy a prompt for the founder to paste into their own assistant. */
  ask: (prompt: string) => void;
  onNextStep: (s: NextStep) => void;
  onShare: (mode: "invite" | "feedback") => void;
  onStartAutopilot: () => void;
  onViewJob: (id: string) => void;
  onEditSpec: (id: string) => void;
  scrollTo: (id: SectionId) => void;
};

type SectionDef = {
  /** Heading shown above the section; null when the section draws its own. */
  title: string | null;
  render: (p: SectionProps) => ReactNode;
};

function TeamSection({ state, onShare }: SectionProps) {
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {state.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2.5">
            {m.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.image} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-subtle text-[11px] font-semibold text-ink-2">
                {m.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">
              {m.name}
              {m.userId === state.viewerId && <span className="text-ink-3"> (you)</span>}
            </span>
            <span className="font-mono text-[11px] text-ink-3 uppercase">{m.role}</span>
          </li>
        ))}
      </ul>
      <button onClick={() => onShare("invite")} className="text-[13px] font-medium text-accent-text hover:underline">
        Invite someone to build this with you →
      </button>
    </div>
  );
}

/** The section registry. A layout (see lib/panel-layout.ts) is a list of these ids. */
export const SECTIONS: Record<SectionId, SectionDef> = {
  score: {
    title: null,
    render: (p) => (
      <ScoreCard
        score={p.state.score}
        autopilot={p.autopilot}
        onStartAutopilot={p.onStartAutopilot}
        busy={false}
        onPrompt={p.ask}
        onAction={(a) => p.onShare(a === "invite" ? "invite" : "feedback")}
      />
    ),
  },
  brief: {
    title: null,
    render: (p) => <BriefTab state={p.state} flash={p.flash} onNextStep={p.onNextStep} busy={false} />,
  },
  snapshot: {
    title: "Market snapshot",
    render: (p) => <SnapshotTab jobs={p.state.jobs} onNextStep={p.onNextStep} busy={false} />,
  },
  jobs: {
    title: "Jobs",
    render: (p) => (
      <JobsTab
        jobs={p.state.jobs}
        selectedId={p.selectedJob}
        setSelectedId={(id) => {
          p.setSelectedJob(id);
          p.setEditingSpec(false);
        }}
        editingSpec={p.editingSpec}
        setEditingSpec={p.setEditingSpec}
        onOpenSnapshot={() => p.scrollTo("snapshot")}
      />
    ),
  },
  activity: {
    title: "Activity",
    render: (p) => (
      <ActivityFeed
        messages={p.state.messages}
        members={p.state.members}
        viewerId={p.state.viewerId}
        jobs={p.state.jobs}
        onAsk={p.ask}
        onViewJob={p.onViewJob}
        onEditSpec={p.onEditSpec}
        onStartAutopilot={p.autopilot.status === "available" ? p.onStartAutopilot : undefined}
      />
    ),
  },
  team: { title: "Team", render: (p) => <TeamSection {...p} /> },
};

export function Section({ id, props }: { id: SectionId; props: SectionProps }) {
  const def = SECTIONS[id];
  return (
    <section id={`section-${id}`} aria-label={def.title ?? id} className="scroll-mt-4">
      {def.title && <h2 className="mb-3 text-[15px] font-semibold">{def.title}</h2>}
      {def.render(props)}
    </section>
  );
}
