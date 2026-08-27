import type { ReportUnit, RoutePlanResponse, UnitPreview } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";
import type { GameDataIndex } from "../gameData";
import type { MagicTree } from "../magicTree";
import { useWorkspaceStore, type SlotTab } from "../workspaceStore";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { PlannerActions, PlannerBody } from "./PlannerPanel";
import { SlotTabs } from "./SlotTabs";
import { slotTabToShow } from "./slotTab";
import { UnitPanel, UnitPanelBody, unitPanelHint } from "./UnitPanel";

/** What the shared slot needs to draw the movement planner, or null when its flag is off. */
export type SlotPlanner = {
  armed: boolean;
  busy: boolean;
  answer: RoutePlanResponse | null;
  onArm: () => void;
  onClear: () => void;
  onApply: (order: string) => void;
};

type UnitMovementSlotProps = {
  unit: ReportUnit | null;
  hex: HexNode | null;
  preview?: UnitPreview | null;
  gameData?: GameDataIndex | null;
  onOpenGameData?: (entryId: string) => void;
  magicTree?: MagicTree | null;
  onOpenMagicTree?: (tag: string) => void;
  /** Absent when the movement-planner flag is off: no tab strip is drawn at all. */
  planner: SlotPlanner | null;
};

/**
 * The selected unit and the movement planner, sharing one slot as two tabs.
 *
 * They used to be two panels stacked in the right-hand column, which has 249px at the suite's
 * pinned 1280x720 window. A one-step route asked for 245px of it, crushed the unit panel to two
 * pixels and laid the orders editor out underneath the units pane, where a player could click
 * `Apply to orders` and watch the text go into an editor they could not see (ah-zh5i.2). One slot
 * for the two of them is what keeps the column at the two panels it can actually hold.
 *
 * With the planner off - the default, and so almost every player - this is the unit panel exactly
 * as it has always been: no strip, no `Plan move`, nothing new to look at.
 */
export function UnitMovementSlot({ planner, ...unitProps }: UnitMovementSlotProps) {
  const asked = useWorkspaceStore((state) => state.unitSlotTab);
  const showUnitSlotTab = useWorkspaceStore((state) => state.showUnitSlotTab);
  const collapsed = useWorkspaceStore((state) => state.collapsed.unit);
  const togglePanel = useWorkspaceStore((state) => state.togglePanel);

  if (planner === null) {
    return <UnitPanel {...unitProps} />;
  }

  const tab = slotTabToShow(asked, true);
  const { hint, asOf } = unitPanelHint(unitProps.unit, unitProps.hex, unitProps.preview ?? null);

  // A tab click on a folded slot opens it on that tab: the strip stays visible while folded, so it
  // would otherwise be a control that does nothing you can see. Planning does *not* unfold - a
  // fold is an explicit "not this panel", and the dot on the strip is how a waiting route says so.
  const select = (next: SlotTab) => {
    showUnitSlotTab(next);
    if (collapsed) {
      togglePanel("unit");
    }
  };

  return (
    <CollapsiblePanel
      panel="unit"
      title="Unit"
      tabs={
        <SlotTabs tab={tab} hasRoute={planner.answer?.plan != null} onSelect={select} />
      }
      actions={
        <PlannerActions
          unit={unitProps.unit}
          armed={planner.armed}
          busy={planner.busy}
          onArm={planner.onArm}
          onClear={planner.onClear}
          hasAnswer={planner.answer !== null}
        />
      }
    >
      {tab === "unit" ? (
        <div
          role="tabpanel"
          id="slot-panel-unit"
          aria-labelledby="slot-tab-unit"
          className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2"
        >
          {/*
            The title bar is a tab strip now, with no room for `CollapsiblePanel`'s hint and `asOf`.
            The unit's name is not something to lose, so the tab panel carries them as its own
            first line, same strings and same order.
          */}
          {hint || asOf ? (
            <p className="m-0 mb-2">
              {hint ? <span className="text-ink-dim">{hint}</span> : null}
              {asOf ? <span className="ml-2 text-warn">{asOf}</span> : null}
            </p>
          ) : null}
          <UnitPanelBody {...unitProps} />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="slot-panel-movement"
          aria-labelledby="slot-tab-movement"
          data-testid="panel-planner"
          // No scroller here: `PlannerBody` is itself a column with its own scroller and the pinned
          // Apply row below it, so it must be given the height rather than a scrollbar.
          className="flex min-h-0 flex-1 flex-col"
        >
          <PlannerBody
            unit={unitProps.unit}
            armed={planner.armed}
            busy={planner.busy}
            answer={planner.answer}
            onApply={planner.onApply}
          />
        </div>
      )}
    </CollapsiblePanel>
  );
}
