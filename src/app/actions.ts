"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { REFERRAL_COOKIE, signIn, signOut } from "@/auth";
import { INVITE_COOKIE, approveWaitlist } from "@/lib/services/beta";
import { briefFieldsSchema, type BriefFieldKey } from "@/lib/brief";
import { createBrand, renameBrand, setShareSettings } from "@/lib/services/brands";
import { updateBrandBrief } from "@/lib/services/brief";
import { createSharePage, feedbackInputSchema, submitFeedback } from "@/lib/services/feedback";
import { acceptInvite, getOrCreateInvite, resetInvite } from "@/lib/services/invites";
import {
  acceptJob,
  applyProposedEdit,
  approveJob,
  cancelJob,
  claimJob,
  operatorDeliver,
  operatorFail,
  postJobMessage,
  postProgress,
  quoteJob,
  updateJobSpec,
} from "@/lib/services/jobs";
import { addLaneTask, claimLane, releaseLane, setLaneTaskDone } from "@/lib/services/lanes";
import { getCtx, requireCtx } from "@/lib/session";

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

async function wrap<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect/notFound
    const message = err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ---------- Auth ----------

/** Remember which share page sent this visitor, so the new account is credited to that brand. */
async function rememberReferral(formData: FormData) {
  const ref = String(formData.get("ref") ?? "");
  if (!/^[a-z0-9-]{1,64}$/.test(ref)) return;
  (await cookies()).set(REFERRAL_COOKIE, ref, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24, path: "/" });
}

/** Signing in from a /join link: keep the invite token so the beta gate lets the invitee through. */
async function rememberInvite(formData: FormData) {
  const match = /^\/join\/([A-Za-z0-9_-]{1,64})$/.exec(String(formData.get("next") ?? ""));
  if (!match) return;
  (await cookies()).set(INVITE_COOKIE, match[1], { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24, path: "/" });
}

export async function signInWithEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "/");
  await rememberReferral(formData);
  await rememberInvite(formData);
  await signIn("email", { email, redirectTo: next });
}

export async function signInWithGoogle(formData: FormData) {
  await rememberReferral(formData);
  await rememberInvite(formData);
  await signIn("google", { redirectTo: String(formData.get("next") ?? "/") });
}

