import type { ReactNode } from "react";
import {
  allyBannerText,
  attackRowText,
  attacksBarText,
  attackTitleText,
  backlineNote,
  groupHeading,
  missingTargetBannerText,
  unitLineParts,
  unitNote,
  type AttackView,
  type MusterGroup,
  type MusterUnit
} from "../attackMuster";
import { DialogFrame } from "./DialogFrame";

/**
 * Who of ours the orders' attacks would muster, before the orders are sent (ah-pbyfh).
 *
 * Built like `BattlesDialog`, as agreed in `docs/ui/ah-pbyfh-attacks.html`: a list rail of one row
 * per attacking unit, and the selected attack's Frontline, Backline and Will not fight. Every rule
 * and every word is `attackMuster.ts`'s; this draws.
 *
 * Each group is a card of aligned, striped rows, every row the button that goes to its unit, and
 * `compact` cuts every note to one line with the full text on hover (ah-3eegs,
 * `docs/ui/ah-3eegs-states.html`). The setting is the store's; this only draws it.
 *
 * `selectedKey` that names no row - the selected attack's order was deleted - falls back to the
 * first row, so the detail is never empty while any attack is left.
 */
export function AttacksDialog({
  attacks,
  selectedKey,
  compact,
  onToggleCompact,
  onSelect,
  onShowOnMap,
  onGoToUnit,
  onDismiss
}: {
  attacks: AttackView[];
  selectedKey: string | null;
  compact: boolean;
  onToggleCompact: () => void;
  onSelect: (key: string) => void;
  onShowOnMap: (regionId: string) => void;
  onGoToUnit: (unitId: string, regionId: string) => void;
  onDismiss: () => void;
}) {
  const selected = attacks.find((attack) => attack.key === selectedKey) ?? attacks[0] ?? null;

  return (
    <DialogFrame
      label="Attacks"
      onDismiss={onDismiss}
      layer="z-30"
      backdropTestId="attacks-backdrop"
      testId="attacks-dialog"
      boxClassName="grid h-[85vh] w-[80rem] max-w-[94vw] grid-rows-[auto_1fr] rounded border border-edge bg-panel-raised text-pane whitespace-normal shadow-lg"
      barClassName="items-center gap-2 border-b border-edge px-2 py-1.5"
      close={{ testId: "attacks-close", label: "close attacks", look: "plain", autoFocus: true }}
      bar={
        <>
          <span className="text-ink-soft">{attacksBarText(attacks.length)}</span>
          <span className="flex-1" />
          <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-ink-soft">
            <input
              type="checkbox"
              data-testid="attacks-compact"
              checked={compact}
              onChange={onToggleCompact}
              className="h-3 w-3 accent-select"
            />
            Compact view
          </label>
        </>
      }
    >
      {attacks.length === 0 || selected === null ? (
        <p className="p-6 text-center text-ink-dim">Your orders have no attacks.</p>
      ) : (
        <div className="grid min-h-0 grid-cols-1 grid-rows-[auto_1fr] md:grid-cols-[19rem_1fr] md:grid-rows-1">
          <ul
            data-testid="attacks-list"
            role="listbox"
            aria-label="Attacks"
            className="max-h-[30vh] min-h-0 overflow-y-auto border-b border-edge md:max-h-none md:border-b-0 md:border-r"
          >
            {attacks.map((attack) => (
              <li
                key={attack.key}
                role="presentation"
                className={`border-b border-edge-soft last:border-b-0 ${attack === selected ? "bg-select/15" : ""}`}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={attack === selected}
                  data-testid={`attack-row-${attack.key}`}
                  onClick={() => onSelect(attack.key)}
                  className="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left"
                >
                  <span className="text-ink">{attackRowText(attack)}</span>
                  <span className="text-ink-dim">{attack.hex}</span>
                </button>
              </li>
            ))}
          </ul>
          <AttackDetail
            key={selected.key}
            attack={selected}
            compact={compact}
            onShowOnMap={onShowOnMap}
            onGoToUnit={onGoToUnit}
          />
        </div>
      )}
    </DialogFrame>
  );
}

function AttackDetail({
  attack,
  compact,
  onShowOnMap,
  onGoToUnit
}: {
  attack: AttackView;
  compact: boolean;
  onShowOnMap: (regionId: string) => void;
  onGoToUnit: (unitId: string, regionId: string) => void;
}) {
  return (
    <div data-testid="attack-detail" className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-ink">{attackTitleText(attack)}</p>
        <p className="text-ink-dim">
          {`in ${attack.hex} · `}
          <button
            type="button"
            data-testid="attacks-show-on-map"
            onClick={() => onShowOnMap(attack.regionId)}
            className="cursor-pointer text-select underline decoration-dotted hover:text-select-bright hover:decoration-solid"
          >
            show on map
          </button>
        </p>
      </div>

      {attack.allies.map((faction) => (
        <p
          key={faction.id}
          data-testid="attack-ally-banner"
          className="rounded border border-danger bg-danger/10 px-2 py-1.5 text-danger"
        >
          {allyBannerText(faction)}
        </p>
      ))}

      {attack.withdraws ? null : (
        <>
          {attack.missingTargets.map((targetId) => (
            <p
              key={targetId}
              data-testid="attack-target-banner"
              className="rounded border border-warn bg-warn/10 px-2 py-1.5 text-warn"
            >
              {missingTargetBannerText(targetId, attack)}
            </p>
          ))}
          <Group group="frontline" units={attack.frontline} compact={compact} onGoToUnit={onGoToUnit} />
          {attack.backline.length > 0 ? (
            <Group group="backline" units={attack.backline} compact={compact} onGoToUnit={onGoToUnit}>
              <p className="px-2.5 py-1.5 text-ink-dim">{backlineNote(attack)}</p>
            </Group>
          ) : null}
          <Group group="out" units={attack.out} compact={compact} onGoToUnit={onGoToUnit}>
            {attack.out.length === 0 ? (
              <p className="px-2.5 py-1.5 text-ink-dim">Every unit of yours that could join will.</p>
            ) : null}
          </Group>
          <p className="text-ink-dim">Click a unit to go to it.</p>
        </>
      )}
    </div>
  );
}

