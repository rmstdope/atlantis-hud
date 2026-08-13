import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dependsOnChanges,
  GATE_JOB,
  isGatedOnChanges,
  jobBlocks,
  onTriggerBlock,
  REQUIRED_JOBS
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
