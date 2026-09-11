import { describe, expect, it } from "vitest";
import type { OrdersPreviewResponse, RegionPreview, ReportUnit } from "@atlantis/core-client";
import { aReportUnit } from "@atlantis/core-client";
import { previewPairs, standingRowFor } from "./unitPreviewRows";
import { unitRowKey } from "./unitTable";

const unit = (overrides: Partial<ReportUnit>): ReportUnit =>
  aReportUnit({ unitId: "900", name: "Walker", weight: 10, capacity: "0/0/15/0", ...overrides });

/** One previewed unit, with every field the wire carries defaulted. */
const previewedRow = (
  unitOverrides: Partial<ReportUnit>,
  overrides: Partial<RegionPreview["units"][number]> = {}
): RegionPreview["units"][number] => ({
  unit: unit(unitOverrides),
  status: "present",
  changes: [],
  arrivingFrom: null,
  departingTo: null,
  aboard: null,
  uncounted: [],
  takenUnshown: [],
  produced: [],
  built: [],
  buildPlacementRefusals: [],
  created: [],
  transportSent: [],
  transportReceived: [],
  transportTargetIssues: [],
  itemChanges: [],
  dissolvesInto: null,
  formed: false,
  dissolving: false,
  skillMerges: [],
  reportedSkills: [],
  recruitsUnmerged: false,
  menOfUnknownSkill: [],
  study: null,
  ...overrides
});

const region = (regionId: string, units: RegionPreview["units"]): RegionPreview => ({
  regionId,
  units
});

const response = (...regions: RegionPreview[]): OrdersPreviewResponse =>
  ({ regions }) as unknown as OrdersPreviewResponse;

describe("previewPairs", () => {
  it("pairs a mover's departing row with the arrival it was pushed beside", () => {
    const departing = previewedRow(
      { unitId: "900", regionId: "1:7" },
      { status: "departing", departingTo: "1:8" }
    );
    const arriving = previewedRow(
      { unitId: "900", regionId: "1:8" },
      { status: "arriving", arrivingFrom: "1:7" }
    );
    const pairs = previewPairs(
      response(region("1:7", [departing]), region("1:8", [arriving]))
    );

    expect([...pairs.keys()]).toEqual([unitRowKey("1:7", "900")]);
    const pair = pairs.get(unitRowKey("1:7", "900"));
    expect(pair?.setOut).toEqual({ regionId: "1:7", row: departing });
    expect(pair?.ends).toEqual({ regionId: "1:8", row: arriving });
  });

  it("leaves a departure the trace could not name a destination for unpaired", () => {
    const departing = previewedRow(
      { unitId: "900", regionId: "1:7" },
      { status: "departing", departingTo: null }
    );
    const pairs = previewPairs(response(region("1:7", [departing])));

    expect(pairs.get(unitRowKey("1:7", "900"))?.ends).toBeNull();
  });

  it("leaves a departure whose arrival is absent unpaired", () => {
    const departing = previewedRow(
      { unitId: "900", regionId: "1:7" },
      { status: "departing", departingTo: "1:8" }
    );
    const pairs = previewPairs(response(region("1:7", [departing])));

    expect(pairs.get(unitRowKey("1:7", "900"))?.ends).toBeNull();
  });

  it("keeps two hexes' new-1 apart, alias and all", () => {
    const stays = previewedRow({ unitId: "new-1", regionId: "1:7" }, { formed: true });
    const moves = previewedRow(
      { unitId: "new-1", regionId: "1:8" },
      { status: "departing", departingTo: "1:9", formed: true }
    );
    const arrives = previewedRow(
      { unitId: "new-1", regionId: "1:9" },
      { status: "arriving", arrivingFrom: "1:8", formed: true }
    );
    const pairs = previewPairs(
      response(region("1:7", [stays]), region("1:8", [moves]), region("1:9", [arrives]))
    );

    expect(pairs.get(unitRowKey("1:7", "new-1"))?.ends).toBeNull();
    expect(pairs.get(unitRowKey("1:8", "new-1"))?.ends?.regionId).toBe("1:9");
  });

  it("drops an arriving row whose departure is missing", () => {
    const arriving = previewedRow(
      { unitId: "900", regionId: "1:8" },
      { status: "arriving", arrivingFrom: "1:7" }
    );
    const pairs = previewPairs(response(region("1:8", [arriving])));

    expect([...pairs.keys()]).toEqual([]);
  });

  it("keys a pair on the hex the report gave the unit", () => {
    const departing = previewedRow(
      { unitId: "900", regionId: "1:7" },
      { status: "departing", departingTo: "1:8" }
    );
    const arriving = previewedRow(
      { unitId: "900", regionId: "1:8" },
      { status: "arriving", arrivingFrom: "1:7" }
    );
    const pairs = previewPairs(
      response(region("1:7", [departing]), region("1:8", [arriving]))
    );

    expect(pairs.has(unitRowKey("1:7", "900"))).toBe(true);
    expect(pairs.has(unitRowKey("1:8", "900"))).toBe(false);
  });

  it("hands back an empty map for no preview at all", () => {
    expect([...previewPairs(null).keys()]).toEqual([]);
    expect([...previewPairs(undefined).keys()]).toEqual([]);
  });

  it("keeps the preview's own order", () => {
    const pairs = previewPairs(
      response(
        region("1:7", [
          previewedRow({ unitId: "901", regionId: "1:7" }),
          previewedRow({ unitId: "902", regionId: "1:7" })
        ]),
        region("1:8", [previewedRow({ unitId: "903", regionId: "1:8" })]),
        region("1:9", [previewedRow({ unitId: "904", regionId: "1:9" })])
      )
    );

    expect([...pairs.values()].map((pair) => pair.setOut.row.unit.unitId)).toEqual([
      "901",
      "902",
      "903",
      "904"
    ]);
  });
});

