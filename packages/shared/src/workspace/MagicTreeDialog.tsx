import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MageStanding, SkillStanding, StandingKind } from "../magicStanding";
import type { MagicBranch, MagicPrerequisite, MagicSkillNode, MagicTree } from "../magicTree";
import { useEscapeToDismiss } from "./dismissLayer";
import { MagePicker } from "./MagePicker";
import { buildMagicGraph, type MagicTreeView } from "./magicGraphLayout";
import { MagicGraphView, type MagicGraphHandle } from "./MagicGraphView";
import type { Viewport } from "./mapViewport";

/**
 * The magic study tree: all seventy magic skills grouped into branch cards, so what a skill needs
 * before it can be studied is answerable inside the application rather than only in the rules text.
 *
 * Two views of the same seventy skills, chosen from the header. `docs/ui/ah-gjbs-shape-branches.html`
 * is the branch cards; `docs/ui/ah-gjbs.2-whole-graph.html` is the whole graph, the honest drawing
 * of a DAG thirty-eight skills wide in its middle tier, which cannot reflow and so always needs
 * panning. The box grows for the graph and shrinks back for the cards - decided with the navigator
 * knowing that the resize is visible.
 *
 * **One current skill across both views**, held here in `highlighted`: light a skill in the graph
 * and Branches opens scrolled to its row; follow a crossing chip in Branches and the graph comes up
 * centred on it. The view choice and the graph's pan and zoom live above this component, in
 * `AppShell`, because they outlive the dialog; the light does not, and dies with it.
 *
 * **Tinted for one mage at a time** (`ah-67h8`), whenever a report is loaded: every skill says
 * whether he knows it and can still raise it, knows it and is stuck, has it at the game's
 * maximum, may begin it now, or cannot begin it at all. Both views are tinted from the same
 * `SkillStanding`s, so the toggle never changes what you are told, only how it is drawn. With no
 * report the tree is the untinted reference page `ah-gjbs.1` ships.
 *
 * The frame - the backdrop, the
 * dismiss guard and the two heights that must move together - is `GameDataDialog`'s, on purpose:
 * the two reference dialogs should not drift apart.
 */
