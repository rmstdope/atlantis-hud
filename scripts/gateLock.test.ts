import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCK_TTL_MS, describeHolder, parseHolder, shouldSteal } from "./gateLock";

/**
 * One gate at a time, across every agent on this machine.
 *
 * `playwright.config.ts` carries the measurement this exists for: one worker already drives this
 * machine to about 280% CPU, and two workers broke both interactivity guards, "because a test that
 * measures how long the main thread is blocked measures contention instead". Several agents each
 * running the browser suites reproduces exactly that, off-config - and the likely outcome is a
 * flaky red that the agent then re-runs for free as "infrastructure", so either the loop burns
 * wall-clock or a retry-green means it merged on a measurement it never satisfied.
 *
 * So the runs queue. What must never happen is the opposite failure: a crashed holder locking
 * everybody out forever, which would be a worse bug than the contention.
 */

describe("shouldSteal", () => {
  const now = 1_000_000;
  const living = () => true;
  const departed = () => false;

  it("waits for a holder that is alive and recent", () => {
    expect(shouldSteal({ pid: 42, since: now - 1_000, what: "smoke" }, living, now)).toBe(false);
  });

  it("takes the lock from a holder that is no longer running", () => {
    // The crash case, and the reason this is not a bare lock file: an agent that dies mid-gate must
    // not stop every other agent on the machine.
    expect(shouldSteal({ pid: 42, since: now - 1_000, what: "smoke" }, departed, now)).toBe(true);
  });

  it("takes the lock from a holder that has held it implausibly long", () => {
    // A backstop for pid reuse: the pid answers, but it is somebody else's process now. The whole
    // gate is minutes, so an hour is not a slow run, it is a lie.
    expect(shouldSteal({ pid: 42, since: now - LOCK_TTL_MS - 1, what: "smoke" }, living, now)).toBe(
      true
    );
  });

  it("takes the lock when the file says nothing it can read", () => {
    expect(shouldSteal(null, living, now)).toBe(true);
  });
});

describe("parseHolder", () => {
  it("reads back what the holder wrote", () => {
    const held = { pid: 7, since: 123, what: "pnpm run test:pwa" };
    expect(parseHolder(JSON.stringify(held))).toEqual(held);
  });

  it("answers nothing for a truncated or corrupt file rather than throwing", () => {
    // A holder killed mid-write leaves a partial file, and a gate that crashes on it would be one
    // more way to block a machine.
    expect(parseHolder('{"pid": 7, "sin')).toBeNull();
    expect(parseHolder("")).toBeNull();
    expect(parseHolder('{"pid": "seven"}')).toBeNull();
  });
});

describe("describeHolder", () => {
  it("says who is holding it and for how long, so a wait is never a mystery", () => {
    const said = describeHolder({ pid: 4242, since: 0, what: "pnpm run test:smoke" }, 65_000);
    expect(said).toContain("4242");
    expect(said).toContain("pnpm run test:smoke");
    expect(said).toMatch(/\b1m|65s|65 s/u);
  });
});

/**
 * The lock as two processes actually meet it.
 *
 * The unit tests above say what the decision is; only this says that two runs do not overlap, which
 * is the entire point of the thing.
 */
describe("the gate lock, between processes", () => {
  it("runs two commands one after the other rather than at once", () => {
    const scratch = mkdtempSync(join(tmpdir(), "gate-lock-"));
    const lock = join(scratch, "gate.lock");
    const log = join(scratch, "log");
    writeFileSync(log, "");

    const runners = ["a", "b"].map((name) =>
      spawn(
        TSX,
        [
          RUNNER,
          "node",
          "-e",
          `const {appendFileSync}=require("node:fs");appendFileSync(${JSON.stringify(log)},"${name}+\\n");` +
            `const t=Date.now();while(Date.now()-t<300);` +
            `appendFileSync(${JSON.stringify(log)},"${name}-\\n");`
        ],
        { env: { ...process.env, ATLANTIS_GATE_LOCK: lock }, stdio: "ignore" }
      )
    );

    return Promise.all(
      runners.map(
        (child) => new Promise<number>((done) => child.on("exit", (code) => done(code ?? 1)))
      )
    ).then((codes) => {
      expect(codes).toEqual([0, 0]);

      // Whoever went first, their close must come before the other's open: "a+ a- b+ b-", never
      // "a+ b+ ...". Interleaving is what contention looks like.
      const order = readFileSync(log, "utf8").trim().split("\n");
      expect(order).toHaveLength(4);
      expect(order[0].replace("+", "-")).toBe(order[1]);
      expect(order[2].replace("+", "-")).toBe(order[3]);
    });
  }, 30_000);

  it("drops the separator pnpm forwards, which downstream reads as a filter", () => {
    // `pnpm run test:smoke -- --project=web` forwards the `--` itself. Playwright takes a bare `--`
    // as a positional test filter, matches nothing, and sits there having already built and served
    // the app - a hang that looks like a broken suite. Cost 600 seconds to find once.
    const output = execFileSync(
      TSX,
      [RUNNER, "--", "node", "-e", "console.log(process.argv.slice(1).join('|'))", "--", "kept"],
      { env: { ...process.env, CI: "1" }, encoding: "utf8", timeout: 20_000 }
    );

    expect(output.trim()).toBe("kept");
  }, 30_000);

  it("does not lock at all under CI, where each runner has a machine to itself", () => {
    const scratch = mkdtempSync(join(tmpdir(), "gate-lock-ci-"));
    const lock = join(scratch, "gate.lock");
    // A lock file left by somebody else. Under CI it must be ignored rather than waited on.
    writeFileSync(lock, JSON.stringify({ pid: process.pid, since: Date.now(), what: "someone" }));

    const output = execFileSync(TSX, [RUNNER, "node", "-e", "console.log('ran')"], {
      env: { ...process.env, ATLANTIS_GATE_LOCK: lock, CI: "1" },
      encoding: "utf8",
      timeout: 20_000
    });

    expect(output).toContain("ran");
  }, 30_000);
});

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "withGateLock.ts");
const TSX = join(HERE, "..", "node_modules", ".bin", "tsx");
