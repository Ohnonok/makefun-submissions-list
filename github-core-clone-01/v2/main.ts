// Entry process: join the trial env, serve, and leave when told.
//
// The env (MAKEFUN_ENV_URL, http://store:8080 inside a trial container)
// owns the trial. This process only binds a port, hands it over, and
// polls until the env reports the trial finished. Nothing here is
// scored by itself; the suite scores the server that app.ts builds.
//
// Sequence:
//   1. MAKEFUN_ENV_URL must name the env origin. Absent, exit 1 at once.
//   2. Listen on port 0 and let the kernel choose. Port 8080 belongs to
//      the env and is never bound by this process.
//   3. POST $MAKEFUN_ENV_URL/register {"port": N}. The env takes the
//      request's source address plus N as the base URL. The first
//      register wins; a 409 says another entry already registered, and
//      this process waits like any other.
//   4. GET $MAKEFUN_ENV_URL/done until the body reads {"done": true}.
//      The env answers immediately ({"done": false} while the suite
//      runs), so this is a poll with backoff, never a held request.
//   5. Close the server, exit 0. The harness stops the env, which
//      writes the export the scorer reads.
//
// main.ts pulls in its own server and nothing else: no package, no
// Node built-in, no model call.

import { createApp } from "./app.ts";

const ENV_URL = (process.env.MAKEFUN_ENV_URL ?? "").replace(/\/+$/, "");
if (ENV_URL === "") {
  process.stderr.write("[entry] MAKEFUN_ENV_URL is not set: there is no env to register with\n");
  process.exit(1);
}

/** Longest a single register or done request may run before it is dropped and retried. */
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Longest a single REGISTER request may run. The env gives the entry 20 s
 * (BOOT_BUDGET_MS) to register; a hung register fetch — a DNS/connect
 * blackhole to the env — must never eat that whole budget inside one
 * attempt, or the entry stays alive, never registers, and scores 0
 * (sealed 2026-11-15: build 88.6 s over 3 instances, working 0).
 * 2 s per attempt with the backoff below still leaves ~8 tries inside
 * the budget, so a path that recovers in time is caught.
 */
const REGISTER_TIMEOUT_MS = 2_000;
/** First pause between retries, and the ceiling it grows to. */
const RETRY_INITIAL_MS = 250;
const RETRY_MAX_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pause after `attempt` failed requests: exponential from RETRY_INITIAL_MS, capped. */
function retryDelay(attempt: number): number {
  const doubled = RETRY_INITIAL_MS * 2 ** Math.min(attempt, 8);
  return doubled < RETRY_MAX_MS ? doubled : RETRY_MAX_MS;
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

/** Bind the port, register it, then wait for the env: the whole life of the process. */
async function main(): Promise<void> {
  const server = createApp();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the server did not bind an ephemeral TCP port");
  }
  process.stdout.write("[entry] listening on port " + address.port + "\n");

  await register(address.port);
  process.stdout.write("[entry] registered; waiting for the env to say done\n");

  await waitForDone();
  server.close();
  process.stdout.write("[entry] done\n");
}

try {
  await main();
  process.exit(0);
} catch (err) {
  process.stderr.write("[entry] " + (err instanceof Error ? err.message : String(err)) + "\n");
  process.exit(1);
}
