import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MagicBranch, MagicPrerequisite, MagicSkillNode, MagicTree } from "../magicTree";
import { useEscapeToDismiss } from "./dismissLayer";
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
 * Static: nothing about the player's own mages appears (`ah-67h8`). The frame - the backdrop, the
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
  onDismiss
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
  // view to the skill it names, and an effect keyed on the prop would fire only on open. Effects
  // run on mount too, which is the whole of why toggling back to Branches lands on the skill the
  // graph was lighting - there is no code here about the toggle at all.
  const cards = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (highlighted === null) {
      return;
    }
    const row = cards.current?.querySelector(
      `[data-testid="magic-tree-skill-${CSS.escape(highlighted)}"]`
    );
    row?.scrollIntoView({ block: "center" });
  }, [highlighted]);

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
          Stated once, under the header, rather than once per card: ten cards fit on one screen, and
          the same sentence ten times reads as decoration. `rules/magic_skills`: magic skills
          "cannot be learnt to a higher level than the skills they depend upon".
        */}
        <p data-testid="magic-tree-cap" className="m-0 border-b border-edge px-3 py-1.5 text-ink-dim">
          A magic skill can never rise above the skills it stands on — the levels below are floors to
          begin, and ceilings thereafter.
        </p>

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
  onOpenGameData,
  onFollow
}: {
  branch: MagicBranch;
  highlighted: string | null;
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
  onOpenGameData,
  onFollow
}: {
  skill: MagicSkillNode;
  floor: number;
  highlighted: boolean;
  onOpenGameData: (entryId: string) => void;
  onFollow: (tag: string) => void;
}) {
  return (
    <div
      data-testid={`magic-tree-skill-${skill.tag}`}
      // An inline indent rather than a Tailwind class: the depth is a number, and a class name
      // built from one is a class Tailwind's scanner never sees and so never emits.
      style={{ paddingLeft: `${(skill.depth - floor) * 0.75}rem` }}
      className={`rounded px-1 ${highlighted ? "bg-panel text-ink" : "text-ink-soft"}`}
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
    </div>
  );
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
