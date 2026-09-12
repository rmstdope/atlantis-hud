/**
 * The comment policy, carried end to end.
 *
 * `AppShell` derives it once from the open game's ruleset id and hands it to every operation that
 * locates, classifies, rewrites or exports order text. These are those operations, asked the same
 * Trident document the shell would hand them, with the New Origins control beside each - so a seam
 * that stops passing the policy fails here rather than silently reading the wrong world.
 */
import { describe, expect, it } from "vitest";
import { diagnosticTargets } from "./diagnosticNav";
import { describeOrdersImport, unitIdForDiagnostic } from "./ordersImport";
import {
  longOrderOf,
  readUnitOrders,
  reportedLongOrders,
  stripUnitComments,
  writeRouteOrder,
  writeUnitOrders
} from "./ordersDocument";
import { studyWritePlan } from "./studyOrdersWrite";
import { diffOrders } from "./turnDiff";
import { ordersExportText } from "./workspace/ordersExport";
import { formedSelectionFor } from "./workspace/ordersLock";
import { orderCommentSyntaxFor } from "./rulesets";

const DOCUMENT = [
  "#atlantis 1",
  ";*** plain (1,1) in Nowhere ***",
  "unit 42;the miner",
  "WORK;paying the guard",
  "FORM 1;the scout",
  "MOVE N;north",
  "END;done",
  "",
  "#end;that is all"
].join("\n");

const TRIDENT = orderCommentSyntaxFor("newage-trident");
const ORIGINS = orderCommentSyntaxFor("neworigins");

describe("the comment policy reaches every reader of the document", () => {
  it("is what the shell derives from the open game", () => {
    expect(TRIDENT).toBe("trident");
    expect(ORIGINS).toBe("origins");
  });

  it("reads and rewrites the selected unit's block", () => {
    expect(readUnitOrders(DOCUMENT, "42", undefined, TRIDENT)).toContain("WORK;paying the guard");
    expect(readUnitOrders(DOCUMENT, "42", undefined, ORIGINS)).toBeNull();

    const written = writeUnitOrders(DOCUMENT, "42", "TAX", undefined, TRIDENT);
    expect(written).toContain("unit 42;the miner\nTAX\n");
    expect(written).toContain("#atlantis 1");
  });

  it("resolves a formed selection through a commented FORM line", () => {
    expect(formedSelectionFor(DOCUMENT, "new-1", new Set(["42"]), TRIDENT)).toEqual({
      alias: "1",
      formedBy: "42"
    });
    expect(formedSelectionFor(DOCUMENT, "new-1", new Set(["42"]), ORIGINS)).toEqual({
      alias: "1",
      formedBy: null
    });
  });

  it("places a line-only diagnostic in the right unit", () => {
    const diagnostic = {
      code: "unknown-command",
      message: "",
      severity: "error" as const,
      unitId: null,
      formed: null,
      lineStart: 4,
      lineEnd: 4,
      columnStart: null,
      columnEnd: null,
      regionId: null
    };
    expect(unitIdForDiagnostic(DOCUMENT, diagnostic, TRIDENT)).toBe("42");
    expect(unitIdForDiagnostic(DOCUMENT, diagnostic, ORIGINS)).toBeNull();

    expect(
      diagnosticTargets(DOCUMENT, [diagnostic], new Map(), TRIDENT).map((target) => target.unitId)
    ).toEqual(["42"]);
  });

  it("counts the units an import would replace", () => {
    expect(describeOrdersImport(DOCUMENT, DOCUMENT, TRIDENT)).toEqual({
      fileUnitIds: ["42"],
      emptiedUnitIds: []
    });
    expect(describeOrdersImport(DOCUMENT, DOCUMENT, ORIGINS).fileUnitIds).toEqual([]);
  });

  it("replaces a month-long order rather than writing a second one", () => {
    const plan = studyWritePlan({
      document: DOCUMENT,
      entries: [
        {
          unitId: "42",
          name: "Miner",
          regionId: "1,1",
          order: "STUDY COMB",
          annotation: null,
          skipReason: null
        } as never
      ],
      banner: () => ";*** plain (1,1) in Nowhere ***",
      label: () => "plain (1,1)",
      syntax: TRIDENT
    });
    expect(longOrderOf(readUnitOrders(plan.next, "42", undefined, TRIDENT) ?? "", TRIDENT)).toBe(
      "STUDY COMB"
    );
    expect(plan.next).not.toContain("WORK;paying the guard");
  });

  it("replaces a commented movement order when a route is planned", () => {
    const routed = writeRouteOrder({
      document: ["unit 42;the miner", "MOVE;the old plan"].join("\n"),
      unitId: "42",
      banner: null,
      order: "MOVE N NE",
      syntax: TRIDENT
    });
    expect(routed).toBe(["unit 42;the miner", "MOVE N NE"].join("\n"));
  });

  it("strips and restores the server's descriptions around the right blocks", () => {
    expect(stripUnitComments(DOCUMENT, TRIDENT)).toBe(DOCUMENT);
    expect(ordersExportText(DOCUMENT, DOCUMENT, false, TRIDENT)).toBe(DOCUMENT);
  });

  it("compares two turns' drafts by unit", () => {
    const older = DOCUMENT.replace("WORK;paying the guard", "TAX;paying the guard");
    // `commandsOnly` keeps every line of the block that is not a whole-line comment, the nested
    // FORM among them; only the first line differs between the two drafts.
    const rest = ["FORM 1;the scout", "MOVE N;north", "END;done"];
    expect(diffOrders(older, DOCUMENT, TRIDENT).changed).toEqual([
      {
        unitId: "42",
        before: ["TAX;paying the guard", ...rest],
        after: ["WORK;paying the guard", ...rest]
      }
    ]);
    // Under the Origins default neither header parses, so every unit silently vanishes from the
    // comparison - which is the failure this seam exists to prevent.
    expect(diffOrders(older, DOCUMENT, ORIGINS).changed).toEqual([]);
  });

  it("indexes the template's long orders", () => {
    const template = { units: [{ unitId: "42", lines: ["WORK;paying the guard"] }] } as never;
    expect(reportedLongOrders(template, TRIDENT)?.get("42")).toBe("WORK;paying the guard");
    expect(reportedLongOrders(template, ORIGINS)?.get("42")).toBeNull();
  });
});
