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
  matrixOf,
  onTriggerBlock,
  REQUIRED_JOBS,
  SMOKE_SKIP_JOB
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
  it("gates every required job on the gate's output", () => {
    const blocks = jobBlocks(WORKFLOW);

    for (const job of REQUIRED_JOBS) {
      const block = blocks.get(job);
      if (block === undefined) {
        throw new Error(`workflow no longer has a job named "${job}"`);
      }

      expect(dependsOnChanges(block), `${job} must depend on ${GATE_JOB}`).toBe(true);
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

  it("gives the smoke matrix a skip twin, since a job skipped by if: never expands its matrix", () => {
    // Confirmed on a throwaway trial PR: a job-level `if: false` skips the whole `smoke` job
    // before its matrix is expanded, producing one check run named "smoke" - not the four
    // per-combination contexts (`smoke (web, 1, 2)`, etc.) the ruleset actually requires. Left
    // alone, those four stay Pending forever on a prose-only PR and block the merge, the opposite
    // of the goal. The fallback is a second job with the same matrix, gated the other way, that
    // reports the same check names by explicit `name:` rather than by job id.
    const blocks = jobBlocks(WORKFLOW);
    const twin = blocks.get(SMOKE_SKIP_JOB);
    if (twin === undefined) {
      throw new Error(`workflow has no "${SMOKE_SKIP_JOB}" job`);
    }

    expect(dependsOnChanges(twin)).toBe(true);
    expect(twin).toMatch(/^ {4}if:\s*needs\.changes\.outputs\.code\s*!=\s*'true'\s*$/mu);

    const smoke = blocks.get("smoke");
    if (smoke === undefined) {
      throw new Error('workflow has no "smoke" job');
    }
    expect(matrixOf(twin)).toEqual(matrixOf(smoke));
    expect(twin).toContain(
      "name: smoke (${{ matrix.project }}, ${{ matrix.shardIndex }}, ${{ matrix.shardTotal }})"
    );
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
    expect(runsEverything([".claude/agents/orchestrator.md", "scripts/runImplementer.ts"])).toBe(
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
