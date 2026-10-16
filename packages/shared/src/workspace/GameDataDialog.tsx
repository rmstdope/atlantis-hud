import { useEffect, useMemo, useRef, useState } from "react";
import {
  GAME_DATA_CATEGORY_LABELS,
  GAME_DATA_KIND_WORDS,
  type GameDataDetail,
  type GameDataEntry,
  type GameDataIndex,
  type GameDataLink,
  type GameDataReference,
  skillEntryId,
  type TerrainResourceLink
} from "../gameData";
import { NO_RECRUIT_SIGHTINGS, racesSeenIn, type RecruitSightings } from "../recruitSightings";
import { DialogFrame } from "./DialogFrame";
import {
  ALONG_A_ROAD_LABEL,
  FOUND_HERE_HEADING,
  FOUND_HERE_NOT_SAID,
  FOUND_IN_HEADING,
  frequencyText,
  MOVEMENT_COST_LABEL,
  movementCostText,
  NO_MONSTER_ROAMS_HERE,
  ROAMING_MONSTERS_HEADING,
  ROAMS_LABEL,
  SEEN_FOR_SALE_HEADING,
  seenForSaleCountText,
  seenForSaleEmptyText
} from "./gameDataTerrainText";
import {
  entriesOf,
  filterGameData,
  GAME_DATA_TABS,
  gameDataMove,
  type GameDataTab,
  goBack,
  openGameDataDialog,
  selectGameDataEntry,
  selectGameDataTab,
  stepGameDataTab,
  tabLabel
} from "./gameDataDialogState";
import { orderMentions } from "./gameDataOrderText";

