import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertShardsCover,
  dependsOnChanges,
  GATE_JOB,
  gateCondition,
  isGatedOnChanges,
  isGatedOnCodeAndNative,
  isSafeGateCondition,
  jobBlocks,
  NATIVE_JOB,
  nativeGateCondition,
  onTriggerBlock,
  REQUIRED_JOBS,
  SMOKE_CONTEXTS,
  smokeMatrixContexts,
  stepBlocks
} from "./ciDocsGate";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKFLOW = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");

/**
 * What the gate would decide for a pull request touching exactly these files: `true` when it runs
 * the full suite, `false` when it takes the fast path.
 *
 * The real condition from `ci.yml` is run in a real shell, so this asserts the decision CI actually
 * makes rather than a JavaScript restatement of it - but only after `isSafeGateCondition` has found
 * it to be nothing but greps.
 */
function runsEverything(files: string[]): boolean {
  return decide(gateCondition(WORKFLOW), files, "the changes job no longer has the `if` this test reads");
}

/**
 * What the gate would decide the `native` output to be for a pull request touching exactly these
 * files: `true` when the native (Linux Tauri) job runs, `false` when it is scoped out.
 */
function runsNative(files: string[]): boolean {
  return decide(
    nativeGateCondition(WORKFLOW),
    files,
    "the changes job no longer has the second (native) `if` this test reads"
  );
}

function decide(condition: string, files: string[], missingMessage: string): boolean {
  if (condition === "") {
    throw new Error(missingMessage);
  }
  if (!isSafeGateCondition(condition)) {
    throw new Error(`refusing to execute a gate condition outside the allowed shape: ${condition}`);
  }

  const script = `FILES=$(cat); if ${condition}; then echo true; else echo false; fi`;
  const decision = execFileSync("bash", ["-c", script], {
    input: files.join("\n"),
    encoding: "utf8"
  }).trim();

  return decision === "true";
}

/** The gate job's text. */
function gate(): string {
  const block = jobBlocks(WORKFLOW).get(GATE_JOB);
  if (block === undefined) {
    throw new Error(`workflow has no "${GATE_JOB}" job`);
  }
  return block;
}

/** The lines jq prints for a filter over a JSON input, run without a shell. */
function jq(filter: string, input: unknown): string[] {
  const output = execFileSync("jq", ["-r", filter], {
    input: JSON.stringify(input),
    encoding: "utf8"
  });
  return output.split("\n").filter((line) => line !== "");
}

describe("the gate condition's safety check", () => {
  // The tests below run the gate's own shell, which is the only way to assert what CI will decide
  // rather than a JavaScript restatement of it. That means `ci.yml` decides what `test:tooling`
  // executes, so the condition is checked against a shape first: `[ -z "$FILES" ]`, `echo "$FILES"`,
  // `grep` with flags and a single-quoted pattern, joined by `||`. Anything else is refused unrun.
  it("accepts the shapes the gate is allowed to have", () => {
    expect(isSafeGateCondition(`[ -z "$FILES" ] || echo "$FILES" | grep -qv '^docs/'`)).toBe(true);
    expect(
      isSafeGateCondition(
        `[ -z "$FILES" ] || echo "$FILES" | grep -q '^\\.github/workflows/' || echo "$FILES" | grep -qvE '^(docs|\\.claude|\\.github)/'`
      )
    ).toBe(true);
  });

  it("refuses anything that could run more than a grep", () => {
    for (const hostile of [
      `[ -z "$FILES" ] || rm -rf /`,
      `[ -z "$FILES" ] || echo "$FILES" | grep -qv '^docs/'; curl evil.example`,
      `[ -z "$FILES" ] || echo "$FILES" | grep -qv "$(whoami)"`,
      "[ -z \"$FILES\" ] || echo \"$FILES\" | grep -qv `id`",
      `[ -z "$FILES" ] || echo "$FILES" | grep -qv '^docs/' > /tmp/pwned`
    ]) {
      expect(isSafeGateCondition(hostile), `must refuse: ${hostile}`).toBe(false);
    }
  });

  it("refuses a condition it could not find at all, rather than running the empty string", () => {
    expect(isSafeGateCondition("")).toBe(false);
  });
});

