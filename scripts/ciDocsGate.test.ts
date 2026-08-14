import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dependsOnChanges,
  GATE_JOB,
  gateCondition,
  isGatedOnChanges,
  isSafeGateCondition,
  jobBlocks,
  onTriggerBlock,
  REQUIRED_JOBS,
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
  const condition = gateCondition(WORKFLOW);
  if (condition === "") {
    throw new Error("the changes job no longer has the `if` this test reads");
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

  it("falls open to running everything when the event is not a pull request", () => {
    const blocks = jobBlocks(WORKFLOW);
    const gate = blocks.get(GATE_JOB);
    if (gate === undefined) {
      throw new Error(`workflow has no "${GATE_JOB}" job`);
    }

    // Asserted on the shell text rather than executed: the direction matters more than the
    // mechanism here. A gate that fails closed turns an infrastructure blip into untested code
    // reaching main.
    expect(gate).toMatch(/github\.event_name.*!=.*pull_request/u);
    expect(gate).toMatch(/code=true/u);
  });
});
