import type { ArmyRecord } from "@atlantis/core-client";
import type { RailEvent, RailMode } from "./railEditState";
import { canCommit, keyToAction } from "./railEditState";
import { FOREIGN_SOURCE, HEX_SOURCE, OWN_SOURCE, sameSource, type UnitSource } from "./unitSource";

/** One frozen empty set, so a rail with no drag in flight re-renders nothing on its account. */
const NO_DROP_FULL: ReadonlySet<string> = new Set();

/**
 * The units dock's source rail: *This hex*, *All my units*, then each Army (`ah-1mpx.2`).
 *
 * Purely presentational. It reads no store and holds no state - `UnitTableDock` owns both the
 * editing state and the write callbacks, because the rail, the strip above the table and the
 * `Add to army` popover all drive the same editing state and must share one. That is also what
 * lets this be tested with `renderToStaticMarkup`, which is the only kind of component test this
 * package has (`testing/README.md`).
 *
 * It renders no status and never disables `+ New Army`: S1's decision is that the rail is complete
 * from its first paint, so `useArmiesStore`'s `status` is deliberately not consulted here or
 * anywhere else in this bead.
 */
export function UnitSourceRail({
  source,
  onSource,
  armies,
  hexCount,
  ownCount,
  foreignCount,
  mode,
  onEvent,
  canEdit,
  dropOver = null,
  dropFull = NO_DROP_FULL,
  dragging = false
}: {
  source: UnitSource;
  onSource: (source: UnitSource) => void;
  armies: readonly ArmyRecord[];
  /** The selected hex's unit count, or null when no hex is selected - the count is then omitted. */
  hexCount: number | null;
  ownCount: number;
  /** Units in the report belonging to anyone but you. Always drawn, and zero is a real answer. */
  foreignCount: number;
  mode: RailMode;
  onEvent: (event: RailEvent) => void;
  /** False when no game is open: the Armies group and "+ New Army" are then not rendered at all. */
  canEdit: boolean;
  /** The entry a drag is currently over, or null. Drawn brass-dashed (`ah-1mpx.4` D1). */
  dropOver?: { kind: "army"; armyId: string } | { kind: "new" } | null;
  /** Army ids that would take nothing from the drag in flight: drawn dim with a ✓, and inert. */
  dropFull?: ReadonlySet<string>;
  /** True while a drag is in flight, which is the only time the two above mean anything. */
  dragging?: boolean;
}) {
  // U4: the mark means "the table is not about the hex on the map", with no history in it - so it
  // is computed from `source` rather than passed in, and there is nothing to keep in step.
  const hexIsElsewhere = source.kind !== "hex";

  return (
    <div
      data-testid="unit-source-rail"
      // 172px, its own scroll, and a rule down its right edge against the table.
      className="w-[172px] flex-none overflow-y-auto border-r border-edge bg-panel-raised/70 p-1.5"
    >
      <RailEntry
        testId="unit-source-hex"
        label="This hex"
        count={hexCount}
        selected={source.kind === "hex"}
        highlighted={hexIsElsewhere}
        onSelect={() => onSource(HEX_SOURCE)}
      />
      <RailEntry
        testId="unit-source-own"
        label="All my units"
        count={ownCount}
        selected={source.kind === "own"}
        onSelect={() => onSource(OWN_SOURCE)}
      />
      <RailEntry
        testId="unit-source-foreign"
        label="Other factions"
        count={foreignCount}
        selected={source.kind === "foreign"}
        onSelect={() => onSource(FOREIGN_SOURCE)}
      />

      {canEdit ? (
        <>
          <div className="mx-1.5 mb-1 mt-2.5 text-pane-sm uppercase tracking-[0.12em] text-ink-dim">
            Armies
          </div>
          {armies.map((army) =>
            mode.kind === "renaming" && mode.armyId === army.id ? (
              <NameField key={army.id} draft={mode.draft} onEvent={onEvent} />
            ) : (
              <RailEntry
                key={army.id}
                testId={`unit-source-army-${army.id}`}
                label={army.name}
                count={army.members.length}
                selected={sameSource(source, { kind: "army", armyId: army.id })}
                onSelect={() => onSource({ kind: "army", armyId: army.id })}
                // How the drag finds its target: `document.elementFromPoint` at the pointer, then
                // `closest("[data-drop-army],[data-drop-new]")`. Nothing measures the rail, and an
                // Army with nothing to take carries no attribute at all - which is what makes the
                // drop refuse before the pointer is released rather than being refused after (W3).
                dropArmyId={dragging && !dropFull.has(army.id) ? army.id : null}
                over={dropOver?.kind === "army" && dropOver.armyId === army.id}
                full={dragging && dropFull.has(army.id)}
                // The same inline editor renames later, on double-click or the Rename button
                // (round 3, W2) - one naming control in the whole feature.
                onRename={() => onEvent({ type: "rename-clicked", armyId: army.id, name: army.name })}
              />
            )
          )}
          {mode.kind === "creating" ? <NameField draft={mode.draft} onEvent={onEvent} /> : null}
          <button
            type="button"
            data-testid="rail-new-army"
            data-drop-new={dragging ? "true" : undefined}
            onClick={() => onEvent({ type: "new-clicked", withUnits: [] })}
            className={`flex w-full items-center rounded px-[7px] py-[3px] text-left text-pane text-brass-bright hover:bg-panel focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass${
              dropOver?.kind === "new" ? " border border-dashed border-brass bg-brass/10" : ""
            }`}
          >
            + New Army
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * One source in the rail.
 *
 * A button rather than a row with a click handler: the rail is a list of things you choose, and a
 * keyboard has to reach every one of them.
 */
function RailEntry({
  testId,
  label,
  count,
  selected,
  highlighted = false,
  onSelect,
  onRename,
  dropArmyId = null,
  over = false,
  full = false
}: {
  testId: string;
  label: string;
  /** Null omits the count entirely - there is no hex to count. */
  count: number | null;
  selected: boolean;
  /** `This hex` while the table is about something else: brass, with a ●. */
  highlighted?: boolean;
  onSelect: () => void;
  /** Double-click renames, where the entry is an Army. */
  onRename?: () => void;
  /**
   * The Army id a drag may be dropped on here, or null for an entry that is not a target - which
   * covers `This hex` and `All my units` always, and an Army with nothing left to take.
   */
  dropArmyId?: string | null;
  /** The drag is over this entry: brass-dashed. */
  over?: boolean;
  /** This Army would take nothing from the drag: dim, ticked, and no target at all. */
  full?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-selected={selected}
      data-drop-army={dropArmyId ?? undefined}
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={onRename}
      className={`flex w-full items-center gap-1.5 rounded px-[7px] py-[3px] text-left text-pane focus-visible:outline focus-visible:outline-1 focus-visible:outline-select ${
        selected
          ? "bg-select/15 text-ink shadow-[inset_2px_0_0_var(--color-select)]"
          : highlighted
            ? "text-brass-bright"
            : "text-ink-soft hover:bg-panel"
      }${over ? " border border-dashed border-brass bg-brass/10 text-brass-bright" : ""}${
        full ? " opacity-40" : ""
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {/* The same ✓ the Add to army menu gives an Army with nothing to add, so the rail and the
          menu say the same thing about the same Army in the same mark (W3). */}
      {full ? <span className="text-ok">✓</span> : null}
      {count === null ? null : (
        <span className={`ml-auto text-pane-sm ${highlighted ? "text-brass-bright" : "text-ink-dim"}`}>
          {highlighted ? `${count} ●` : count}
        </span>
      )}
    </button>
  );
}

/**
 * The rail's inline name editor - the one naming control in the feature (U2).
 *
 * `+ New Army` puts the cursor here, `New Army…` in the popover drops into this same field, and
 * `Rename` puts an existing row into it. Enter commits, Escape abandons a new Army and reverts a
 * rename, and an empty name is refused with the row staying in edit.
 */
function NameField({ draft, onEvent }: { draft: string; onEvent: (event: RailEvent) => void }) {
  return (
    <div className="px-1 py-0.5">
      <input
        type="text"
        data-testid="rail-name-field"
        aria-label="Army name"
        value={draft}
        // The field is mounted by a state change the player caused, so it is safe to take focus:
        // nothing else on screen was competing for it.
        autoFocus
        onChange={(event) => onEvent({ type: "draft-changed", draft: event.target.value })}
        onKeyDown={(event) => {
          const action = keyToAction(event);
          if (action === null) {
            return;
          }
          event.preventDefault();
          // Refusing an empty name by doing nothing leaves the row in edit, which is the round-3
          // decision: there is nowhere better for the cursor to be than in the name being fixed.
          if (action === "cancel") {
            onEvent({ type: "cancelled" });
          } else if (canCommit(draft)) {
            onEvent({ type: "committed" });
          }
        }}
        // Clicking away is the same abandonment Escape is: there is no third answer, and a field
        // left standing over a rail nobody is editing is a control with no way out.
        onBlur={() => onEvent({ type: "cancelled" })}
        className="w-full rounded border border-select bg-ground px-[5px] py-px text-pane text-ink focus:outline-none"
      />
    </div>
  );
}
