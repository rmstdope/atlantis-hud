import { describe, expect, it } from "vitest";
import { manifestSegments } from "./vesselManifest";

describe("the manifest a ship structure's kind is (ah-t5fk)", () => {
  it("splits a fleet into its label and one segment per counted vessel", () => {
    // `Frozen Tomb [194] : Galley, 40 Galleons, 11 Galleys, 10 Balloons`, turn-71 fixture.
    expect(manifestSegments("Galley, 40 Galleons, 11 Galleys, 10 Balloons")).toEqual([
      { name: "Galley", count: null },
      { name: "Galleons", count: 40 },
      { name: "Galleys", count: 11 },
      { name: "Balloons", count: 10 }
    ]);
  });

  it("reads a single vessel as one segment with no count", () => {
    // `Ship [623] : Galley`, fixture neworigins-3.0.0-g5-f21-t39.rep.
    expect(manifestSegments("Galley")).toEqual([{ name: "Galley", count: null }]);
  });

  it("leaves an ordinary building kind as a single segment", () => {
    expect(manifestSegments("Fort")).toEqual([{ name: "Fort", count: null }]);
  });

  it("keeps a segment that carries no numeral, contributing no count", () => {
    expect(manifestSegments("Cloudship, 14 Cloudships, 4 Airships")).toEqual([
      { name: "Cloudship", count: null },
      { name: "Cloudships", count: 14 },
      { name: "Airships", count: 4 }
    ]);
  });
});
