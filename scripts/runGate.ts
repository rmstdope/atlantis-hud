/**
 * Runs every leg of the fast gate, and reports on every one of them.
 *
 * `lint && typecheck && test && check:generated && cargo fmt --check && cargo clippy` used to be an
 * `&&` chain, so anything failing early meant fmt and clippy never ran - and the disk-space
 * preflight, enforced as a vitest case inside `test`, is an *environmental* refusal that skipped
 * them every time the machine was full (ah-tn2z). ah-j0e is the defect that reached CI that way,
 * and two further beads opened PRs on a knowingly red local gate because of it.
 *
 * Sequential rather than parallel, so cargo and vitest do not contend for the machine and the
 * output stays readable; exhaustive rather than short-circuiting, so a broken leg can no longer
 * hide whether the others ran - the same trade `runSuites.ts` makes, for the same reason. The
 * accepted cost is a slower local run when something is already broken.
 *
 * Exhaustive is not lenient: the exit code is still non-zero when any leg failed.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type LegResult, summarizeLegs } from "./summarizeLegs";

type Leg = { name: string; command: string; args: string[] };

/**
 * `test` stays one leg on purpose: `runSuites.ts` already reports inside it, and flattening its
 * suites in here would leave two reporters to disagree with each other.
 */
const LEGS: readonly Leg[] = [
  { name: "lint", command: "pnpm", args: ["run", "lint"] },
  { name: "typecheck", command: "pnpm", args: ["run", "typecheck"] },
  { name: "test", command: "pnpm", args: ["run", "test"] },
  { name: "generated", command: "pnpm", args: ["run", "check:generated"] },
  { name: "fmt", command: "cargo", args: ["fmt", "--check"] },
  {
    name: "clippy",
    command: "cargo",
    args: ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"]
  }
];

/** What to print and exit with, once every leg has already run. Pure, so the cases are plain. */
export function summarizeGate(results: readonly LegResult[]): { exitCode: number; text: string } {
  return summarizeLegs("gate", "legs", results);
}

/** Runs one leg with its output going straight to the terminal, and says whether it passed. */
function runLeg(leg: Leg): LegResult {
  const run = spawnSync(leg.command, leg.args, { stdio: "inherit" });

  // spawnSync does not throw on its own failure - a command that could not even start (ENOENT on
  // its PATH) or one killed by a signal both leave `status` null, which reads identically to a leg
  // that ran and failed unless the reason is said out loud.
  if (run.error) {
    process.stderr.write(`runGate: ${leg.name} could not start: ${run.error.message}\n`);
  } else if (run.signal) {
    process.stderr.write(`runGate: ${leg.name} was killed by signal ${run.signal}\n`);
  }

  return { name: leg.name, passed: run.status === 0 };
}

/**
 * The disk, reported and never fatal.
 *
 * A full disk is a fact about the machine, not a verdict on the code, and the whole of ah-tn2z is
 * that conflating them skipped fmt and clippy exactly when somebody was most likely to push
 * anyway. It runs first so it is read before the output that matters, and its exit code is
 * deliberately ignored - the cargo legs may well fail on a genuinely full disk, which is honest;
 * what must not happen is their being skipped in silence.
 */
function reportDisk(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const run = spawnSync(resolve(here, "..", "node_modules", ".bin", "tsx"), [resolve(here, "diskPreflight.ts")], {
    encoding: "utf8"
  });

  // Said out loud for the same reason runLeg says it: a preflight that could not start (ENOENT on
  // tsx) or was killed leaves empty stdout, which would otherwise be reported as the preflight
  // having nothing to say - hiding the real failure behind a sentence about the disk.
  if (run.error) {
    process.stderr.write(`runGate: the disk preflight could not start: ${run.error.message}\n`);
  } else if (run.signal) {
    process.stderr.write(`runGate: the disk preflight was killed by signal ${run.signal}\n`);
  }

  const said = (run.stdout ?? "").trim();
  process.stdout.write(said === "" ? "disk: the preflight said nothing.\n" : `${said}\n`);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  reportDisk();
  const results = LEGS.map(runLeg);
  const { exitCode, text } = summarizeGate(results);
  process.stdout.write(`${text}\n`);
  process.exit(exitCode);
}
