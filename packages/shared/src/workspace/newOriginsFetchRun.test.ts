import type { ParsedReport } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";

import type { LoadedReportIdentity } from "../reportLoadDecision";
import type { NewOriginsDownloadResult } from "./newOriginsApi";
import { REFUSED_WITHOUT_A_SENTENCE } from "./newOriginsFetchView";
import { runNewOriginsFetch, type NewOriginsFetchEffects } from "./newOriginsFetchRun";

const report = (factionId: string | null, turnNumber: number | null, regions = 1): ParsedReport =>
  ({
    header: { factionId, factionName: "Merchant Guild", turnNumber },
    regions: Array.from({ length: regions }, () => ({ units: [] }))
  }) as unknown as ParsedReport;

const effectsFor = (
  overrides: Partial<NewOriginsFetchEffects> & { phases?: unknown[] } = {}
): NewOriginsFetchEffects & { phases: unknown[] } => {
  const phases: unknown[] = [];
  return {
    download: () => Promise.resolve<NewOriginsDownloadResult>({ kind: "ok", text: "a report" }),
    parse: () => Promise.resolve(report("27", 84)),
    current: (): LoadedReportIdentity | null => ({ factionId: "27", turnNumber: 83 }),
    onPhase: (phase) => phases.push(phase.kind),
    abandoned: () => false,
    phases,
    ...overrides
  };
};

describe("runNewOriginsFetch", () => {
  const credentials = { factionNumber: "27", password: "hunter2" };

  it("fetches, parses, and says what to do with what came back", async () => {
    const effects = effectsFor();
    const outcome = await runNewOriginsFetch(credentials, effects);
    expect(outcome).toEqual({
      kind: "arrived",
      arrival: { kind: "askNewer", currentTurn: 83, incomingTurn: 84 },
      report: report("27", 84),
      text: "a report"
    });
    expect(effects.phases).toEqual(["fetching"]);
  });

  it("says the site's own sentence when it was refused", async () => {
    const outcome = await runNewOriginsFetch(
      credentials,
      effectsFor({
        download: () => Promise.resolve({ kind: "refused", reason: "Faction password is incorrect." })
      })
    );
    expect(outcome).toEqual({ kind: "refused", message: "Faction password is incorrect." });
  });

  it("falls back to our own when the page carries none", async () => {
    const outcome = await runNewOriginsFetch(
      credentials,
      effectsFor({ download: () => Promise.resolve({ kind: "refused", reason: null }) })
    );
    expect(outcome).toEqual({ kind: "refused", message: REFUSED_WITHOUT_A_SENTENCE });
  });

  it("says unreachable when the transport could not get there", async () => {
    const outcome = await runNewOriginsFetch(
      credentials,
      effectsFor({ download: () => Promise.resolve({ kind: "unreachable" }) })
    );
    expect(outcome).toEqual({ kind: "unreachable" });
  });

  it("says unreadable for a body that is not a report", async () => {
    const outcome = await runNewOriginsFetch(
      credentials,
      effectsFor({
        parse: () => Promise.reject(new Error("could not parse factionId=27&password=hunter2"))
      })
    );
    expect(outcome).toEqual({ kind: "unreadable" });
    expect(JSON.stringify(outcome)).not.toContain("hunter2");
  });

  it("says unreadable for a report with nothing in it", async () => {
    const outcome = await runNewOriginsFetch(
      credentials,
      effectsFor({ parse: () => Promise.resolve(report("27", 84, 0)) })
    );
    expect(outcome).toEqual({ kind: "unreadable" });
  });

  it("stops at a boundary when the dialog was dismissed", async () => {
    const download = vi.fn();
    const outcome = await runNewOriginsFetch(
      credentials,
      effectsFor({ abandoned: () => true, download })
    );
    expect(outcome).toEqual({ kind: "abandoned" });
    expect(download).not.toHaveBeenCalled();
  });

  it("loads with no question into an empty game", async () => {
    const outcome = await runNewOriginsFetch(credentials, effectsFor({ current: () => null }));
    expect(outcome).toMatchObject({ kind: "arrived", arrival: { kind: "load" } });
  });
});
