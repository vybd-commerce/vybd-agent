import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initMonitoring } = await import("@/lib/monitoring");
    initMonitoring("web");
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/monitoring");
  reportError(err, { path: request.path, method: request.method, routePath: context.routePath, routeType: context.routeType });
};