describe("the prose-only fast path", () => {
  it("gates every required job on the gate's output, except smoke - gated on its steps instead", () => {
    const blocks = jobBlocks(WORKFLOW);

    for (const job of REQUIRED_JOBS) {
      const block = blocks.get(job);
      if (block === undefined) {
        throw new Error(`workflow no longer has a job named "${job}"`);
      }

      expect(dependsOnChanges(block), `${job} must depend on ${GATE_JOB}`).toBe(true);

      if (job === "smoke") {
        // smoke always runs and always expands its matrix - a job skipped by a job-level `if:`
        // never expands its matrix, which is what forced the raw-named skip twin this bead
        // removes. Gating happens per-step instead; see the dedicated smoke tests below.
        expect(isGatedOnChanges(block), "smoke must not be job-level gated on changes").toBe(
          false
        );
        continue;
      }

      if (job === NATIVE_JOB) {
        // native is scoped on a second output too - see "the native job's path scope" below - so
        // its `if:` is not the single-output shape every other required job carries.
        expect(
          isGatedOnCodeAndNative(block),
          `${job} must be conditioned on both ${GATE_JOB}'s code and native outputs`
        ).toBe(true);
        continue;
      }

      expect(isGatedOnChanges(block), `${job} must be conditioned on ${GATE_JOB}'s output`).toBe(
        true
      );
    }
  });

  it("does not gate the gate job on itself, and keeps it out of the required set", () => {
    const blocks = jobBlocks(WORKFLOW);
    const gate = blocks.get(GATE_JOB);
    if (gate === undefined) {
      throw new Error(`workflow has no "${GATE_JOB}" job`);
    }

    expect(isGatedOnChanges(gate)).toBe(false);
    expect(REQUIRED_JOBS).not.toContain(GATE_JOB);
  });

  it("carries no path filter on the pull_request trigger", () => {
    // A workflow skipped by `paths`/`paths-ignore` never reports its checks at all - Pending
    // forever, not skipped - and blocks the merge. This is the trap the design exists to avoid;
    // pinned here so a later "simplification" fails this test instead of merging silently broken.
    const trigger = onTriggerBlock(WORKFLOW);

    expect(trigger).not.toMatch(/paths(-ignore)?:/u);
  });

  it("has no smoke-skip twin, and no job block name: carries a raw matrix expression", () => {
    // A job skipped by a job-level `if:` never expands its matrix - confirmed on a throwaway
    // trial PR - which is why `smoke-skip` used to exist: a second job, same matrix, opposite
    // condition, reporting the four required contexts by an explicit `name:` when the real job
    // was skipped. On a CODE pr the twin is what's skipped instead, so it never expands either,
    // and its `${{ matrix.* }}` `name:` posted uninterpolated - the bug this bead fixes. The twin
    // is gone; `smoke` itself always runs and always expands, on every PR.
    const blocks = jobBlocks(WORKFLOW);
    expect(blocks.has("smoke-skip")).toBe(false);

    for (const [id, block] of blocks) {
      const nameLine = block.match(/^ {4}name:.*$/mu);
      if (nameLine !== null) {
        expect(nameLine[0], `job "${id}" name: must not carry a raw matrix expression`).not.toMatch(
          /\$\{\{/u
        );
      }
    }
  });

  it("keeps smoke running, and its matrix expanding, whether or not wasm ran", () => {
    // Default needs-semantics would skip `smoke` when its `wasm` dependency was skipped on a
    // prose-only PR - which is exactly the four-Pending-forever failure mode the old twin
    // existed to avoid. `!cancelled()` is what keeps the job (and therefore its matrix) running
    // in that case, while still dying on an actual cancellation.
    const blocks = jobBlocks(WORKFLOW);
    const smoke = blocks.get("smoke");
    if (smoke === undefined) {
      throw new Error('workflow has no "smoke" job');
    }

    expect(dependsOnChanges(smoke)).toBe(true);
    expect(smoke).toMatch(/^ {4}needs:\s*\[changes,\s*wasm\]\s*$/mu);
    expect(smoke).toMatch(/^ {4}if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}\s*$/mu);
  });

  it("gates every smoke step on the changes output, except the failure() upload", () => {
    // The job itself always runs now, so each step is what stands in for the old job-level gate.
    // `Download the WebAssembly core` additionally needs wasm to have actually succeeded - on a
    // code PR whose wasm build failed, smoke must not try to download an artifact that was never
    // produced. `Upload the report of a failed run` keeps its own failure() condition unchanged:
    // nothing fails when every other step was skipped.
    const blocks = jobBlocks(WORKFLOW);
    const smoke = blocks.get("smoke");
    if (smoke === undefined) {
      throw new Error('workflow has no "smoke" job');
    }

    const steps = stepBlocks(smoke);
    expect(steps.size).toBeGreaterThan(0);

    for (const [name, step] of steps) {
      if (name === "Upload the report of a failed run") {
        expect(step).toMatch(/^ {8}if:\s*failure\(\)\s*$/mu);
        continue;
      }

      const ifLine = step.match(/^ {8}if:.*$/mu);
      expect(ifLine, `step "${name}" must carry an if: gating it on changes`).not.toBeNull();
      expect(ifLine![0]).toContain("needs.changes.outputs.code == 'true'");

      if (name === "Download the WebAssembly core") {
        expect(ifLine![0]).toContain("needs.wasm.result == 'success'");
      }
    }
  });

  it("takes the fast path for a diff that is only prose", () => {
    // `.claude/` is the fleet's own documentation - agent roles, skills, settings. Nothing in CI
    // reads it, so a change there cannot affect a single check, and running the ten-minute suite
    // over one is ten minutes of nothing.
    expect(runsEverything(["docs/ui/ah-vp3.2.html"])).toBe(false);
    expect(runsEverything([".claude/agents/orchestrator.md"])).toBe(false);
    expect(runsEverything([".github/ISSUE_TEMPLATE/bug.md"])).toBe(false);
    expect(runsEverything([".github/dependabot.yml"])).toBe(false);
    expect(runsEverything([".claude/skills/plan-bead/SKILL.md", "docs/implementation-plan.md"])).toBe(
      false
    );
  });

  it("takes the fast path for root prose files, exact-matched", () => {
    // README.md and the CLAUDE.md symlink path are prose, but they live at the repo root rather
    // than under an exempt tree - PR #160's whole-suite-twice cost also applies here, since a PR
    // that only retargets the CLAUDE.md symlink lists "CLAUDE.md" itself, not its target.
    expect(runsEverything(["README.md"])).toBe(false);
    expect(runsEverything(["CLAUDE.md"])).toBe(false);
  });

  it("takes the fast path for the .cerebro/ declarations no test reads (ah-slxi7)", () => {
    // Fleet housekeeping - the roster, the agents' models, the QA lists, the traps - is read by the
    // fleet's own scripts and by people, never by anything CI builds, tests or runs. Each such
    // commit used to cost about 45 runner-minutes for checks it could not affect.
    expect(runsEverything([".cerebro/roster.conf"])).toBe(false);
    expect(runsEverything([".cerebro/agents.conf"])).toBe(false);
    expect(runsEverything([".cerebro/requirements.md"])).toBe(false);
    expect(runsEverything([".cerebro/test-architecture.md"])).toBe(false);
    expect(runsEverything([".cerebro/traps.md"])).toBe(false);
    expect(runsEverything([".cerebro/requirements.md", "docs/implementation-plan.md"])).toBe(false);
    expect(runsNative([".cerebro/roster.conf"])).toBe(false);
  });

  it("runs everything for the .cerebro/ paths a test or the gate reads, and any it does not name", () => {
    // project.conf is read by scripts/runGate.ts and scripts/verificationSkill.test.ts; the
    // cerebro submodule (listed as its gitlink path) carries the gate and preflight scripts. A new
    // file under .cerebro/ is not exempt until somebody names it, so the list fails safe.
    expect(runsEverything([".cerebro/project.conf"])).toBe(true);
    expect(runsEverything([".cerebro/cerebro"])).toBe(true);
    expect(runsEverything([".cerebro/other.md"])).toBe(true);
    expect(runsEverything([".cerebro/roster.conf", "scripts/release.ts"])).toBe(true);

    // Exact-matched per file: not a prefix, not a suffix, not nested.
    expect(runsEverything([".cerebro/roster.conf.bak"])).toBe(true);
    expect(runsEverything(["x.cerebro/roster.conf"])).toBe(true);
    expect(runsEverything([".cerebro/sub/roster.conf"])).toBe(true);
    expect(runsEverything([".cerebro/trapsxmd"])).toBe(true);
  });

  it("runs everything for a diff mixing root prose with a source file", () => {
    expect(runsEverything(["README.md", "scripts/release.ts"])).toBe(true);
  });

  it("runs everything for a workflow change, so the gate cannot exempt itself", () => {
    // `.github/` is exempt but `.github/workflows/` is not, and this is why: the tests in this file
    // are what stop a broken gate reaching main, and they run inside the `checks` job. Exempt the
    // workflows too and a PR editing the gate would skip the only thing that checks the gate -
    // green by virtue of having disabled its own examiner.
    expect(runsEverything([".github/workflows/ci.yml"])).toBe(true);
    expect(runsEverything([".github/workflows/release.yml"])).toBe(true);
    expect(runsEverything([".github/ISSUE_TEMPLATE/bug.md", ".github/workflows/deploy.yml"])).toBe(
      true
    );
  });

  it("runs everything for a diff that touches code, however much prose comes with it", () => {
    expect(runsEverything(["packages/browser-core/src/index.ts"])).toBe(true);
    expect(runsEverything([".claude/agents/orchestrator.md", "scripts/releaseSupport.ts"])).toBe(
      true
    );
  });

  it("anchors on the directory, so a path that merely starts with those letters is not prose", () => {
    // `^docs/` must not be `^docs`, or `docsomething.ts` skips the suite. Same for `.claude`, where
    // the leading dot must be escaped or it matches any first character - `xclaude/`, `1claude/`.
    expect(runsEverything(["docsite/build.ts"])).toBe(true);
    expect(runsEverything(["xclaude/thing.ts"])).toBe(true);
    expect(runsEverything(["xgithub/thing.ts"])).toBe(true);
    expect(runsEverything(["packages/docs/src/index.ts"])).toBe(true);

    // The root-file entries are exact matches, not prefixes: README.mdx and README.md.ts are not
    // README.md, and must not skip the suite either.
    expect(runsEverything(["README.mdx"])).toBe(true);
    expect(runsEverything(["README.md.ts"])).toBe(true);
  });

  it("takes the fast path for a .claude/settings.json-only diff, per PR #172's decision", () => {
    // PR #172 deliberately exempted `.claude/` wholesale rather than only `.claude/**/*.md`: the
    // gate's criterion is reachability by CI, not "is it prose", and nothing CI builds, tests or
    // runs reads anything under `.claude/`. Pinned here so a later "tidy-up" cannot narrow it
    // silently.
    expect(runsEverything([".claude/settings.json"])).toBe(false);
  });

  it("judges a push from the last successful main run, not its parent, and fails open (ah-slxi7)", () => {
    const block = gate();

    // A concurrency group keeps one pending run, so a newer push cancels an older pending one. A
    // docs-only push diffed from its own parent would then skip a code commit whose run was
    // cancelled, and that code would never be tested on main. Diffing from the head of the last
    // successful run keeps every commit since then inside the diff. Raised by review on PR #1869.
    expect(block).not.toMatch(/github\.event\.before/u);
    expect(block).toMatch(/actions\/workflows\/ci\.yml\/runs\?branch=main&event=push&status=success&per_page=1/u);
    expect(block).toMatch(/compare\/\$\{BASE\}\.\.\.\$\{AFTER\}/u);

    // Any other event still runs everything, before any listing is attempted.
    expect(block).toMatch(/github\.event_name.*!=.*push/u);
    expect(block).toMatch(/code=true/u);
    expect(block).toMatch(/native=true/u);
  });

  it("needs read access to Actions runs for the push gate's lookup", () => {
    expect(WORKFLOW).toMatch(/^permissions:\n(?: {2}\S.*\n)*? {2}actions: read$/mu);
  });

  it("lists a push's files only from a compare that is plainly ahead and not truncated", () => {
    // The real jq filters from ci.yml, run with jq against fixtures - jq is given the filter as an
    // argument, never through a shell. An empty listing is what makes the gate run everything.
    const filters = [...gate().matchAll(/--jq '([^']*)'/gu)].map((match) => match[1]);
    const lastSuccess = filters.find((filter) => filter.includes("workflow_runs"));
    const compare = filters.find((filter) => filter.includes(".status"));
    if (lastSuccess === undefined || compare === undefined) {
      throw new Error("the push branch no longer has the two jq filters this test runs");
    }

    const files = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ filename: `.cerebro/f${index}` }));

    expect(jq(compare, { status: "ahead", files: [{ filename: ".cerebro/roster.conf" }] })).toEqual([
      ".cerebro/roster.conf"
    ]);
    expect(jq(compare, { status: "ahead", files: files(299) })).toHaveLength(299);
    expect(jq(compare, { status: "ahead", files: files(300) })).toEqual([]);
    expect(jq(compare, { status: "ahead", files: [] })).toEqual([]);
    expect(jq(compare, { status: "behind", files: files(1) })).toEqual([]);
    expect(jq(compare, { status: "diverged", files: files(1) })).toEqual([]);
    expect(jq(compare, { status: "identical", files: [] })).toEqual([]);

    expect(jq(lastSuccess, { workflow_runs: [{ head_sha: "abc123" }] })).toEqual(["abc123"]);
    expect(jq(lastSuccess, { workflow_runs: [] })).toEqual([]);
  });
});

