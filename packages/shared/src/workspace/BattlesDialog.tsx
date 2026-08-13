import type { Battle, BattleUnit } from "@atlantis/core-client";
import { regionIdOf } from "../hexMapModel";
import { useEscapeToDismiss } from "./dismissLayer";
import { allegianceOf, rosterCounts, summarise } from "./battles";

/**
 * The turn's battles, headline to spoils.
 *
 * One dialog rather than a chip's popover, candidate B of `docs/ui/battles-view.html`, chosen with
 * the navigator on 2026-08-13: a battle's roster can run past a hundred and fifty entries, which
 * has nowhere to go in a 28rem popover. The list rail on the left is never thrown away, so moving
 * between battles is one click and the summaries stay on screen as context; opening the dialog
 * selects the first battle so it is never empty.
 *
 * Centred over the workspace rather than hung off the header, for the reason `TurnMessagesPanel`
 * documents: the header is the one element that accepts a dropped report, and a floating child of
 * it would become an invisible drop target over the map.
 */
export function BattlesDialog({
  battles,
  selectedIndex,
  onSelect,
  hexLabel,
  viewerFactionId,
  onShowOnMap,
  onDismiss
}: {
  battles: Battle[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  hexLabel: (regionId: string) => string;
  /** The report's own faction id, for marking rosters. Null when the report named none. */
  viewerFactionId: string | null;
  onShowOnMap: (regionId: string) => void;
  onDismiss: () => void;
}) {
  useEscapeToDismiss(onDismiss);

  const selected = battles[selectedIndex] ?? null;

  return (
    <div
      data-testid="battles-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
    >
      <div
        data-testid="battles-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Battles"
        className="grid h-[85vh] w-[64rem] max-w-[94vw] grid-rows-[auto_1fr] rounded border border-edge bg-panel-raised text-[11.5px] whitespace-normal shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
          <span className="text-ink-soft">
            Battles · {battles.length} this turn
          </span>
          <span className="flex-1" />
          <button
            type="button"
            data-testid="battles-close"
            aria-label="close battles"
            autoFocus
            onClick={onDismiss}
            className="rounded px-1.5 text-ink-dim hover:text-ink"
          >
            ✕
          </button>
        </div>

        {battles.length === 0 ? (
          <p className="p-6 text-center text-ink-dim">This turn had no battles.</p>
        ) : (
          <div className="grid min-h-0 grid-cols-[19rem_1fr]">
            <ul
              data-testid="battles-list"
              className="min-h-0 overflow-y-auto border-r border-edge"
            >
              {battles.map((battle, index) => (
                <BattleRow
                  key={index}
                  battle={battle}
                  index={index}
                  selected={index === selectedIndex}
                  hexLabel={hexLabel}
                  onSelect={onSelect}
                />
              ))}
            </ul>
            {selected ? (
              <BattleDetail
                battle={selected}
                hexLabel={hexLabel}
                viewerFactionId={viewerFactionId}
                onShowOnMap={onShowOnMap}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function BattleRow({
  battle,
  index,
  selected,
  hexLabel,
  onSelect
}: {
  battle: Battle;
  index: number;
  selected: boolean;
  hexLabel: (regionId: string) => string;
  onSelect: (index: number) => void;
}) {
  const summary = summarise(battle, hexLabel);

  return (
    <li
      data-testid={`battle-row-${index}`}
      aria-selected={selected}
      className={`border-b border-edge-soft last:border-b-0 ${selected ? "bg-select/15" : ""}`}
    >
      <button
        type="button"
        onClick={() => onSelect(index)}
        className="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left"
      >
        <span className="text-ink">
          {summary.attacker && summary.defender ? (
            <>
              <span className="text-ink">{summary.attacker}</span>
              <span className="mx-1 text-ink-dim">→</span>
              <span className="text-ink">{summary.defender}</span>
            </>
          ) : (
            summary.headline
          )}
        </span>
        <span className="flex flex-wrap gap-2 text-ink-dim">
          {summary.hex ? <span>{summary.hex}</span> : null}
          {summary.attackerLosses !== null ? (
            <span>
              attacker <span className="text-ok">−{summary.attackerLosses}</span>
            </span>
          ) : null}
          {summary.defenderLosses !== null ? (
            <span>
              defender <span className="text-danger">−{summary.defenderLosses}</span>
            </span>
          ) : null}
          {summary.hasSpoils ? <span>spoils</span> : null}
        </span>
      </button>
    </li>
  );
}

function BattleDetail({
  battle,
  hexLabel,
  viewerFactionId,
  onShowOnMap
}: {
  battle: Battle;
  hexLabel: (regionId: string) => string;
  viewerFactionId: string | null;
  onShowOnMap: (regionId: string) => void;
}) {
  const summary = summarise(battle, hexLabel);
  const regionId = battle.coordinate ? regionIdOf(battle.coordinate) : null;

  return (
    <div data-testid="battle-detail" className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-ink">
          {summary.attacker && summary.defender
            ? `${summary.attacker} attacks ${summary.defender}`
            : summary.headline}
        </p>
        <p className="text-ink-dim">
          {[
            battle.terrain && summary.hex ? `in ${summary.hex}` : null,
            battle.province ? `in ${battle.province}` : null,
            `${battle.rounds.length} round${battle.rounds.length === 1 ? "" : "s"}`
          ]
            .filter(Boolean)
            .join(" · ")}
          {regionId ? (
            <>
              {" · "}
              <button
                type="button"
                data-testid="battles-show-on-map"
                onClick={() => onShowOnMap(regionId)}
                className="text-select underline decoration-dotted"
              >
                show on map
              </button>
            </>
          ) : null}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Roster label="Attackers" units={battle.attackers} viewerFactionId={viewerFactionId} />
        <Roster label="Defenders" units={battle.defenders} viewerFactionId={viewerFactionId} />
      </div>

      {battle.rounds.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-wide text-brass">Rounds</h3>
          {battle.rounds.map((round, index) => (
            <div key={index} className="flex flex-col gap-0.5 border-l-2 border-edge pl-2">
              <span className="text-[10px] uppercase tracking-wide text-brass">
                Round {round.number ?? index + 1}
              </span>
              {round.lines.map((line, lineIndex) => (
                <p key={lineIndex} className="text-ink-soft">
                  {line}
                </p>
              ))}
              {round.losses.length > 0 ? (
                <p className="text-danger">
                  {round.losses.map((loss) => loss.text).join(" · ")}
                </p>
              ) : null}
              <StatisticsDisclosure label="Round" number={round.number ?? index + 1} lines={round.statistics} />
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-wide text-brass">Outcome</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-ink-soft">Casualties</dt>
          <dd className="text-ink">{battle.casualties.map((entry) => entry.text).join(" · ")}</dd>
          {battle.damagedUnits.length > 0 ? (
            <>
              <dt className="text-ink-soft">Damaged</dt>
              <dd className="text-ink">{battle.damagedUnits.join(", ")}</dd>
            </>
          ) : null}
          {battle.spoils ? (
            <>
              <dt className="text-ink-soft">Spoils</dt>
              <dd className="text-ok">{battle.spoils}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <StatisticsDisclosure label="Battle" lines={battle.statistics} />
    </div>
  );
}

function Roster({
  label,
  units,
  viewerFactionId
}: {
  label: string;
  units: BattleUnit[];
  viewerFactionId: string | null;
}) {
  const counts = rosterCounts(units, viewerFactionId);

  return (
    <div className="flex min-h-0 flex-col gap-1">
      <h3 className="text-[10px] uppercase tracking-wide text-brass">
        {label} <span className="text-ink-dim">{counts.total}</span>
        {counts.own > 0 ? <span className="text-ink-dim"> · {counts.own} yours</span> : null}
      </h3>
      <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded border border-edge-soft bg-panel p-1.5">
        {units.map((unit) => {
          const allegiance = allegianceOf(unit, viewerFactionId);
          return (
            <li
              key={unit.id}
              className="flex items-baseline gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap"
            >
              <span
                className={
                  allegiance === "own" ? "text-brass-bright" : "text-ink"
                }
              >
                {unit.name} ({unit.id})
              </span>
              <span className="text-ink-dim">
                {unit.faction ? `${unit.faction.name} (${unit.faction.id})` : "faction not shown"}
              </span>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-ink-dim">
                {unit.body}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The round or battle statistics block: folded away by default, saying how much it holds. */
function StatisticsDisclosure({
  label,
  number,
  lines
}: {
  label: "Round" | "Battle";
  number?: number;
  lines: string[];
}) {
  if (lines.length === 0) {
    return null;
  }
  const heading = label === "Round" ? `Round ${number} statistics` : "Battle statistics";
  return (
    <details
      className="text-ink-dim"
      data-testid={label === "Round" ? `round-statistics-${number}` : "battle-statistics"}
    >
      <summary className="cursor-pointer">
        {heading} ({lines.length} line{lines.length === 1 ? "" : "s"})
      </summary>
      <div className="mt-1 flex flex-col gap-0.5 pl-2">
        {lines.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
    </details>
  );
}