export function MagicTreeDialog({
  tree,
  initialTag,
  view,
  onView,
  graphViewport,
  onGraphViewport,
  onOpenGameData,
  onDismiss,
  mages = [],
  picked = null,
  onPick,
  label = (regionId) => regionId,
  reportLoaded = false
}: {
  tree: MagicTree;
  /** The skill to scroll to and pick out, or null to open at the top. */
  initialTag: string | null;
  /** Which view is showing. Lives in `AppShell` so it outlives the dialog. */
  view: MagicTreeView;
  onView: (view: MagicTreeView) => void;
  /** The graph's pan and zoom, or null before it has ever been placed. Also `AppShell`'s. */
  graphViewport: Viewport | null;
  onGraphViewport: (viewport: Viewport) => void;
  /** Opens a skill in the game data dictionary. */
  onOpenGameData: (entryId: string) => void;
  onDismiss: () => void;
  /** The faction's mages, adepts first. Empty when no report is loaded or none has studied magic. */
  mages?: readonly MageStanding[];
  /** The mage the tree is tinted for, or null for the untinted reference page. */
  picked?: MageStanding | null;
  onPick?: (unitId: string) => void;
  /** How a region id reads to a player. `AppShell`'s `hexLabel`. */
  label?: (regionId: string) => string;
  /**
   * Whether a report is loaded at all. An empty `mages` means two different things - no report, or
   * a report whose units have never studied magic - and the two empty states say different things.
   */
  reportLoaded?: boolean;
}) {
  useEscapeToDismiss(onDismiss);

  const [highlighted, setHighlighted] = useState<string | null>(() => initialTag);
  const graph = useMemo(() => buildMagicGraph(tree), [tree]);
  const graphHandle = useRef<MagicGraphHandle | null>(null);
  const showingGraph = view === "graph";
  const litSkill = highlighted === null ? null : (tree.byTag.get(highlighted) ?? null);

  // Focus returns where it was summoned from, for the reason `GameDataDialog` documents: this
  // opens from the command palette, which itself opens from the orders editor, and without the
  // return trip dismissing it would leave the caret nowhere. Captured during the first render,
  // because by the time an effect runs the close button's `autoFocus` has already moved focus in
  // here - which is also the premise this whole block rests on.
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

  // Keyed on `highlighted` rather than on `initialTag`: following a crossing chip must move the
  // view to the skill it names, and an effect keyed on the prop would fire only on open.
  //
  // Keyed on the view as well, because toggling back to Branches does not remount the dialog - it
  // swaps the body - so an effect keyed on `highlighted` alone never runs for the cards that have
  // just appeared, and the skill the graph was lighting is only found when it happens to be on
  // screen already. The cards are a multi-column layout that scrolls sideways: with a mage picked
  // every row carries a chip, the body grows past three screen-widths, and "happens to be on
  // screen" stops being true (ah-67h8).
  const cards = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (highlighted === null) {
      return;
    }
    const row = cards.current?.querySelector(
      `[data-testid="magic-tree-skill-${CSS.escape(highlighted)}"]`
    );
    row?.scrollIntoView({ block: "center", inline: "center" });
  }, [highlighted, view]);

  return (
    <div
      data-testid="magic-tree-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[10vh]"
    >
      <div
        data-testid="magic-tree-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Magic study tree"
        // 10vh below, matching the `pt-[10vh]` above (ah-vwdi). The two must be changed together:
        // top offset + max height must leave a real margin, or the dialog runs to the screen edge.
        // theme.css caps every modal at 90vh, but as a `:where()` default at zero specificity
        // (ah-y4zb) - so this 80vh simply wins, with no `!` needed.
        className={`grid grid-rows-[auto_auto_1fr] rounded border border-edge bg-panel-raised text-pane whitespace-normal shadow-lg ${
          // The graph is 1366 world units wide and cannot reflow, so its box opens out - and takes
          // a real height rather than a maximum, because `fitGraph` fits into the height it is
          // given and a box that sized to its content would fit the graph into its own answer.
          showingGraph
            ? "h-[80vh] w-[94vw]"
            : "max-h-[80vh] w-[64rem] max-w-[94vw]"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-2 py-1.5">
          <span className="text-ink-soft">Magic study tree</span>
          <div className="flex overflow-hidden rounded border border-edge">
            <ViewButton
              testId="magic-tree-view-branches"
              pressed={!showingGraph}
              onClick={() => onView("branches")}
            >
              Branches
            </ViewButton>
            <ViewButton
              testId="magic-tree-view-graph"
              pressed={showingGraph}
              onClick={() => onView("graph")}
            >
              Whole graph
            </ViewButton>
          </div>
          {picked === null || onPick === undefined ? null : (
            <>
              <MagePicker mages={mages} picked={picked} label={label} onPick={onPick} />
              <span data-testid="magic-tree-tally" className="text-ink-dim">
                {tally(picked)}
              </span>
            </>
          )}
          {showingGraph ? (
            <>
              <ZoomButton
                testId="magic-tree-zoom-in"
                label="Zoom in"
                onClick={() => graphHandle.current?.zoomBy(1)}
              >
                +
              </ZoomButton>
              <ZoomButton
                testId="magic-tree-zoom-out"
                label="Zoom out"
                onClick={() => graphHandle.current?.zoomBy(-1)}
              >
                −
              </ZoomButton>
              <ZoomButton
                testId="magic-tree-zoom-fit"
                label="Zoom to fit"
                onClick={() => graphHandle.current?.fitAll()}
              >
                ⤢
              </ZoomButton>
            </>
          ) : null}
          {showingGraph && litSkill !== null ? (
            // Said out loud, because the same click does two things depending on what is already
            // lit - which is exactly the behaviour a reader cannot guess. It wraps to a second line
            // on a narrow window rather than being dropped.
            <span data-testid="magic-tree-lit" className="flex items-center gap-1 text-ink">
              {litSkill.name}
              <span className="text-ink-dim">— click again to open in the dictionary</span>
              <button
                type="button"
                data-testid="magic-tree-show-all"
                onClick={() => setHighlighted(null)}
                className="rounded border border-edge px-1 text-ink-dim hover:text-ink"
              >
                Show all
              </button>
            </span>
          ) : null}
          <span className="text-ink-dim">
            {tree.skillCount} skills{showingGraph ? ` · ${graph.tiers.length} tiers` : ""}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            data-testid="magic-tree-close"
            // Focus starts inside the dialog rather than behind it, as `ShortcutHelp` and the
            // dictionary both do. Without it `aria-modal="true"` is a claim the dialog does not
            // keep: opening on F3 from the document body would leave focus in the background, and
            // a keyboard user would tab through the whole workspace to reach the tree's own
            // controls.
            autoFocus
            onClick={onDismiss}
            className="rounded px-1.5 text-ink-dim hover:text-ink"
          >
            Close
          </button>
        </div>

        {/*
          One grid row, however many banners are in it: the box is `grid-rows-[auto_auto_1fr]`, and
          a banner rendered as a sibling would take the `1fr` meant for the tree itself.
        */}
        <div>
          {picked !== null ? null : reportLoaded ? (
            // The two kinds of nothing are different facts, and saying neither would make them
            // look like the same one. The tree itself is still drawn, untinted: it is the
            // reference page whether or not a report is loaded.
            <p
              data-testid="magic-tree-no-mages"
              className="m-0 border-b border-edge px-3 py-1.5 text-ink-dim"
            >
              None of your units has studied magic. A unit becomes a mage by studying force,
              pattern or spirit.
            </p>
          ) : (
            <p
              data-testid="magic-tree-no-report"
              className="m-0 border-b border-edge px-3 py-1.5 text-ink-dim"
            >
              No turn report is loaded. The tree shows every magic skill and what it stands on.
              Load a report and it will also show what your own mages know.
            </p>
          )}

          {picked === null || picked.missing.length === 0 ? null : (
            // About the picked mage only, and about what he holds: the ruleset we scraped is
            // missing two magic skills reports do name, and a player holding one must not
            // conclude the tree is simply wrong.
            <p
              data-testid="magic-tree-missing"
              className="m-0 border-b border-edge px-3 py-1.5 text-warn"
            >
              {missingLine(picked)}
            </p>
          )}

          {/*
            Stated once, under the header, rather than once per card: ten cards fit on one screen,
            and the same sentence ten times reads as decoration. `rules/magic_skills`: magic skills
            "cannot be learnt to a higher level than the skills they depend upon".
          */}
          <p
            data-testid="magic-tree-cap"
            className="m-0 border-b border-edge px-3 py-1.5 text-ink-dim"
          >
            A magic skill can never rise above the skills it stands on — the levels below are
            floors to begin, and ceilings thereafter.
          </p>
        </div>

        {/*
          A CSS multi-column layout rather than a grid: it gives one column on a narrow window with
          no breakpoint logic, and `break-inside-avoid` keeps a card whole rather than splitting one
          across the fold.
        */}
        {showingGraph ? (
          // Panning is the transform, so the body must not scroll: a scrollable body fights the
          // drag, and the arrow keys would scroll it instead of panning the graph.
          <div className="min-h-0 overflow-hidden p-0">
            <MagicGraphView
              graph={graph}
              lit={highlighted}
              standing={picked?.byTag ?? null}
              onLight={setHighlighted}
              onOpenGameData={onOpenGameData}
              viewport={graphViewport}
              onViewport={onGraphViewport}
              handleRef={graphHandle}
            />
          </div>
        ) : (
          <div ref={cards} className="min-h-0 columns-[19rem] gap-3 overflow-y-auto p-3">
            {tree.branches.map((branch) => (
              <Card
                key={branch.key}
                branch={branch}
                highlighted={highlighted}
                standing={picked?.byTag ?? null}
                onOpenGameData={onOpenGameData}
                onFollow={setHighlighted}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One half of the segmented view toggle. Pressed rather than selected: it is a two-state button. */
function ViewButton({
  testId,
  pressed,
  onClick,
  children
}: {
  testId: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      onClick={onClick}
      className={`px-2 ${pressed ? "bg-panel text-ink" : "text-ink-dim hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

/** The same glyphs and the same names the map's own zoom controls use, so the two do not disagree. */
function ZoomButton({
  testId,
  label,
  onClick,
  children
}: {
  testId: string;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded border border-edge px-1.5 text-ink-dim hover:text-ink"
    >
      {children}
    </button>
  );
}

function Card({
  branch,
  highlighted,
  standing,
  onOpenGameData,
  onFollow
}: {
  branch: MagicBranch;
  highlighted: string | null;
  /** Where the picked mage stands in each skill, or null for the untinted reference page. */
  standing: ReadonlyMap<string, SkillStanding> | null;
  onOpenGameData: (entryId: string) => void;
  onFollow: (tag: string) => void;
}) {
  // Indentation is relative to the card's own shallowest skill, so a branch whose root sits at
  // depth 1 does not open one step in from the left edge of its own box.
  const floor = Math.min(...branch.skills.map((skill) => skill.depth));
  return (
    <section
      data-testid={`magic-tree-branch-${branch.key}`}
      className={`mb-3 break-inside-avoid rounded border px-2 py-1.5 ${
        // The apprenticeship is set apart, because it is not a foundation and nothing builds on it.
        branch.key === "MANI" ? "border-dashed border-edge" : "border-edge"
      }`}
    >
      <h3 className="m-0 text-ink">{branch.title}</h3>
      {branch.blurb === null ? null : <p className="m-0 mb-1 text-ink-dim">{branch.blurb}</p>}
      {branch.skills.map((skill) => (
        <Skill
          key={skill.tag}
          skill={skill}
          floor={floor}
          highlighted={highlighted === skill.tag}
          standing={standing?.get(skill.tag) ?? null}
          onOpenGameData={onOpenGameData}
          onFollow={onFollow}
        />
      ))}
    </section>
  );
}

function Skill({
  skill,
  floor,
  highlighted,
  standing,
  onOpenGameData,
  onFollow
}: {
  skill: MagicSkillNode;
  floor: number;
  highlighted: boolean;
  /** Where the picked mage stands in this one skill, or null when nothing is tinted. */
  standing: SkillStanding | null;
  onOpenGameData: (entryId: string) => void;
  onFollow: (tag: string) => void;
}) {
  const style = standing === null ? null : ROW_STYLE[standing.kind];
  return (
    <div
      data-testid={`magic-tree-skill-${skill.tag}`}
      // An inline indent rather than a Tailwind class: the depth is a number, and a class name
      // built from one is a class Tailwind's scanner never sees and so never emits.
      style={{ paddingLeft: `${(skill.depth - floor) * 0.75}rem` }}
      className={`rounded px-1 ${highlighted ? "bg-panel " : ""}${
        style === null ? (highlighted ? "text-ink" : "text-ink-soft") : `${style.edge} ${style.text}`
      }`}
    >
      <button
        type="button"
        onClick={() => onOpenGameData(skill.id)}
        className="bg-transparent p-0 text-left text-accent underline-offset-2 hover:underline"
      >
        {skill.name}
      </button>{" "}
      <span className="text-ink-dim">{skill.tag}</span>
      <Gate prerequisites={skill.within} />
      {skill.crossing.map((need) => (
        <button
          key={need.tag}
          type="button"
          data-testid={`magic-tree-chip-${skill.tag}-${need.tag}`}
          title={`also needs ${need.name} at level ${need.level}`}
          onClick={() => onFollow(need.tag)}
          className="ml-1 rounded border border-edge px-1 text-ink-dim hover:text-ink"
        >
          +{need.tag} {need.level}
        </button>
      ))}
      {standing === null || standing.kind === "locked" ? null : (
        // Locked takes no chip and keeps its gate text: what is missing is the reason for showing
        // a locked row at all.
        <span
          data-testid={`magic-tree-standing-${skill.tag}`}
          className={`ml-1 rounded border px-1 ${ROW_STYLE[standing.kind].chip}`}
        >
          {standingWords(standing)}
        </span>
      )}
    </div>
  );
}

/**
 * The five states, each separated from the other four by shape as well as by colour, so they read
 * for somebody who cannot tell green from amber and in a monochrome print.
 *
 * Locked takes no edge rather than a fifth border style: four patterns, and the fifth state is the
 * absence of one.
 */
const ROW_STYLE: Record<StandingKind, { edge: string; text: string; chip: string }> = {
  known: {
    edge: "border-l-4 border-solid border-ok",
    text: "text-ink",
    chip: "border-ok text-ok"
  },
  ceiling: {
    edge: "border-l-4 border-double border-warn",
    text: "text-ink",
    chip: "border-warn text-warn"
  },
  maxed: {
    edge: "border-l-4 border-dotted border-ink-soft",
    text: "text-ink",
    chip: "border-ink-soft text-ink-soft"
  },
  open: {
    edge: "border-l-4 border-dashed border-select",
    text: "text-ink-soft",
    chip: "border-select text-select"
  },
  locked: { edge: "border-l-4 border-transparent", text: "text-ink-dim", chip: "" }
};

/**
 * `bird lore and wolf lore`; `bird lore, wolf lore and dragon lore`. Three is the widest real case
 * in the shipped ruleset.
 */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The chip's words. Spends words making the ceiling explicit rather than leaning on the colour. */
function standingWords(standing: SkillStanding): string {
  switch (standing.kind) {
    case "known":
      return `at ${standing.level}, ceiling ${standing.ceiling}`;
    case "ceiling":
      return `at ${standing.level}, held by ${joinNames(standing.heldBy.map((need) => need.name))}`;
    case "maxed":
      return `at ${standing.level}, the highest there is`;
    case "open":
      return "can study";
    case "locked":
      return "";
  }
}

/** The header tally, in a fixed order and with a zero count left out entirely. */
function tally(picked: MageStanding): string {
  const words: [StandingKind, string][] = [
    ["known", "known"],
    ["ceiling", "at ceiling"],
    ["maxed", "at maximum"],
    ["open", "can study"],
    ["locked", "locked"]
  ];
  return words
    .filter(([kind]) => picked.counts[kind] > 0)
    .map(([kind, word]) => `${picked.counts[kind]} ${word}`)
    .join(" · ");
}

/** What the mage knows that this tree cannot draw, because the ruleset we hold lacks the skill. */
function missingLine(picked: MageStanding): string {
  if (picked.missing.length === 1) {
    return `${picked.name} knows ${picked.missing[0].name}, which this tree cannot show: it is not in the ruleset we hold.`;
  }
  return `${picked.name} knows ${picked.missing.length} skills this tree cannot show: they are not in the ruleset we hold.`;
}

/**
 * The within-branch prerequisites, as plain text rather than links: they name skills already
 * visible in the same card, a line or two above.
 */
function Gate({ prerequisites }: { prerequisites: readonly MagicPrerequisite[] }) {
  if (prerequisites.length === 0) {
    return null;
  }
  return (
    <span className="ml-1 text-ink-dim">
      {prerequisites.map((need) => `${need.tag} ${need.level}`).join(", ")}
    </span>
  );
}