describe("the native job's path scope", () => {
  // native (the Linux Tauri job) is the largest hang surface in the workflow and the slowest to
  // run, and most diffs touch nothing it exercises: the native suite tests the IPC binding
  // (tests/native/binding.spec.ts), not the shared UI. Scoped separately from `code` so a
  // shared-UI-only PR still runs everything else but skips this one job.
  it("runs for a diff touching the Rust core, its Tauri wrappers, or the desktop shell", () => {
    expect(runsNative(["crates/atlantis-core/src/lib.rs"])).toBe(true);
    expect(runsNative(["apps/desktop/src-tauri/src/main.rs"])).toBe(true);
    expect(runsNative(["packages/core-client/src/index.ts"])).toBe(true);
  });

  it("runs for a diff touching the native suite itself, or what configures it", () => {
    expect(runsNative(["tests/native/binding.spec.ts"])).toBe(true);
    expect(runsNative(["wdio.conf.ts"])).toBe(true);
  });

  it("runs for a diff touching a workflow, or a manifest/lockfile that changes what native installs", () => {
    expect(runsNative([".github/workflows/ci.yml"])).toBe(true);
    expect(runsNative(["package.json"])).toBe(true);
    expect(runsNative(["pnpm-lock.yaml"])).toBe(true);
    expect(runsNative(["Cargo.toml"])).toBe(true);
    expect(runsNative(["Cargo.lock"])).toBe(true);
  });

  it("skips for a diff confined to shared UI code", () => {
    expect(runsNative(["packages/shared/src/workspace/MapCanvas.tsx"])).toBe(false);
    expect(runsNative(["apps/web/src/main.tsx"])).toBe(false);
  });

  it("anchors on the directory or the whole filename, not merely a prefix", () => {
    expect(runsNative(["crateswithsomethingelse/foo.rs"])).toBe(false);
    expect(runsNative(["apps/desktopish/foo.ts"])).toBe(false);
    expect(runsNative(["not-wdio.conf.ts"])).toBe(false);
  });

  it("fails open: an empty file list runs the native job too", () => {
    expect(runsNative([])).toBe(true);
  });
});

