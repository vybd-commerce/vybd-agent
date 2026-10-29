import { ZodError } from "zod";

/** Map service errors to JSON responses. Services throw errors carrying an HTTP `status`. */
export function errorResponse(err: unknown) {
  if (err instanceof ZodError) return Response.json({ error: err.issues.map((i) => i.message).join("; ") }, { status: 400 });
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    return Response.json({ error: (err as Error).message }, { status });
  }
  console.error(err);
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}
