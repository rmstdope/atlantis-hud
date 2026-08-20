import { useEffect, useMemo, useRef, useState } from "react";
import {
  GAME_DATA_CATEGORIES,
  GAME_DATA_CATEGORY_LABELS,
  type GameDataDetail,
  type GameDataIndex,
  type GameDataLink,
  skillEntryId
} from "../gameData";
import { paletteKeyReduce } from "../commandPalette";
import { useEscapeToDismiss } from "./dismissLayer";
import {
  entriesOf,
  goBack,
  openGameDataDialog,
  selectGameDataEntry,
  selectGameDataTab
} from "./gameDataDialogState";

/**
 * The game data dictionary: every skill, man, mount, ship, monster, item and structure the rules
 * pages were scraped for, in seven lists with the chosen one read out beside them.
 *
 * `docs/ui/ah-5jkt-dictionary.html` is the design, chosen with the navigator: a type selector
 * rather than one long list, because nine ships and four mounts are answerable by looking while
 * one hundred and seventy-one items are not. Opened from the command palette, and - once
 * `ah-5jkt.2` lands - from a named thing in a pane, which is why it can be told where to land.
 *
 * Everything it remembers dies with it. A reference dialog's scroll position is not worth a store.
 */
export function GameDataDialog({
  index,
  initialEntryId,
  onDismiss
}: {
  index: GameDataIndex;
  /** Where to land. null opens on the first tab's first entry. */
  initialEntryId: string | null;
  onDismiss: () => void;
}) {
  useEscapeToDismiss(onDismiss);

  const [state, setState] = useState(() => openGameDataDialog(index, initialEntryId));

  // Focus returns where it was summoned from, for the reason `ShortcutHelp` documents: this opens
  // from the command palette, which itself opens from the orders editor, and without the return
  // trip dismissing it would leave the caret nowhere.
  const summonedFrom = useRef<Element | null>(null);
  if (summonedFrom.current === null) {
    summonedFrom.current = typeof document === "undefined" ? null : document.activeElement;
  }
  useEffect(() => {
    return () => {
      const current = document.activeElement;
      if (
        (current === null || current === document.body) &&
        summonedFrom.current instanceof HTMLElement
      ) {
        summonedFrom.current.focus();
      }
    };
  }, []);

  const shown = useMemo(
    () => entriesOf(index, state.category, state.filter),
    [index, state.category, state.filter]
  );
  const detail = state.selectedId === null ? null : index.detailOf(state.selectedId);
  const returnsTo = state.back[state.back.length - 1];
  const returnsToName =
    returnsTo === undefined ? null : (index.byId.get(returnsTo)?.name ?? returnsTo);

  const follow = (entryId: string) =>
    setState((current) => selectGameDataEntry(index, current, entryId, { push: true }));

  const moveWithin = (key: string) => {
    const at = shown.findIndex((entry) => entry.id === state.selectedId);
    const next = paletteKeyReduce({ index: at === -1 ? 0 : at, count: shown.length }, key);
    if (next === null) {
      return false;
    }
    const entry = shown[next];
    if (entry !== undefined) {
      setState((current) => selectGameDataEntry(index, current, entry.id, { push: false }));
    }
    return true;
  };

  const stepTab = (by: number) => {
    const at = GAME_DATA_CATEGORIES.indexOf(state.category);
    const next =
      GAME_DATA_CATEGORIES[
        (at + by + GAME_DATA_CATEGORIES.length) % GAME_DATA_CATEGORIES.length
      ];
    setState((current) => selectGameDataTab(index, current, next));
  };

  return (
    <div
      data-testid="game-data-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[10vh]"
    >
      <div
        data-testid="game-data-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Game data"
        className="grid max-h-[85vh] w-[56rem] max-w-[94vw] grid-rows-[auto_auto_1fr] rounded border border-edge bg-panel-raised text-pane whitespace-normal shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
          <span className="text-ink-soft">Game data</span>
          <span className="flex-1" />
          {returnsTo === undefined ? null : (
            <button
              type="button"
              data-testid="game-data-back"
              onClick={() => setState((current) => goBack(index, current))}
              className="rounded px-1.5 text-ink-dim hover:text-ink"
            >
              ← Back to {returnsToName}
            </button>
          )}
          <button
            type="button"
            data-testid="game-data-close"
            onClick={onDismiss}
            className="rounded px-1.5 text-ink-dim hover:text-ink"
          >
            Close
          </button>
        </div>

        <div role="tablist" aria-label="Game data" className="flex gap-1 border-b border-edge px-2 py-1">
          {GAME_DATA_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              role="tab"
              data-testid={`game-data-tab-${category}`}
              aria-selected={category === state.category}
              onClick={() => setState((current) => selectGameDataTab(index, current, category))}
              className={
                category === state.category
                  ? "rounded px-2 py-0.5 bg-panel text-ink"
                  : "rounded px-2 py-0.5 text-ink-dim hover:text-ink"
              }
            >
              {GAME_DATA_CATEGORY_LABELS[category]} {entriesOf(index, category).length}
            </button>
          ))}
        </div>

        <div className="grid min-h-0 grid-cols-[15rem_1fr]">
          <div className="grid min-h-0 grid-rows-[auto_1fr] border-r border-edge">
            <input
              type="search"
              autoFocus
              data-testid="game-data-filter"
              aria-label={`Filter ${GAME_DATA_CATEGORY_LABELS[state.category].toLowerCase()}`}
              placeholder={`Filter ${GAME_DATA_CATEGORY_LABELS[state.category].toLowerCase()}…`}
              value={state.filter}
              onChange={(event) =>
                setState((current) => ({ ...current, filter: event.target.value }))
              }
              onKeyDown={(event) => {
                // Left and Right change tab, as agreed - but only with nothing typed, because
                // focus opens here and a filter you cannot move the caret inside is worse than
                // one more Tab press to reach the strip.
                if (
                  (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
                  state.filter === ""
                ) {
                  event.preventDefault();
                  stepTab(event.key === "ArrowLeft" ? -1 : 1);
                  return;
                }
                if (moveWithin(event.key)) {
                  event.preventDefault();
                }
              }}
              className="w-full border-b border-edge bg-transparent px-2 py-1 outline-none"
            />
            <ul
              data-testid="game-data-list"
              role="listbox"
              aria-label={GAME_DATA_CATEGORY_LABELS[state.category]}
              className="min-h-0 overflow-y-auto"
            >
              {shown.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    role="option"
                    data-testid={`game-data-entry-${entry.id}`}
                    aria-selected={entry.id === state.selectedId}
                    onClick={() =>
                      setState((current) =>
                        selectGameDataEntry(index, current, entry.id, { push: false })
                      )
                    }
                    className={
                      entry.id === state.selectedId
                        ? "w-full px-2 py-0.5 text-left bg-panel text-ink"
                        : "w-full px-2 py-0.5 text-left text-ink-soft hover:text-ink"
                    }
                  >
                    {entry.tag === null ? entry.name : `${entry.name} ${entry.tag}`}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div data-testid="game-data-detail" className="min-h-0 overflow-y-auto p-3">
            {detail === null ? (
              <p className="text-ink-dim">Nothing to show.</p>
            ) : (
              <Detail detail={detail} index={index} onFollow={follow} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-40 shrink-0 text-ink-dim">{label}</span>
      <span className="text-ink">{children}</span>
    </div>
  );
}

function Links({
  title,
  links,
  empty,
  onFollow
}: {
  title: string;
  links: readonly GameDataLink[];
  empty: string;
  onFollow: (id: string) => void;
}) {
  return (
    <section className="mt-3">
      <h3 className="text-ink-soft">{title}</h3>
      {links.length === 0 ? (
        <p className="text-ink-dim">{empty}</p>
      ) : (
        <ul>
          {links.map((link) => (
            <li key={`${link.id}-${link.level}`} className="flex justify-between gap-2">
              <button
                type="button"
                data-testid={`game-data-link-${link.id}`}
                onClick={() => onFollow(link.id)}
                className="text-left text-accent hover:underline"
              >
                {link.name}
              </button>
              <span className="text-ink-dim">at level {link.level}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The skill that builds this, as a dictionary entry rather than a tag.
 *
 * `buildSkill` is stored as the ruleset's tag - `BUIL`, `MINI` - so it has to be looked up against
 * the skills the dictionary already holds. Null when the structure is not buildable, and also when
 * the tag names a skill the dictionary does not carry: a link that goes nowhere is worse than a
 * plain number, and the level alone would be meaningless without the skill's name.
 */
function buildSkillEntry(
  index: GameDataIndex,
  buildSkill: string | null
): { id: string; name: string } | null {
  if (buildSkill === null) {
    return null;
  }
  const id = skillEntryId(buildSkill);
  const entry = index.byId.get(id);
  return entry === undefined ? null : { id, name: entry.name };
}

function Detail({
  detail,
  index,
  onFollow
}: {
  detail: GameDataDetail;
  index: GameDataIndex;
  onFollow: (id: string) => void;
}) {
  const heading = (
    <h2 className="text-ink">
      {detail.entry.name}
      {detail.entry.tag === null ? null : <span className="text-ink-dim"> {detail.entry.tag}</span>}
    </h2>
  );

  if (detail.kind === "absent") {
    return (
      <div>
        {heading}
        <p className="mt-2 text-ink-dim">The game data does not describe this.</p>
      </div>
    );
  }

  if (detail.kind === "skill") {
    return (
      <div>
        {heading}
        {detail.description === null ? null : <p className="mt-2 text-ink">{detail.description}</p>}
        <div className="mt-3 grid gap-0.5">
          <Field label="Study cost">
            {detail.cost === null ? "not priced" : `${detail.cost} silver per man per month`}
          </Field>
          <Field label="Highest level">{detail.maxLevel}</Field>
          <Field label="Magic">{detail.magic ? "yes" : "no"}</Field>
        </div>
        <Links title="Produces" links={detail.produces} empty="nothing" onFollow={onFollow} />
        <Links
          title="Requires"
          links={detail.requires}
          empty="nothing — it can be studied from the start"
          onFollow={onFollow}
        />
        {detail.levels.length === 0 ? null : (
          <section className="mt-3">
            <h3 className="text-ink-soft">What it does</h3>
            {detail.levels.map((level) => (
              <p key={level.level} className="mt-1">
                <span className="text-ink-dim">Level {level.level}. </span>
                <span className="text-ink">{level.description}</span>
              </p>
            ))}
          </section>
        )}
      </div>
    );
  }

  if (detail.kind === "building") {
    // 36 of the 58 buildings carry this; a lair or a ruin is not buildable and says nothing
    // (ah-rpnb). "Built with" rather than "Requires", which already means a *skill's* own
    // prerequisites in this dialog.
    const buildWith = buildSkillEntry(index, detail.buildSkill);
    return (
      <div>
        {heading}
        {detail.description === null ? null : <p className="mt-2 text-ink">{detail.description}</p>}
        <div className="mt-3 grid gap-0.5">
          {detail.size === null ? null : <Field label="Protects">{detail.size} men</Field>}
          {detail.cost === null ? null : <Field label="Building cost">{detail.cost}</Field>}
          {detail.materials.length === 0 ? null : (
            <Field label="Materials">{detail.materials.join(", ")}</Field>
          )}
          {buildWith === null ? null : (
            <Field label="Built with">
              <button
                type="button"
                data-testid={`game-data-link-${buildWith.id}`}
                onClick={() => onFollow(buildWith.id)}
                className="text-left text-accent hover:underline"
              >
                {buildWith.name}
              </button>
              {detail.buildLevel === null ? null : ` ${detail.buildLevel}`}
            </Field>
          )}
          {detail.produces === null ? null : <Field label="Increases">{detail.produces}</Field>}
          {/* A capacity, not a prerequisite: how many mages the structure houses, which is what
              the magic-study warning reads it for. It used to say "Mages needed", which invented a
              requirement (ah-q3o1). Omitted at zero like every other field here — about fifty of
              the fifty-eight buildings shelter none, and after ah-3cj4.1 a zero is a fact rather
              than missing data, so silence means "none" rather than "unknown". */}
          {detail.mages === 0 ? null : <Field label="Mages sheltered">{detail.mages}</Field>}
        </div>
      </div>
    );
  }

  const modes = (["walk", "ride", "fly", "swim"] as const).filter((mode) => detail.selfMobile[mode]);
  return (
    <div>
      {heading}
      {detail.description === null ? null : <p className="mt-2 text-ink">{detail.description}</p>}
      <div className="mt-3 grid gap-0.5">
        <Field label="Weight">{detail.weight}</Field>
        <Field label="Moves">{detail.moves} hexes a month</Field>
        <Field label="Carries">
          {detail.capacity.walk} walking · {detail.capacity.ride} riding · {detail.capacity.fly}{" "}
          flying · {detail.capacity.swim} swimming
        </Field>
        {detail.capacityCondition === null ? null : (
          <Field label="Only when">{detail.capacityCondition}</Field>
        )}
        <Field label="Moves itself">{modes.length === 0 ? "not at all" : modes.join(", ")}</Field>
        {detail.cargoCapacity === null ? null : (
          <Field label="Cargo capacity">{detail.cargoCapacity}</Field>
        )}
        {detail.sailingSkill === null ? null : (
          <Field label="Sailing skill needed">{detail.sailingSkill}</Field>
        )}
      </div>
      {detail.combat === null ? null : (
        <section className="mt-3">
          <h3 className="text-ink-soft">Combat</h3>
          <div className="grid gap-0.5">
            <Field label="Skill">{detail.combat.skill}</Field>
            <Field label="Attacks a round">{detail.combat.attacksPerRound}</Field>
            <Field label="Hits to kill">{detail.combat.hitsToKill}</Field>
            <Field label="Damage an attack">{detail.combat.damagePerAttack}</Field>
          </div>
        </section>
      )}
      <Links title="Produced by" links={detail.producedBy} empty="nothing" onFollow={onFollow} />
    </div>
  );
}