describe("standingRowFor", () => {
  const moving = () => {
    const departing = previewedRow(
      { unitId: "900", regionId: "1:7" },
      { status: "departing", departingTo: "1:8" }
    );
    const arriving = previewedRow(
      { unitId: "900", regionId: "1:8" },
      { status: "arriving", arrivingFrom: "1:7" }
    );
    return {
      arriving,
      departing,
      pairs: previewPairs(response(region("1:7", [departing]), region("1:8", [arriving])))
    };
  };

  it("gives the arrival for ends and the origin row for set-out", () => {
    const { pairs, departing, arriving } = moving();
    const pair = pairs.get(unitRowKey("1:7", "900"));

    expect(standingRowFor(pair, "ends")).toEqual({ regionId: "1:8", row: arriving });
    expect(standingRowFor(pair, "set-out")).toEqual({ regionId: "1:7", row: departing });
  });

  it("gives a present row for ends, because it never moved", () => {
    const present = previewedRow({ unitId: "900", regionId: "1:7" });
    const pairs = previewPairs(response(region("1:7", [present])));

    expect(standingRowFor(pairs.get(unitRowKey("1:7", "900")), "ends")).toEqual({
      regionId: "1:7",
      row: present
    });
  });

  it("gives nothing for ends when only a departing row exists", () => {
    const departing = previewedRow(
      { unitId: "900", regionId: "1:7" },
      { status: "departing", departingTo: "1:8" }
    );
    const pairs = previewPairs(response(region("1:7", [departing])));

    expect(standingRowFor(pairs.get(unitRowKey("1:7", "900")), "ends")).toBeNull();
  });

  it("gives nothing for no pair at all", () => {
    expect(standingRowFor(undefined, "ends")).toBeNull();
    expect(standingRowFor(undefined, "set-out")).toBeNull();
  });

  it("wraps the very same row object, so memoised rows survive", () => {
    const { pairs, departing, arriving } = moving();
    const pair = pairs.get(unitRowKey("1:7", "900"));

    expect(pair?.setOut.row).toBe(departing);
    expect(pair?.ends?.row).toBe(arriving);
  });
});
