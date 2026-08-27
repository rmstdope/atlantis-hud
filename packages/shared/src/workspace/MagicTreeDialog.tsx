import { useEffect, useRef, useState } from "react";
import type { MagicBranch, MagicPrerequisite, MagicSkillNode, MagicTree } from "../magicTree";
import { useEscapeToDismiss } from "./dismissLayer";

/**
 * The magic study tree: all seventy magic skills grouped into branch cards, so what a skill needs
 * before it can be studied is answerable inside the application rather than only in the rules text.
 *
 * `docs/ui/ah-gjbs-shape-branches.html` is the design, chosen with the navigator over the honest
 * whole-graph picture - which is a real drawing of a DAG thirty-eight skills wide in its middle
 * tier, and always needs panning. It survives as `ah-gjbs.2`, together with the toggle between the
 * two; there is deliberately no toggle here, because a toggle with one destination is a dead
 * control.
 *
 * Static: nothing about the player's own mages appears (`ah-67h8`). The frame - the backdrop, the
 * dismiss guard and the two heights that must move together - is `GameDataDialog`'s, on purpose:
 * the two reference dialogs should not drift apart.
 */
export function MagicTreeDialog({
  tree,
  initialTag,
  onOpenGameData,
  onDismiss
}: {
  tree: MagicTree;
  /** The skill to scroll to and pick out, or null to open at the top. */
  initialTag: string | null;
  /** Opens a skill in the game data dictionary. */
  onOpenGameData: (entryId: string) => void;
  onDismiss: () => void;
}) {
  useEscapeToDismiss(onDismiss);

  const [highlighted, setHighlighted] = useState<string | null>(() => initialTag);

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
        className="grid max-h-[80vh] w-[64rem] max-w-[94vw] grid-rows-[auto_auto_1fr] rounded border border-edge bg-panel-raised text-pane whitespace-normal shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
          <span className="text-ink-soft">Magic study tree</span>
          <span className="text-ink-dim">{tree.skillCount} skills</span>
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
      </div>
    </div>
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
