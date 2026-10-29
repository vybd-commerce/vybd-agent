"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { briefFieldsSchema, type BriefFieldKey } from "@/lib/brief";
import { createBrand, renameBrand, setShareSettings } from "@/lib/services/brands";
import { updateBrandBrief } from "@/lib/services/brief";
import { createSharePage, feedbackInputSchema, submitFeedback } from "@/lib/services/feedback";
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
import { requireCtx } from "@/lib/session";

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

export async function signInWithEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "/");
  await signIn("email", { email, redirectTo: next });
}

export async function signInWithGoogle(formData: FormData) {
  await signIn("google", { redirectTo: String(formData.get("next") ?? "/") });
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
  return wrap(async () => submitFeedback(slug, input));
}