describe("the smoke matrix", () => {
  it("reports exactly the contexts the main ruleset requires", () => {
    // The ruleset names each smoke context, so a matrix change that does not change
    // SMOKE_CONTEXTS - and, with it, the ruleset - leaves a required check that never reports
    // and blocks every merge (ah-5qndx).
    const smoke = jobBlocks(WORKFLOW).get("smoke");
    if (smoke === undefined) {
      throw new Error('workflow has no "smoke" job');
    }

    expect(smokeMatrixContexts(smoke)).toEqual([...SMOKE_CONTEXTS]);
  });

  it("splits web over four shards and walks desktop-shell in one", () => {
    // desktop-shell walks only its tagged tests since ah-r7kot, so a second shard of it is a
    // runner idle for most of the run while web is the critical path (ah-5qndx).
    expect(SMOKE_CONTEXTS).toEqual([
      "smoke (web, 1, 4)",
      "smoke (web, 2, 4)",
      "smoke (web, 3, 4)",
      "smoke (web, 4, 4)",
      "smoke (desktop-shell, 1, 1)"
    ]);
  });

  it("covers each project's shards 1..shardTotal exactly once", () => {
    expect(() => assertShardsCover(SMOKE_CONTEXTS)).not.toThrow();
    expect(() => assertShardsCover(["smoke (web, 1, 3)", "smoke (web, 3, 3)"])).toThrow(/web/u);
    expect(() => assertShardsCover(["smoke (web, 1, 2)", "smoke (web, 1, 2)"])).toThrow(/web/u);
    expect(() => assertShardsCover(["smoke (web, 1, 2)", "smoke (web, 2, 3)"])).toThrow(/web/u);
  });
});