export async function signInWithGitHub(formData: FormData) {
  await rememberReferral(formData);
  await rememberInvite(formData);
  await signIn("github", { redirectTo: String(formData.get("next") ?? "/") });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

// ---------- Brands ----------

export async function newBrandAction() {
  const ctx = await requireCtx();
  const brand = await createBrand(ctx, {});
  redirect(`/brands/${brand.id}`);
}

export async function renameBrandAction(brandId: string, name: string) {
  return wrap(async () => renameBrand(await requireCtx(), brandId, name));
}

export async function editBriefFieldAction(brandId: string, key: BriefFieldKey, value: string | string[]) {
  return wrap(async () => {
    const patch = briefFieldsSchema.parse({ [key]: value });
    return updateBrandBrief(await requireCtx(), brandId, patch, "user_edit");
  });
}

export async function shareSettingsAction(brandId: string, input: { hiddenFields?: string[]; published?: boolean }) {
  return wrap(async () => setShareSettings(await requireCtx(), brandId, input));
}

export async function createSharePageAction(brandId: string) {
  return wrap(async () => createSharePage(await requireCtx(), brandId));
}

// ---------- Invites ----------

export async function getInviteAction(brandId: string) {
  return wrap(async () => getOrCreateInvite(await requireCtx(), brandId));
}

export async function resetInviteAction(brandId: string) {
  return wrap(async () => resetInvite(await requireCtx(), brandId));
}

export async function acceptInviteAction(token: string) {
  const ctx = await requireCtx(`/join/${token}`);
  const { brandId } = await acceptInvite(ctx, token);
  redirect(`/brands/${brandId}`);
}

// ---------- Lanes ----------

const laneTarget = z.object({ brandId: z.uuid(), laneId: z.uuid() });
const newLaneTask = laneTarget.extend({ title: z.string().trim().min(1).max(200) });
const taskCompletion = z.object({ brandId: z.uuid(), taskId: z.uuid(), done: z.boolean() });

export async function claimLaneAction(input: z.input<typeof laneTarget>) {
  return wrap(async () => {
    const ctx = await requireCtx();
    const { brandId, laneId } = laneTarget.parse(input);
    return (await claimLane(ctx, laneId, brandId)).id;
  });
}

export async function releaseLaneAction(input: z.input<typeof laneTarget>) {
  return wrap(async () => {
    const ctx = await requireCtx();
    const { brandId, laneId } = laneTarget.parse(input);
    return (await releaseLane(ctx, laneId, brandId)).id;
  });
}

export async function addLaneTaskAction(input: z.input<typeof newLaneTask>) {
  return wrap(async () => {
    const ctx = await requireCtx();
    const { brandId, laneId, title } = newLaneTask.parse(input);
    return (await addLaneTask(ctx, laneId, title, brandId)).id;
  });
}

export async function setLaneTaskDoneAction(input: z.input<typeof taskCompletion>) {
  return wrap(async () => {
    const ctx = await requireCtx();
    const { brandId, taskId, done } = taskCompletion.parse(input);
    return (await setLaneTaskDone(ctx, taskId, done, brandId)).id;
  });
}

// ---------- Jobs (founder) ----------

export async function quoteJobAction(brandId: string, type: string) {
  return wrap(async () => (await quoteJob(await requireCtx(), brandId, type)).id);
}

export async function approveJobAction(jobId: string) {
  return wrap(async () => {
    const { checkoutUrl } = await approveJob(await requireCtx(), jobId);
    return { checkoutUrl: checkoutUrl ?? null };
  });
}

export async function updateJobSpecAction(jobId: string, spec: Record<string, unknown>) {
  return wrap(async () => (await updateJobSpec(await requireCtx(), jobId, spec)).id);
}

export async function cancelJobAction(jobId: string) {
  return wrap(async () => (await cancelJob(await requireCtx(), jobId)).id);
}

export async function acceptJobAction(jobId: string) {
  return wrap(async () => (await acceptJob(await requireCtx(), jobId)).id);
}

export async function postJobMessageAction(jobId: string, text: string) {
  return wrap(async () => (await postJobMessage(await requireCtx(), jobId, text)).id);
}

export async function applyProposedEditAction(messageId: string, index: number) {
  return wrap(async () => (await applyProposedEdit(await requireCtx(), messageId, index)).id);
}

// ---------- Beta (operator) ----------

export async function approveWaitlistAction(formData: FormData) {
  const ctx = await requireCtx();
  await approveWaitlist(ctx, String(formData.get("email") ?? ""));
  revalidatePath("/ops/waitlist");
}

// ---------- Jobs (operator) ----------

export async function claimJobAction(jobId: string) {
  return wrap(async () => (await claimJob(await requireCtx(), jobId)).id);
}

export async function postProgressAction(jobId: string, input: { step?: string; note: string }) {
  return wrap(async () => (await postProgress(await requireCtx(), jobId, input)).id);
}

export async function deliverJobAction(jobId: string, result: unknown) {
  return wrap(async () => (await operatorDeliver(await requireCtx(), jobId, result)).id);
}

export async function failJobAction(jobId: string, reason: string) {
  return wrap(async () => (await operatorFail(await requireCtx(), jobId, reason)).id);
}

// ---------- Public share page ----------

export async function submitFeedbackAction(slug: string, input: z.infer<typeof feedbackInputSchema>) {
  return wrap(async () => {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip");
    const ctx = await getCtx();
    return submitFeedback(slug, input, { ip, userId: ctx?.userId });
  });
}