/**
 * The row's columns (ah-3eegs): mark, unit, men, role, note. On a narrow window the unit and its men
 * keep the first line, the role goes beneath the name and the note beneath that, all in one row.
 */
const ROW_GRID =
  "grid grid-cols-[1.2em_minmax(0,1fr)_3rem] items-baseline gap-x-2.5 md:grid-cols-[1.2em_12rem_3rem_8.5rem_minmax(0,1fr)]";

/** Where the role and the note sit: beneath the name on a narrow window, in their own column on a wide one. */
const BENEATH = "col-start-2 md:col-start-auto";
const NOTE_CELL = "col-span-2 col-start-2 min-w-0 md:col-span-1 md:col-start-auto";

/** The hover and keyboard-focus highlight: a blue band and a blue inner edge on the left. Spelled out, for Tailwind to find. */
const LIT =
  "hover:bg-select/15 hover:shadow-[inset_3px_0_0_var(--color-select)] focus-visible:bg-select/15 focus-visible:shadow-[inset_3px_0_0_var(--color-select)]";

function Group({
  group,
  units,
  compact,
  onGoToUnit,
  children
}: {
  group: MusterGroup;
  units: MusterUnit[];
  compact: boolean;
  onGoToUnit: (unitId: string, regionId: string) => void;
  children?: ReactNode;
}) {
  const out = group === "out";
  const heading = groupHeading(group, units);
  return (
    <section
      data-testid={`attack-group-${group}`}
      className={`rounded border border-l-4 border-edge bg-panel ${out ? "border-l-danger" : "border-l-brass"}`}
    >
      <h3
        className={`flex gap-2.5 border-b border-edge-soft px-2.5 py-1.5 uppercase tracking-wide ${out ? "text-danger" : "text-brass"}`}
      >
        {heading.name}
        <span className="normal-case tracking-normal text-ink-dim">{heading.count}</span>
      </h3>
      {children}
      {units.length > 0 ? (
        <ul className="py-1">
          {units.map((unit) => (
            <li key={`${unit.regionId}/${unit.unitId}`} className="even:bg-ink/[0.04]">
              <UnitRow unit={unit} out={out} compact={compact} onGoToUnit={onGoToUnit} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** One unit as a row, the whole of it the button that goes to the unit. */
function UnitRow({
  unit,
  out,
  compact,
  onGoToUnit
}: {
  unit: MusterUnit;
  out: boolean;
  compact: boolean;
  onGoToUnit: (unitId: string, regionId: string) => void;
}) {
  const { name, number, men, role } = unitLineParts(unit);
  const note = unitNote(unit);
  const reasonColour = out ? "text-danger" : "text-ink-dim";
  return (
    <button
      type="button"
      data-testid={`attack-unit-${unit.unitId}`}
      onClick={() => onGoToUnit(unit.unitId, unit.regionId)}
      className={`group ${ROW_GRID} w-full cursor-pointer px-2.5 py-1 text-left outline-none ${LIT}`}
    >
      <span aria-hidden="true" className="text-center font-bold text-warn">
        {unit.warning !== null ? "!" : ""}
      </span>
      <span>
        <span className="text-ink underline decoration-dotted underline-offset-[3px] group-hover:text-ink-bright group-hover:decoration-solid group-hover:decoration-select group-focus-visible:text-ink-bright group-focus-visible:decoration-solid group-focus-visible:decoration-select">
          {name}
        </span>{" "}
        <span className="text-select">{number}</span>
      </span>
      <span className="text-right text-ink-dim">{men}</span>
      <span className={`${BENEATH} text-ink`}>{role}</span>
      {compact ? (
        <span
          data-testid={`attack-note-${unit.unitId}`}
          title={note.full}
          className={`${NOTE_CELL} truncate ${note.warning !== null ? "text-warn" : reasonColour}`}
        >
          {note.compact}
        </span>
      ) : (
        <span className={NOTE_CELL}>
          {note.warning !== null ? <span className="block text-warn">{note.warning}</span> : null}
          {note.reason !== null ? <span className={`block ${reasonColour}`}>{note.reason}</span> : null}
        </span>
      )}
    </button>
  );
}
