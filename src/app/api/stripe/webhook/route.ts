import type Stripe from "stripe";
import { markJobPaid } from "@/lib/services/jobs";
import { stripe } from "@/lib/stripe";

/** Stripe → job: a completed Checkout moves the job to in_progress and notifies ops. */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook secret not configured", { status: 500 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object;
    const jobId = session.metadata?.jobId;
    if (jobId && session.payment_status === "paid") {
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
      await markJobPaid(jobId, pi);
    }
  }
  return Response.json({ received: true });
}
