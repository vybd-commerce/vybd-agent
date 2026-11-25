/**
 * Job worker: runs the agent part of in-progress jobs. Run alongside the web app with `pnpm worker`.
 * Claims one job at a time with FOR UPDATE SKIP LOCKED, so several workers can run safely.
 *
 * Idle polling is slow in production (WORKER_POLL_MS) so Neon can scale to zero; the web app
 * POSTs /wake (WORKER_URL + WORKER_TOKEN) when a job starts, which ends the wait at once.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { sql } from "@/db";
import { flushMonitoring, initMonitoring, reportError } from "@/lib/monitoring";
import { runTick } from "./tick";

initMonitoring("worker");

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3000);
let stopping = false;
let wake: (() => void) | null = null;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      wake = null;
      resolve();
    }
    wake = done;
  });
}

function authorized(header: string | undefined) {
  const token = process.env.WORKER_TOKEN;
  if (!token) return false;
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

const port = Number(process.env.WORKER_PORT ?? process.env.PORT ?? 0);
const server = port
  ? createServer((req, res) => {
      if (req.method === "GET" && req.url === "/health") return res.writeHead(200).end("ok");
      if (req.method === "POST" && req.url === "/wake") {
        if (!authorized(req.headers.authorization)) return res.writeHead(401).end();
        wake?.();
        return res.writeHead(202).end();
      }
      res.writeHead(404).end();
    }).listen(port, "::", () => console.log(`[worker] wake endpoint on :${port}`))
  : null;

async function loop() {
  console.log(`[worker] started, idle poll ${POLL_MS}ms`);
  while (!stopping) {
    try {
      // One job per pass so a shutdown signal is noticed between jobs.
      const { ran } = await runTick({ maxJobs: 1 });
      if (ran) continue;
    } catch (err) {
      console.error("[worker] poll failed", err);
      reportError(err);
    }
    await sleep(POLL_MS);
  }
  server?.close();
  await flushMonitoring();
  await sql.end();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    wake?.();
  });
}

void loop();
