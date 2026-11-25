"use client";

import { useState, useTransition } from "react";
import { addLaneTaskAction, claimLaneAction, releaseLaneAction, setLaneTaskDoneAction, type ActionResult } from "@/app/actions";
import type { BrandState } from "@/lib/services/brand-state";

type Member = BrandState["members"][number];
type Lane = BrandState["lanes"][number];

function MemberAvatar({ member }: { member: Member }) {
  if (member.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={member.image} alt="" className="size-6 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-ink">
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function LaneCard({ lane, owner, viewer, brandId, onRefresh, refreshFailed }: {
  lane: Lane;
  owner: Member | undefined;
  viewer: Member | undefined;
  brandId: string;
  onRefresh: () => Promise<void>;
  refreshFailed: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ownsLane = viewer !== undefined && lane.ownerId === viewer.userId;
  const canRelease = lane.ownerId !== null && (ownsLane || viewer?.role === "owner");
  const target = { brandId, laneId: lane.id };
  const titleId = `lane-${lane.id}`;

  function mutate(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    setError(null);
    start(async () => {
      try {
        const result = await action();
        if (result.ok) onSuccess?.();
        else setError(result.error);
      } catch {
        setError("Couldn’t confirm that change. Check the lane before trying again.");
      }
      await onRefresh();
    });
  }

  return (
    <section aria-labelledby={titleId} aria-busy={pending} className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-bg p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h3 id={titleId} className="min-w-0 font-semibold wrap-anywhere">{lane.title}</h3>
        {owner ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2">
            <MemberAvatar member={owner} />
            <span className="wrap-anywhere">{owner.name}</span>
          </span>
        ) : (
          <span className="text-[12px] text-ink-3">{lane.ownerId === null ? "Unassigned" : "Owner unavailable"}</span>
        )}
      </div>

      {lane.tasks.length ? (
        <ul className="space-y-1.5">
          {lane.tasks.map((task) => (
            <li key={task.id}>
              <label className={`flex min-h-9 items-start gap-2.5 py-1.5 text-[13px] ${ownsLane ? "cursor-pointer" : "text-ink-2"}`}>
                <input
                  type="checkbox"
                  checked={task.done}
                  disabled={!ownsLane || pending || refreshFailed}
                  onChange={(event) => {
                    const done = event.currentTarget.checked;
                    mutate(() => setLaneTaskDoneAction({ brandId, taskId: task.id, done }));
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-focus"
                />
                <span className="min-w-0 wrap-anywhere">{task.title}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-3">No tasks yet.</p>
      )}

      {viewer && (
        <div className="space-y-2.5">
          {lane.ownerId === null && (
            <button type="button" disabled={pending || refreshFailed} onClick={() => mutate(() => claimLaneAction(target))} className="min-h-10 rounded-full bg-accent px-3.5 text-[13px] font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50">
              Claim lane
            </button>
          )}
          {canRelease && (
            <button type="button" disabled={pending || refreshFailed} onClick={() => mutate(() => releaseLaneAction(target))} className="min-h-10 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-2 hover:bg-subtle disabled:opacity-50">
              Release lane
            </button>
          )}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (pending || refreshFailed || !draft.trim()) return;
              mutate(() => addLaneTaskAction({ ...target, title: draft }), () => setDraft(""));
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              aria-label={`New task for ${lane.title}`}
              placeholder="New task"
              maxLength={200}
              disabled={pending || refreshFailed}
              className="min-h-10 min-w-0 flex-[1_1_8rem] rounded-lg border border-line px-2.5 text-base placeholder:text-ink-3 lg:text-[13px]"
            />
            <button type="submit" disabled={pending || refreshFailed || !draft.trim()} className="min-h-10 rounded-lg border border-line px-3 text-[13px] font-medium whitespace-nowrap hover:bg-subtle disabled:opacity-50">
              Add task
            </button>
          </form>
        </div>
      )}

      {pending && <p role="status" className="text-[12px] text-ink-3">Updating lane…</p>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </section>
  );
}

export function TeamTab({ state, onRefresh, onInvite, refreshFailed }: {
  state: BrandState;
  onRefresh: () => Promise<void>;
  onInvite: () => void;
  refreshFailed: boolean;
}) {
  const members = new Map(state.members.map((member) => [member.userId, member]));
  const viewer = members.get(state.viewerId);
  const [retrying, startRetry] = useTransition();

  return (
    <div className="space-y-5">
      <section aria-labelledby="team-members-heading">
        <h2 id="team-members-heading" className="text-[15px] font-semibold">Team members</h2>
        <ul className="mt-2.5 space-y-2">
          {state.members.map((member) => (
            <li key={member.userId} className="flex min-w-0 items-center gap-2 text-[13px]">
              <MemberAvatar member={member} />
              <span className="min-w-0 wrap-anywhere">{member.name}</span>
              <span className="ml-auto shrink-0 text-[12px] text-ink-3">{member.role === "owner" ? "Brand owner" : "Member"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="team-lanes-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="team-lanes-heading" className="text-[15px] font-semibold">Who’s doing what</h2>
          <span className="shrink-0 font-mono text-[11px] text-ink-3">{state.lanes.length} {state.lanes.length === 1 ? "lane" : "lanes"}</span>
        </div>
        {refreshFailed && (
          <div className="flex flex-wrap items-center gap-x-2 text-[13px]">
            <p role="status" className="text-ink-2">Couldn’t refresh the lanes.</p>
            <button type="button" disabled={retrying} onClick={() => startRetry(onRefresh)} className="min-h-10 font-medium underline underline-offset-2 disabled:opacity-50">
              {retrying ? "Refreshing…" : "Retry refresh"}
            </button>
          </div>
        )}
        {state.lanes.length === 0 && <p className="text-[13px] text-ink-3">No lanes yet.</p>}
        {state.lanes.map((lane) => (
          <LaneCard
            key={lane.id}
            lane={lane}
            owner={lane.ownerId ? members.get(lane.ownerId) : undefined}
            viewer={viewer}
            brandId={state.brand.id}
            onRefresh={onRefresh}
            refreshFailed={refreshFailed}
          />
        ))}
      </section>

      {viewer && (
        <button type="button" onClick={onInvite} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-3 text-[13px] font-medium text-ink-2 hover:bg-subtle hover:text-ink">
          <span aria-hidden="true" className="text-base">+</span>
          Invite someone to own a lane
        </button>
      )}
    </div>
  );
}
