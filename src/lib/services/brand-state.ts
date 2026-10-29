import type { Ctx } from "./context";
import { getBrand } from "./brands";
import { getBrandBrief } from "./brief";
import { latestConversation, listMessages } from "./conversations";
import { getFeedback } from "./feedback";
import { listJobs } from "./jobs";

/** Everything the three-column brand screen needs, in one read. */
export async function getBrandState(ctx: Ctx, brandId: string) {
  const brand = await getBrand(ctx, brandId);
  const conversation = await latestConversation(brandId, "web");
  const [brief, jobs, feedback, messages] = await Promise.all([
    getBrandBrief(ctx, brandId),
    listJobs(ctx, brandId),
    getFeedback(ctx, brandId),
    conversation ? listMessages(ctx, conversation.id) : Promise.resolve([]),
  ]);
  return {
    brand: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      stage: brand.stage,
      sharePublished: brand.sharePublished,
      shareHiddenFields: brand.shareHiddenFields,
    },
    brief,
    jobs,
    feedback,
    messages,
  };
}

export type BrandState = Awaited<ReturnType<typeof getBrandState>>;
