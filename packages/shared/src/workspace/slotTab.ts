import type { SlotTab } from "../workspaceStore";

/**
 * Which of the shared slot's two tabs is showing.
 *
 * `asked` is `unitSlotTab` - what the player last clicked, or what the last plan set. With the
 * movement planner off there is no Movement tab to show, whatever was asked for: the flag is off
 * for almost everyone, and a one-tab strip is furniture for nothing.
 *
 * A plain function rather than a hook, so it can be tested without a DOM - see
 * `packages/shared/src/testing/README.md`.
 */
export function slotTabToShow(asked: SlotTab | null, plannerEnabled: boolean): SlotTab {
  if (!plannerEnabled || asked === null) {
    return "unit";
  }
  return asked;
}