/**
 * The game data dictionary: every skill, man, mount, ship, monster, item, structure, terrain and
 * order the rules pages were scraped for, in nine lists - and All, every list at once (ah-yu3j.2) - with
 * the chosen one read out beside them.
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
  recruits = NO_RECRUIT_SIGHTINGS,
  onDismiss
}: {
  index: GameDataIndex;
  /** Where to land. null is a cold open: the All tab, on its first entry (ah-yu3j.2). */
  initialEntryId: string | null;
  /**
   * Every race the loaded turns saw for sale, by region, for a terrain page's "Seen for sale in
   * your reports" (ah-yu3j.1) - the one part of this dialog read from reports, not game data.
   */
  recruits?: RecruitSightings;
  onDismiss: () => void;
}) {
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
    () => entriesOf(index, state.tab, state.filter),
    [index, state.tab, state.filter]
  );
  const detail = state.selectedId === null ? null : index.detailOf(state.selectedId);
  const returnsTo = state.back[state.back.length - 1];
  const returnsToName =
    returnsTo === undefined ? null : (index.byId.get(returnsTo)?.name ?? returnsTo);

  const follow = (entryId: string) =>
    setState((current) => selectGameDataEntry(index, current, entryId, { push: true }));

  const moveWithin = (key: string) => {
    const at = shown.findIndex((entry) => entry.id === state.selectedId);
    const next = gameDataMove(at, shown.length, key);
    if (next === null) {
      return false;
    }
    const entry = shown[next];
    if (entry !== undefined) {
      setState((current) => selectGameDataEntry(index, current, entry.id, { push: false }));
    }
    return true;
  };

  // The selected row is scrolled into view whenever the selection changes (ah-vwdi). `block:
  // "nearest"` scrolls only when the row is actually off screen, so stepping between visible rows
  // does not jog the list. The palette's `byKeyboard` guard is deliberately NOT copied: it exists
  // there because selection follows the pointer, which this dialog does not do - and it would
  // suppress the one case that most wants scrolling, following a cross-reference to an entry far
  // down the list.
  const list = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    if (state.selectedId === null) {
      return;
    }
    const row = list.current?.querySelector(
      `[data-testid="game-data-entry-${CSS.escape(state.selectedId)}"]`
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [state.selectedId]);

  const stepTab = (by: number) => {
    const next = stepGameDataTab(state.tab, by);
    setState((current) => selectGameDataTab(index, current, next));
  };

  const filterLabel =
    state.tab === "all"
      ? "Filter everything…"
      : `Filter ${GAME_DATA_CATEGORY_LABELS[state.tab].toLowerCase()}`;

  return (
    <DialogFrame
      label="Game data"
      onDismiss={onDismiss}
      layer="z-40"
      placement="top"
      backdropTestId="game-data-backdrop"
      testId="game-data-dialog"
      // 10vh below, matching the frame's `top` placement (ah-vwdi). The two must be changed together:
      // top offset + max height must leave a real margin, or the dialog runs to the screen edge.
      // theme.css caps every modal at 90vh, but as a `:where()` default at zero specificity
      // (ah-y4zb) - so this 80vh simply wins, with no `!` needed. Left uncapped, 10vh + 90vh is
      // the whole window and the margin below is exactly zero.
      boxClassName="grid max-h-[80vh] w-[56rem] max-w-[94vw] grid-rows-[auto_auto_1fr] rounded border border-brass/60 bg-panel-raised text-pane whitespace-normal shadow-xl"
      barClassName="items-center gap-2 border-b border-edge px-2 py-1.5"
      close={{ testId: "game-data-close", label: "Close game data", look: "compact" }}
      bar={
        <>
          <span className="text-brass">Game data</span>
          <span className="flex-1" />
          {returnsTo === undefined ? null : (
            <button
              type="button"
              data-testid="game-data-back"
              onClick={() => setState((current) => goBack(index, current))}
              className="rounded border border-select px-1.5 text-select hover:bg-select/15"
            >
              ← Back to {returnsToName}
            </button>
          )}
        </>
      }
    >
      {/* Wraps in a narrow window, each tab whole (ah-yu3j.1): nine no longer fit in one line. */}
      <div role="tablist" aria-label="Game data" className="flex flex-wrap gap-1 border-b border-edge bg-panel px-2 py-1">
        {GAME_DATA_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            data-testid={`game-data-tab-${tab}`}
            aria-selected={tab === state.tab}
            onClick={() => setState((current) => selectGameDataTab(index, current, tab))}
            className={
              tab === state.tab
                ? "rounded border border-brass bg-brass/10 px-2 py-0.5 text-brass"
                : "rounded border border-edge bg-panel-raised px-2 py-0.5 text-ink-dim hover:bg-panel hover:text-ink"
            }
          >
            {`${tabLabel(tab)} ${tab === "all" ? index.entries.length : entriesOf(index, tab).length}`}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 grid-cols-[15rem_1fr]">
        <div className="grid min-h-0 grid-rows-[auto_1fr] border-r border-edge bg-panel">
          <input
            type="search"
            autoFocus
            data-testid="game-data-filter"
            // On All both read "Filter everything…", ellipsis included: the accessible name is
            // agreed verbatim in ah-yu3j.2's acceptance. The category tabs keep theirs.
            aria-label={filterLabel}
            placeholder={state.tab === "all" ? filterLabel : `${filterLabel}…`}
            value={state.filter}
            onChange={(event) =>
              setState((current) => filterGameData(index, current, event.target.value))
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
            className="w-full border-b border-brass/60 bg-panel-raised px-2 py-1 text-ink outline-none placeholder:text-ink-dim"
          />
          <GameDataList
            tab={state.tab}
            entries={shown}
            filter={state.filter}
            selectedId={state.selectedId}
            listRef={list}
            onPick={(entryId) =>
              setState((current) =>
                selectGameDataEntry(index, current, entryId, { push: false })
              )
            }
          />
        </div>
        <div data-testid="game-data-detail" className="min-h-0 overflow-y-auto p-3">
          {detail === null ? (
            <div className="rounded border border-edge bg-panel-raised p-3">
              <p className="m-0 text-ink-dim">Nothing to show.</p>
            </div>
          ) : (
            <Detail detail={detail} index={index} recruits={recruits} onFollow={follow} />
          )}
        </div>
      </div>
    </DialogFrame>
  );
}

/**
 * The list beside the filter. Its own component so its markup - the kind word, the no-match line -
 * can be pinned by a static render, since this package has no jsdom to type into a filter with.
 *
 * On All a row carries its kind word at the right of its first line, and a long name wraps rather
 * than being cut short, both agreed for ah-yu3j.2. The category tabs' rows are as they were.
 */
export function GameDataList({
  tab,
  entries,
  filter,
  selectedId,
  listRef,
  onPick
}: {
  tab: GameDataTab;
  entries: readonly GameDataEntry[];
  filter: string;
  selectedId: string | null;
  listRef?: React.Ref<HTMLUListElement>;
  onPick: (entryId: string) => void;
}) {
  const typed = filter.trim();
  return (
    <ul
      ref={listRef}
      data-testid="game-data-list"
      role="listbox"
      aria-label={tabLabel(tab)}
      className="min-h-0 overflow-y-auto"
    >
      {tab === "all" && entries.length === 0 && typed !== "" ? (
        // An option a screen reader can land on, rather than an empty listbox: this line's whole
        // job is to be read.
        <li
          role="option"
          aria-disabled="true"
          aria-selected="false"
          data-testid="game-data-no-match"
          className="px-2 py-1 italic text-ink-dim"
        >
          {`Nothing matches “${typed}”.`}
        </li>
      ) : null}
      {entries.map((entry) => {
        const name = entry.tag === null ? entry.name : `${entry.name} ${entry.tag}`;
        const selected = entry.id === selectedId;
        return (
          <li key={entry.id}>
            <button
              type="button"
              role="option"
              data-testid={`game-data-entry-${entry.id}`}
              aria-selected={selected}
              onClick={() => onPick(entry.id)}
              className={
                (selected
                  ? "w-full border-l-2 border-select bg-select/15 px-2 py-0.5 text-left text-ink"
                  : "w-full border-l-2 border-transparent px-2 py-0.5 text-left text-ink-soft hover:bg-select/15 hover:text-ink") +
                (tab === "all" ? " flex items-baseline gap-1.5" : "")
              }
            >
              {tab === "all" ? (
                <>
                  <span className="min-w-0 break-words">{name}</span>
                  <span className="ml-auto shrink-0 text-pane-xs uppercase tracking-[0.08em] text-ink-dim">
                    {GAME_DATA_KIND_WORDS[entry.category]}
                  </span>
                </>
              ) : (
                name
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded border border-edge bg-panel px-2 py-1">
      <span className="w-40 shrink-0 text-pane-xs uppercase tracking-[0.08em] text-brass">{label}</span>
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
      <h3 className="mb-1 border-b border-brass/60 pb-1 text-pane-xs uppercase tracking-[0.08em] text-brass">{title}</h3>
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

const SECTION_HEADING =
  "mb-1 border-b border-brass/60 pb-1 text-pane-xs uppercase tracking-[0.08em] text-brass";

/** A clickable name, the same look and test id as every other cross-reference here. */
function FollowLink({
  reference,
  onFollow
}: {
  reference: GameDataReference;
  onFollow: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`game-data-link-${reference.id}`}
      onClick={() => onFollow(reference.id)}
      className="text-left text-accent hover:underline"
    >
      {reference.name}
    </button>
  );
}

/**
 * A titled list of names, each followed by a dim note - `Links`' shape with free text where it
 * says `at level N`. `empty` is the line shown when there are none.
 */
function NotedLinks({
  title,
  rows,
  empty,
  onFollow
}: {
  title: string;
  rows: readonly { reference: GameDataReference; note: string | null }[];
  empty: string;
  onFollow: (id: string) => void;
}) {
  return (
    <section className="mt-3">
      <h3 className={SECTION_HEADING}>{title}</h3>
      {rows.length === 0 ? (
        <p className="text-ink-dim">{empty}</p>
      ) : (
        <ul>
          {rows.map(({ reference, note }) => (
            <li key={reference.id} className="flex justify-between gap-2">
              <FollowLink reference={reference} onFollow={onFollow} />
              {note === null ? null : <span className="text-ink-dim">{note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A resource or terrain with how often, for `NotedLinks`. */
function byFrequency(links: readonly TerrainResourceLink[]) {
  return links.map((link) => ({ reference: link, note: frequencyText(link.chance) }));
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

/**
 * Text that may mention other orders, each mention a link (`orderMentions`). The orders are the
 * index's own, so only a keyword the world's grammar lists is ever linked.
 */
function OrderText({
  text,
  orders,
  self,
  onFollow
}: {
  text: string;
  orders: ReadonlySet<string>;
  self: string;
  onFollow: (id: string) => void;
}) {
  return (
    <>
      {orderMentions(text, orders, self).map((part, at) =>
        "entryId" in part ? (
          <FollowLink key={at} reference={{ id: part.entryId, name: part.text }} onFollow={onFollow} />
        ) : (
          <span key={at}>{part.text}</span>
        )
      )}
    </>
  );
}

/**
 * Wrapped rather than scrolled sideways in a narrow window, each line's continuation indented two
 * characters so the start of every form stays visible (agreed for ah-mlls.6).
 */
const ORDER_LINE = "m-0 whitespace-pre-wrap break-words pl-[2ch] -indent-[2ch] font-mono";

/**
 * An order as the rules write it (`docs/ui/ah-mlls.6-orders-in-game-data.html`): every form, the
 * prose, then the examples - in full, nothing collapsed. Examples are left out when there are none.
 */
function OrderDetail({
  detail,
  heading,
  index,
  onFollow
}: {
  detail: Extract<GameDataDetail, { kind: "order" }>;
  heading: React.ReactNode;
  index: GameDataIndex;
  onFollow: (id: string) => void;
}) {
  const orders = new Set(
    index.entries.filter((entry) => entry.category === "order").map((entry) => entry.name)
  );
  const self = detail.entry.name;
  return (
    <div>
      {heading}
      <section className="mt-3">
        <h3 className={SECTION_HEADING}>Syntax</h3>
        <div className="rounded border border-edge bg-panel px-2 py-1 text-ink">
          {detail.forms.map((form, at) => (
            <p key={at} data-testid="game-data-order-form" className={ORDER_LINE}>
              {form}
            </p>
          ))}
        </div>
      </section>
      <section className="mt-3">
        <h3 className={SECTION_HEADING}>What it does</h3>
        {detail.description.map((paragraph, at) => (
          <p key={at} className="mt-1 text-ink">
            <OrderText text={paragraph} orders={orders} self={self} onFollow={onFollow} />
          </p>
        ))}
      </section>
      {detail.examples.length === 0 ? null : (
        <section className="mt-3">
          <h3 className={SECTION_HEADING}>Examples</h3>
          {detail.examples.map((example, at) => (
            <div key={at} data-testid="game-data-order-example" className="mt-2">
              <p className="m-0 text-ink">
                <OrderText text={example.text} orders={orders} self={self} onFollow={onFollow} />
              </p>
              {example.order === null ? null : (
                // One element per line, not one block: a hanging indent only ever hangs a block's
                // first line, and FORM's example nests orders under it by indentation.
                <div
                  data-testid="game-data-order-line"
                  className="mt-1 rounded border border-edge bg-panel px-2 py-1 text-ink"
                >
                  {example.order.split("\n").map((line, row) => (
                    <p key={row} className={ORDER_LINE}>
                      {line === "" ? "\u00a0" : line}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Detail({
  detail,
  index,
  recruits,
  onFollow
}: {
  detail: GameDataDetail;
  index: GameDataIndex;
  recruits: RecruitSightings;
  onFollow: (id: string) => void;
}) {
  const heading = (
    <h2 className="m-0 flex items-center gap-2 rounded border border-brass/60 bg-brass/10 px-2 py-1 text-brass">
      <span className="flex-1">{detail.entry.name}</span>
      {detail.entry.tag === null ? null : (
        <span className="rounded border border-brass/60 px-1 text-pane-xs">{detail.entry.tag}</span>
      )}
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

  if (detail.kind === "order") {
    return <OrderDetail detail={detail} heading={heading} index={index} onFollow={onFollow} />;
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
            <h3 className="mb-1 border-b border-brass/60 pb-1 text-pane-xs uppercase tracking-[0.08em] text-brass">What it does</h3>
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

  if (detail.kind === "terrain") {
    // `docs/ui/ah-yu3j.1-terrains.html`: heading, two fields, three sections, top to bottom.
    const terrain = detail.entry.name;
    return (
      <div>
        {heading}
        {detail.movement === null ? null : (
          <div className="mt-3 grid gap-0.5">
            <Field label={MOVEMENT_COST_LABEL}>{movementCostText(detail.movement)}</Field>
            {detail.road === null ? null : <Field label={ALONG_A_ROAD_LABEL}>{detail.road}</Field>}
          </div>
        )}
        {detail.foundHere === null ? (
          <section className="mt-3">
            <h3 className={SECTION_HEADING}>{FOUND_HERE_HEADING}</h3>
            <p className="text-ink-dim">{FOUND_HERE_NOT_SAID}</p>
          </section>
        ) : (
          // An empty row is a table that says nothing is found; the not-said line is only for a
          // terrain the table does not cover, so this reuses it rather than inventing a third line.
          <NotedLinks
            title={FOUND_HERE_HEADING}
            rows={byFrequency(detail.foundHere)}
            empty={FOUND_HERE_NOT_SAID}
            onFollow={onFollow}
          />
        )}
        <NotedLinks
          title={SEEN_FOR_SALE_HEADING}
          rows={racesSeenIn(recruits, terrain, index).map((race) => ({
            reference: race,
            note: seenForSaleCountText(race.regions, terrain)
          }))}
          empty={seenForSaleEmptyText(terrain)}
          onFollow={onFollow}
        />
        <NotedLinks
          title={ROAMING_MONSTERS_HEADING}
          rows={detail.roamingMonsters.map((monster) => ({ reference: monster, note: null }))}
          empty={NO_MONSTER_ROAMS_HERE}
          onFollow={onFollow}
        />
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
        {/* Left out for anything whose description names no terrain (ah-yu3j.1). */}
        {detail.roams.length === 0 ? null : (
          <Field label={ROAMS_LABEL}>
            {detail.roams.map((terrain, at) => (
              <span key={terrain.id}>
                {at === 0 ? null : ", "}
                <FollowLink reference={terrain} onFollow={onFollow} />
              </span>
            ))}
          </Field>
        )}
      </div>
      {detail.combat === null ? null : (
        <section className="mt-3">
          <h3 className="mb-1 border-b border-brass/60 pb-1 text-pane-xs uppercase tracking-[0.08em] text-brass">Combat</h3>
          <div className="grid gap-0.5">
            <Field label="Skill">{detail.combat.skill}</Field>
            <Field label="Attacks a round">{detail.combat.attacksPerRound}</Field>
            <Field label="Hits to kill">{detail.combat.hitsToKill}</Field>
            <Field label="Damage an attack">{detail.combat.damagePerAttack}</Field>
          </div>
        </section>
      )}
      <Links title="Produced by" links={detail.producedBy} empty="nothing" onFollow={onFollow} />
      {/* Most items are found in no terrain, and their pages stay as they were (ah-yu3j.1). */}
      {detail.foundIn.length === 0 ? null : (
        <NotedLinks
          title={FOUND_IN_HEADING}
          rows={byFrequency(detail.foundIn)}
          empty=""
          onFollow={onFollow}
        />
      )}
    </div>
  );
}
