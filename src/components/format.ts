import type { JobView } from "@/lib/services/jobs";

export function formatPrice(cents: number) {
  return cents === 0 ? "Free" : `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
}

export function formatEta(days: number) {
  return days <= 1 ? "Within a day" : `${days} days`;
}

function duration(from: Date, to: Date) {
  const mins = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

/** The one-line status shown on job cards: "Done · 8 min · by Research agent". */
export function jobStatusLine(job: JobView) {
  const by = `by ${job.fulfillerLabel}`;
  const started = job.events.find((e) => e.kind === "status" && e.payload.to === "in_progress");
  const checkoutOpened = job.events.some((e) => e.payload.checkout);
  switch (job.status) {
    case "quoted":
      return checkoutOpened ? "Awaiting payment" : "Quote ready";
    case "approved":
    case "in_progress":
      return `Running · ${by}`;
    case "delivered":
    case "accepted": {
      const done = [...job.events].reverse().find((e) => e.kind === "status" && e.payload.to === "delivered");
      const time = started && done ? ` · ${duration(new Date(started.createdAt), new Date(done.createdAt))}` : "";
      return `Done${time} · ${by}`;
    }
    case "failed":
      return "Needs attention · an operator is on it";
    case "cancelled":
      return "Cancelled";
    default:
      return job.status;
  }
}
