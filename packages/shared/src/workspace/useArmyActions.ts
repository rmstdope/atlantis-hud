/**
 * The Army writes the rail, the strip and the popover call, with the failure message in one place
 * instead of five.
 *
 * Every mutation on `useArmiesStore` is optimistic and rethrows when the save fails, having already
 * put the old value back (`replaceAndSave` in `armiesStore.ts`). So there is nothing to undo here
 * and nothing to say but what failed - which is what `ah-1mpx.2` S4 settles: a save that fails says
 * `could not save <the Army's name>` on the header status line. Without it the only available
 * conclusion is that the application drops units.
 */

import { useMemo } from "react";
import type { CoreClient, OpenedGame, ReportUnit } from "@atlantis/core-client";
import { useArmiesStore } from "../armiesStore";

/** What the rail, the strip and the popover call. Every one has already reported its own failure. */
export type ArmyActions = {
  create: (name: string, withUnit: ReportUnit | null) => Promise<void>;
  rename: (armyId: string, name: string) => Promise<void>;
  remove: (armyId: string) => Promise<void>;
  addUnit: (armyId: string, unit: ReportUnit) => Promise<void>;
  removeUnit: (armyId: string, unitId: string) => Promise<void>;
  removeUnits: (armyId: string, unitIds: readonly string[]) => Promise<void>;
};

const NO_ACTIONS: ArmyActions = {
  create: async () => {},
  rename: async () => {},
  remove: async () => {},
  addUnit: async () => {},
  removeUnit: async () => {},
  removeUnits: async () => {}
};

/**
 * The Army writes, each one awaiting the store, catching the rethrow it makes on a failed save,
 * and reporting it.
 *
 * Returns a no-op set when `game` is null, so the callers need no null check of their own.
 *
 * `addUnit` needs a turn to stamp a snapshot with, so when `currentTurn` is null the action is not
 * offered at all - the `Add to army ▾` trigger is disabled. `judgeReportUsable` already refuses a
 * report naming no turn, so the guard below is type-driven rather than a case that arises.
 */
export function useArmyActions({
  client,
  game,
  currentTurn,
  onFailure
}: {
  client: CoreClient | undefined;
  game: OpenedGame | null;
  currentTurn: number | null;
  onFailure: (message: string) => void;
}): ArmyActions {
  return useMemo(() => {
    if (!client || !game) {
      return NO_ACTIONS;
    }
    const store = () => useArmiesStore.getState();
    // Taken inside each call rather than once per render, exactly as `AppShell.tsx:1241-1250` does
    // for a stored turn: a clock read at render time would stamp every write with the moment the
    // component last drew.
    const now = () => new Date().toISOString();
    const nameOf = (armyId: string) =>
      store().armies.find((one) => one.id === armyId)?.name ?? "the army";

    /** Runs one write, reporting rather than throwing when the store rolls it back. */
    const guarded = async (name: string, write: () => Promise<void>): Promise<void> => {
      try {
        await write();
      } catch {
        onFailure(`could not save ${name}`);
      }
    };

    return {
      create: (name, withUnit) =>
        guarded(name.trim(), async () => {
          const army = await store().create(client, game, name, now());
          // The popover's `New Army…` puts the unit in: created first, so there is an Army id to
          // add it to, and both failures report under the same name.
          if (withUnit !== null && currentTurn !== null) {
            await store().addUnit(client, game, army.id, withUnit, currentTurn, now());
          }
        }),
      rename: (armyId, name) =>
        // Named for what it is being renamed to: that is the word on screen when it fails.
        guarded(name.trim(), () => store().rename(client, game, armyId, name, now())),
      remove: (armyId) => guarded(nameOf(armyId), () => store().remove(client, game, armyId)),
      addUnit: (armyId, unit) =>
        guarded(nameOf(armyId), async () => {
          if (currentTurn === null) {
            return;
          }
          await store().addUnit(client, game, armyId, unit, currentTurn, now());
        }),
      removeUnit: (armyId, unitId) =>
        guarded(nameOf(armyId), () => store().removeUnit(client, game, armyId, unitId, now())),
      removeUnits: (armyId, unitIds) =>
        guarded(nameOf(armyId), () => store().removeUnits(client, game, armyId, unitIds, now()))
    };
  }, [client, game, currentTurn, onFailure]);
}
