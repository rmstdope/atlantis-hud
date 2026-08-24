import { describe, expect, it } from "vitest";

import type { GameMetadata } from "./index";

/**
 * These are typecheck assertions wearing a runtime disguise, and that is the point: each one fails
 * to *compile* if the ts-rs attribute on the Rust field is wrong. Do not delete them as tautologies.
 *
 * `ah-8z4y.2`: `map` absent and `map: null` are different claims - absent means the game was never
 * told a map, so the ruleset's default is only *assumed* (crates/core/src/backup.rs). A generated
 * `map: MapShape | null` would erase that distinction and typecheck perfectly.
 */
describe("the generated manifest types", () => {
  it("a manifest may omit map entirely", () => {
    const metadata: GameMetadata = { gameId: "g", gameName: "n", rulesetId: "r" };
    expect("map" in metadata).toBe(false);
  });

  it("a manifest may omit activeFactionId, or say null", () => {
    const absent: GameMetadata = { gameId: "g", gameName: "n", rulesetId: "r" };
    const stated: GameMetadata = { ...absent, activeFactionId: null };
    expect(stated.activeFactionId).toBeNull();
    expect("activeFactionId" in absent).toBe(false);
  });
});
