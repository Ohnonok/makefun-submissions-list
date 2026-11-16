// Entry process: join the trial env, serve, and leave when told.
//
// Launcher design (RULES.txt:80, competition.yaml:171,173,252,338):
//   - The entry point stays `node /bot/main.ts`. This file spawns the
//     prebuilt static binary ./forge-server ASYNC and supervises it:
//     one SERVING process (one port, one store, no fan-out, never 8080).
//   - No build/compile at boot: the binary is prebuilt and committed.
//   - The register + waitForDone protocol stays in Node, reusing the
//     PROVEN v3.2 logic verbatim (REGISTER_TIMEOUT_MS=2000, backoff
//     250/500/1000/2000, ~8 tries inside the 20 s boot budget).
//   - When the env reports done, the child is SIGTERMed and main exits 0.
//   - Signals are forwarded to the child so no orphan holds the port.
//
// Sequence:
//   1. MAKEFUN_ENV_URL must name the env origin. Absent, exit 1 at once.
//   2. Spawn ./forge-server; read the "[forge] port=N" line from stdout.
//   3. POST $MAKEFUN_ENV_URL/register {"port": N}. 200 wins; 409 means a
//      first register already won (wait like any other); 400/405 are
//      contract errors and end the program.
//   4. GET $MAKEFUN_ENV_URL/done until the body reads {"done": true}.
//   5. SIGTERM the child, wait for it, exit 0.

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

const ENV_URL = (process.env.MAKEFUN_ENV_URL ?? "").replace(/\/+$/, "");
if (ENV_URL === "") {
  process.stderr.write("[entry] MAKEFUN_ENV_URL is not set: there is no env to register with\n");
  process.exit(1);
}

/** Longest a single register or done request may run before it is dropped and retried. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Longest a single REGISTER request may run (sealed-0 fix: 2 s per attempt). */
const REGISTER_TIMEOUT_MS = 2_000;
/** First pause between retries, and the ceiling it grows to. */
const RETRY_INITIAL_MS = 250;
const RETRY_MAX_MS = 2_000;
/** Longest to wait for the child to print its port line. */
const CHILD_PORT_TIMEOUT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pause after `attempt` failed requests: exponential from RETRY_INITIAL_MS, capped. */
function retryDelay(attempt: number): number {
  const doubled = RETRY_INITIAL_MS * 2 ** Math.min(attempt, 8);
  return doubled < RETRY_MAX_MS ? doubled : RETRY_MAX_MS;
}

let child: ChildProcess | null = null;

/** Spawn ./forge-server and resolve with the port it binds. */
function startChild(): Promise<number> {
  return new Promise((resolve, reject) => {
    const c = spawn("./forge-server", [], { stdio: ["ignore", "pipe", "inherit"] });
    child = c;
    const timer = setTimeout(() => {
      reject(new Error("forge-server did not print its port within 10 s"));
    }, CHILD_PORT_TIMEOUT_MS);
    timer.unref();
    c.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    c.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`forge-server exited early (code=${code} signal=${signal})`));
    });
    const rl = createInterface({ input: c.stdout! });
    rl.on("line", (line) => {
      const m = /^\[forge\] port=(\d+)$/.exec(line.trim());
      if (m) {
        clearTimeout(timer);
        rl.close();
        resolve(Number(m[1]));
      }
    });
  });
}

/**
 * POST the bound port until the env takes it. 200 is the usual answer;
 * 409 says a first register already won, which is not this process's
 * problem. 400 and 405 are contract errors and end the program; a
 * network error or any other status is retried, since the env may
 * still be starting.
 */
async function register(port: number): Promise<void> {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(ENV_URL + "/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ port: port }),
        signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
      });
      if (res.status === 200 || res.status === 409) {
        return;
      }
      if (res.status === 400 || res.status === 405) {
        throw new Error("register answered HTTP " + res.status + ": " + (await res.text()));
      }
    } catch (err) {
      if (err instanceof Error && err.message.indexOf("register answered HTTP ") === 0) {
        throw err;
      }
    }
    await sleep(retryDelay(attempt));
    attempt += 1;
  }
}

/** Poll GET /done until it answers {"done":true}; never return sooner. */
async function waitForDone(): Promise<void> {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(ENV_URL + "/done", { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.ok) {
        const body = (await res.json()) as { done?: unknown };
        if (body.done === true) {
          return;
        }
      }
    } catch {
      // The env is silent for now, or the poll timed out: not done, so poll again.
    }
    await sleep(retryDelay(attempt));
    attempt += 1;
  }
}

function forwardSignal(signal: NodeJS.Signals): void {
  if (child && !child.killed) {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

process.on("SIGTERM", () => forwardSignal("SIGTERM"));
process.on("SIGINT", () => forwardSignal("SIGINT"));

/** Bind (via the child), register it, then wait for the env: the whole life of the process. */
async function main(): Promise<void> {
  const port = await startChild();
  process.stdout.write("[entry] forge-server listening on port " + port + "\n");

  await register(port);
  process.stdout.write("[entry] registered; waiting for the env to say done\n");

  await waitForDone();
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5_000);
      t.unref();
      child!.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  process.stdout.write("[entry] done\n");
}

try {
  await main();
  process.exit(0);
} catch (err) {
  process.stderr.write("[entry] " + (err instanceof Error ? err.message : String(err)) + "\n");
  if (child && !child.killed) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  process.exit(1);
}
