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
 * `selectedKey` that names no row - the selected attack's order was deleted - falls back to the
 * first row, so the detail is never empty while any attack is left.
 */
export function AttacksDialog({
  attacks,
  selectedKey,
  onSelect,
  onShowOnMap,
  onGoToUnit,
  onDismiss
}: {
  attacks: AttackView[];
  selectedKey: string | null;
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
  onShowOnMap,
  onGoToUnit
}: {
  attack: AttackView;
  onShowOnMap: (regionId: string) => void;
  onGoToUnit: (unitId: string, regionId: string) => void;
}) {
  return (
    <div data-testid="attack-detail" className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-ink">{attackTitleText(attack)}</p>
        <p className="text-ink-dim">
          {`in ${attack.hex} · `}
          <button
            type="button"
            data-testid="attacks-show-on-map"
            onClick={() => onShowOnMap(attack.regionId)}
            className="text-select underline decoration-dotted"
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
          <Group group="frontline" units={attack.frontline} onGoToUnit={onGoToUnit} />
          {attack.backline.length > 0 ? (
            <Group group="backline" units={attack.backline} onGoToUnit={onGoToUnit}>
              <p className="text-ink-dim">{backlineNote(attack)}</p>
            </Group>
          ) : null}
          <Group group="out" units={attack.out} onGoToUnit={onGoToUnit}>
            {attack.out.length === 0 ? (
              <p className="text-ink-dim">Every unit of yours that could join will.</p>
            ) : null}
          </Group>
          <p className="text-ink-dim">Click a unit to go to it.</p>
        </>
      )}
    </div>
  );
}

function Group({
  group,
  units,
  onGoToUnit,
  children
}: {
  group: MusterGroup;
  units: MusterUnit[];
  onGoToUnit: (unitId: string, regionId: string) => void;
  children?: ReactNode;
}) {
  return (
    <section data-testid={`attack-group-${group}`} className="flex flex-col gap-1">
      <h3
        className={`text-pane-sm uppercase tracking-wide ${group === "out" && units.length > 0 ? "text-danger" : "text-brass"}`}
      >
        {groupHeading(group, units)}
      </h3>
      {children}
      {units.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {units.map((unit) => (
            <li key={`${unit.regionId}/${unit.unitId}`} className="flex flex-wrap items-baseline gap-x-2">
              {unit.warning !== null ? (
                <span aria-hidden="true" className="w-[1.1em] text-center text-warn">
                  !
                </span>
              ) : null}
              <button
                type="button"
                data-testid={`attack-unit-${unit.unitId}`}
                onClick={() => onGoToUnit(unit.unitId, unit.regionId)}
                className="text-left"
              >
                <UnitLine unit={unit} />
              </button>
              {unit.reasons.length > 0 ? (
                <span className={group === "out" ? "text-danger" : "text-ink-dim"}>{unit.reasons.join("; ")}</span>
              ) : null}
              {unit.warning !== null ? <span className="text-warn">{unit.warning}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** "Raiders (812) · 20 men · melee": the name underlined, the number in blue, as drawn in the mockup. */
function UnitLine({ unit }: { unit: MusterUnit }) {
  const { name, number, men, role } = unitLineParts(unit);
  return (
    <>
      <span className="text-ink underline decoration-dotted underline-offset-[3px]">{name}</span>{" "}
      <span className="text-select">{number}</span> <span className="text-ink-dim">{`· ${men} ·`}</span>{" "}
      <span className="text-ink">{role}</span>
    </>
  );
}
