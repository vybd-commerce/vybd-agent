import Stripe from "stripe";

let client: Stripe | null = null;

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

export function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Without Stripe keys in development, payments go through a local test checkout page. */
export function devCheckoutAllowed() {
  return !stripeConfigured() && process.env.NODE_ENV !== "production";
}
