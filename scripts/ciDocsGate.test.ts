import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dependsOnChanges,
  GATE_JOB,
  isGatedOnChanges,
  jobBlocks,
  matrixOf,
  onTriggerBlock,
  REQUIRED_JOBS,
  SMOKE_SKIP_JOB
} from "./ciDocsGate";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKFLOW = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");

describe("the docs-only fast path", () => {
  it("gates every required job on the docs gate's output", () => {
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
    // alone, those four stay Pending forever on a docs-only PR and block the merge, the opposite
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
