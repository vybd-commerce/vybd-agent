import type { AutopilotView } from "@/lib/autopilot";
import type { Ctx } from "./context";
import { getBrand, listMembers } from "./brands";
import { getBrandBrief } from "./brief";
import { latestConversation, listMessages } from "./conversations";
import { getFeedback } from "./feedback";
import { listJobs } from "./jobs";
import { listLanes } from "./lanes";
import { recordUnlock, scoreFrom } from "./score";

/** Everything the three-column brand screen needs, in one read. */
export async function getBrandState(ctx: Ctx, brandId: string) {
  const brand = await getBrand(ctx, brandId);
  const conversation = await latestConversation(brandId, "web");
  const [brief, jobs, feedback, messages, members, lanes] = await Promise.all([
    getBrandBrief(ctx, brandId),
    listJobs(ctx, brandId),
    getFeedback(ctx, brandId),
    conversation ? listMessages(ctx, conversation.id) : Promise.resolve([]),
    listMembers(brandId),
    listLanes(ctx, brandId),
  ]);
  const score = scoreFrom({
    fields: brief.fields,
    sharePublished: brand.sharePublished,
    jobs,
    counted: feedback.counted,
    members: members.length,
  });
  // Posts the celebration once (it may create the conversation); re-read so the card shows on this load.
  const justUnlocked = !brand.scoreUnlockedAt && (await recordUnlock(brandId, score));
  const conv = justUnlocked ? await latestConversation(brandId, "web") : conversation;
  return {
    brand: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      stage: brand.stage,
      sharePublished: brand.sharePublished,
      shareHiddenFields: brand.shareHiddenFields,
    },
    // The viewer's own role decides which controls show (approve, share settings, reset invite).
    viewerId: ctx.userId,
    viewerRole: brand.ownerId === ctx.userId ? ("owner" as const) : ("member" as const),
    members: members.map((m) => ({ userId: m.userId, name: m.name ?? m.email?.split("@")[0] ?? "Member", image: m.image, role: m.role })),
    lanes: lanes.map(({ id, title, ownerId, tasks }) => ({
      id,
      title,
      ownerId,
      tasks: tasks.map(({ id, title, done }) => ({ id, title, done })),
    })),
    brief,
    jobs,
    feedback,
    messages: justUnlocked && conv ? await listMessages(ctx, conv.id) : messages,
    score,
    // UI only for now: no runs are stored yet, so an unlocked brand always shows "available".
    autopilot: { status: score.unlocked ? "available" : "locked" } as AutopilotView,
  };
}

export type BrandState = Awaited<ReturnType<typeof getBrandState>>;
