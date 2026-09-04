import { describe, expect, it, vi } from "vitest";
import {
  deliverArmyExport,
  deliverGameBackupExport,
  deliverMageSheetExport,
  deliverMapExport,
  deliverOrdersExport
} from "./exportActions";
import { battleFileOf, battleFileText } from "../armyExport";
import { NO_DERIVED_SKILLS } from "../battleSkills";
import type { ArmyMemberRecord, ArmyRecord } from "@atlantis/core-client";
import { exportFileName } from "../mapExport";

describe("deliverOrdersExport", () => {
  it("saves through the shell's saver, with the plain-text mime type", async () => {
    const saveTextFile = vi.fn().mockResolvedValue("/chosen/orders-turn-71.txt");

    await deliverOrdersExport(saveTextFile, 71, "unit 1 : work", null, false);

    expect(saveTextFile).toHaveBeenCalledWith("orders-turn-71.txt", "unit 1 : work", "text/plain");
  });

  it("a cancelled save (null) writes nothing further and does not throw", async () => {
    const saveTextFile = vi.fn().mockResolvedValue(null);

    await expect(deliverOrdersExport(saveTextFile, 71, "unit 1 : work", null, false)).resolves.toBeUndefined();
  });

  it("logs and swallows a failed delivery instead of rejecting", async () => {
    const saveTextFile = vi.fn().mockRejectedValue(new Error("disk full"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        deliverOrdersExport(saveTextFile, 71, "unit 1 : work", null, false)
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("falls back to 'unknown' when the turn number is unavailable", async () => {
    const saveTextFile = vi.fn().mockResolvedValue("");

    await deliverOrdersExport(saveTextFile, null, "unit 1 : work", null, true);

    expect(saveTextFile).toHaveBeenCalledWith("orders-turn-unknown.txt", expect.any(String), "text/plain");
  });
});

describe("deliverGameBackupExport", () => {
  it("saves through the shell's saver, named after the game, with the JSON mime type", async () => {
    const saveTextFile = vi.fn().mockResolvedValue("/chosen/Backup game.atlantis-hud-game.json");

    const path = await deliverGameBackupExport(saveTextFile, "Backup game", "{}");

    expect(saveTextFile).toHaveBeenCalledWith(
      "Backup game.atlantis-hud-game.json",
      "{}",
      "application/json"
    );
    expect(path).toBe("/chosen/Backup game.atlantis-hud-game.json");
  });

  it("resolves null on a cancelled save, without throwing", async () => {
    const saveTextFile = vi.fn().mockResolvedValue(null);

    await expect(deliverGameBackupExport(saveTextFile, "Backup game", "{}")).resolves.toBeNull();
  });
});

/**
 * Rendering and delivering a map export (ah-k6i.4) - the part of `exportMap` with no dependency on
 * React state, pulled out the same way `deliverOrdersExport` was so it can be tested without
 * rendering the shell.
 */
describe("deliverMapExport", () => {
  const rect = { fromX: 0, fromY: 0, toX: 1, toY: 1 };
  const content = { structures: true, units: true, advancedResources: true };

  it("renders through the client and delivers the result under the map's file name", async () => {
    const client = { exportMap: vi.fn().mockResolvedValue("svg…") };
    const saveTextFile = vi.fn().mockResolvedValue("/chosen/map-turn-71-level-1.txt");

    const path = await deliverMapExport(client, saveTextFile, "raw report", "[]", 1, 71, rect, content);

    expect(client.exportMap).toHaveBeenCalledWith("raw report", "[]", { level: 1, ...rect, content });
    expect(saveTextFile).toHaveBeenCalledWith(exportFileName(71, 1), "svg…", "text/plain");
    expect(path).toBe("/chosen/map-turn-71-level-1.txt");
  });

  it("a cancelled save (null) resolves null and writes nothing further", async () => {
    const client = { exportMap: vi.fn().mockResolvedValue("svg…") };
    const saveTextFile = vi.fn().mockResolvedValue(null);

    await expect(
      deliverMapExport(client, saveTextFile, "raw report", "[]", 1, 71, rect, content)
    ).resolves.toBeNull();
  });

  it("a failed render rejects rather than being swallowed - the caller reports it in the dialog", async () => {
    const client = { exportMap: vi.fn().mockRejectedValue(new Error("core is unavailable")) };
    const saveTextFile = vi.fn();

    await expect(
      deliverMapExport(client, saveTextFile, "raw report", "[]", 1, 71, rect, content)
    ).rejects.toThrow("core is unavailable");
    expect(saveTextFile).not.toHaveBeenCalled();
  });
});

describe("deliverArmyExport", () => {
  const NOW = "2026-08-27T09:00:00Z";

  const member = (overrides: Partial<ArmyMemberRecord> = {}): ArmyMemberRecord => ({
    unitId: "18642",
    name: "Shieldwall",
    factionId: "95",
    factionName: "Borg TNG",
    own: true,
    regionId: "1:7,53",
    flags: [],
    items: [],
    skills: [],
    combatSpell: null,
    men: 1,
    seenTurn: 71,
    seenAt: NOW,
    ...overrides
  });

  const army = (name: string): ArmyRecord => ({
    id: name,
    gameId: "game-1",
    name,
    members: [member()],
    createdAt: NOW,
    updatedAt: NOW
  });

  it("writes an army battle file", async () => {
    const saveTextFile = vi.fn().mockResolvedValue("/chosen/northern-host.json");
    const northern = army("Northern Host");

    const path = await deliverArmyExport(saveTextFile, northern, null, NO_DERIVED_SKILLS);

    expect(saveTextFile).toHaveBeenCalledWith(
      "northern-host.json",
      battleFileText(battleFileOf(northern, null, NO_DERIVED_SKILLS)),
      "application/json"
    );
    expect(path).toBe("/chosen/northern-host.json");
  });

  it("reports a cancelled save as null so the dialog may stay open", async () => {
    const saveTextFile = vi.fn().mockResolvedValue(null);

    await expect(deliverArmyExport(saveTextFile, army("Northern Host"), null, NO_DERIVED_SKILLS)).resolves.toBeNull();
  });
});

/** Delivering a shared mage sheet (ah-lyg6.1.1). */
describe("delivering a mage sheet", () => {
  it("delivers a mage sheet under its own name", async () => {
    const client = { exportMageSheet: vi.fn().mockResolvedValue("; Mage sheet from Atlantis HUD\n") };
    const saveTextFile = vi.fn().mockResolvedValue("/tmp/mages-Borg-turn-23.txt");

    const written = await deliverMageSheetExport(
      client,
      saveTextFile,
      "raw report",
      ["301", "302"],
      "Borg",
      "21",
      23
    );

    expect(client.exportMageSheet).toHaveBeenCalledWith("raw report", JSON.stringify(["301", "302"]));
    expect(saveTextFile).toHaveBeenCalledWith(
      "mages-Borg-turn-23.txt",
      "; Mage sheet from Atlantis HUD\n",
      "text/plain"
    );
    expect(written).toBe("/tmp/mages-Borg-turn-23.txt");
  });
});
