import { useEffect, useMemo, useRef, useState } from "react";
import { paletteKeyReduce, PALETTE_PAGE_ROWS } from "../commandPalette";
import {
  openingPlannerMage,
  plannerAlliedNotice,
  unreportedLine,
  type PlannerAlliedStatus,
  type PlannerGroup,
  type PlannerMage
} from "../studyPlanner";
import { useEscapeToDismiss } from "./dismissLayer";
import { STANDING_CHIP, standingWords } from "./standingChip";

/**
 * The study planner (`ah-lyg6.2.2`): every mage the player can see, their own and their allies',
 * in one list with the chosen one read out beside it.
 *
 * `docs/ui/ah-lyg6.2.2-layout.html`, `-stale.html` and `-detail.html` are the design, chosen with
 * the navigator: a mage list beside a mage detail rather than a table, because the detail's room is
 * what `ah-lyg6.2.3`'s per-mage choice will need. The magic tree (F3) is the depth view - all
 * seventy skills for one mage - and this is the breadth view.
 *
 * **Read-only.** Nothing here writes: choosing a study is `ah-lyg6.2.3`, teaching is `ah-lyg6.3`,
 * and the export is `ah-lyg6.4`.
 *
 * The frame is `GameDataDialog`'s, deliberately - a third reference pane must not invent a fourth.
 *
 * **Split hook-free** the way `MagePicker` is: `StudyPlannerList` and `StudyPlannerDetail` take
 * everything as props so a test in this package can walk them, since there is no jsdom here
 * (ah-nass). Focus, the arrow keys and scroll-into-view are therefore covered by the smoke suite.
 */
export function StudyPlannerDialog({
  groups,
  summaryLine,
  emptyCopy,
  alliedStatus,
  selectedUnitId,
  label,
  onDismiss
}: {
  groups: readonly PlannerGroup[];
  /** `plannerSummaryLine(groups)`; null hides the sub-line. */
  summaryLine: string | null;
  emptyCopy: { headline: string; detail: string };
  /** The allied-mage store's status, for the loading and error lines. */
  alliedStatus: PlannerAlliedStatus;
  /** The workspace's selected unit, so the pane opens on him when he is a mage. */
  selectedUnitId: string | null;
  /** How a region id reads to a player. `AppShell`'s `hexLabel`. */
  label: (regionId: string) => string;
  onDismiss: () => void;
}) {
  useEscapeToDismiss(onDismiss);

  const flat = useMemo(() => groups.flatMap((group) => group.mages), [groups]);
  // Not remembered between openings, unlike the tree's picked mage: a planner is a list, and
  // reopening it on your strongest mage is the more predictable of the two.
  const [pickedKey, setPickedKey] = useState<string | null>(
    () => openingPlannerMage(groups, selectedUnitId)?.key ?? null
  );
  const picked = flat.find((mage) => mage.key === pickedKey) ?? flat[0] ?? null;

  // Focus returns where it was summoned from, exactly as `GameDataDialog` does: this opens from F4
  // or from the palette, which itself opens from the orders editor.
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

  // The selected row is scrolled into view whenever the selection changes. `block: "nearest"`
  // scrolls only when the row is actually off screen, so stepping between visible rows does not
  // jog the list - the same shape, and the same reason, as `GameDataDialog`'s.
  const list = useRef<HTMLUListElement | null>(null);

  // Focus opens inside the pane, because `aria-modal="true"` is only honest if it is - and the
  // arrow keys are the way the list is walked, so the list itself is what takes it. An effect
  // rather than `autoFocus`, which React applies to form controls and not to a `ul`.
  useEffect(() => {
    list.current?.focus();
  }, []);

  useEffect(() => {
    if (picked === null) {
      return;
    }
    const row = list.current?.querySelector(
      `[data-testid="study-planner-mage-${CSS.escape(picked.key)}"]`
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [picked]);

  const notice = plannerAlliedNotice(
    alliedStatus,
    groups.some((group) => group.source === "own" && group.mages.length > 0)
  );

  const move = (key: string): boolean => {
    if (picked === null) {
      return false;
    }
    const at = flat.findIndex((mage) => mage.key === picked.key);
    const next = paletteKeyReduce(
      { index: at === -1 ? 0 : at, count: flat.length, pageSize: PALETTE_PAGE_ROWS },
      key
    );
    if (next === null) {
      return false;
    }
    const mage = flat[next];
    if (mage !== undefined) {
      setPickedKey(mage.key);
    }
    return true;
  };

  return (
    <div
      data-testid="study-planner-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[10vh]"
    >
      <div
        data-testid="study-planner-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Study planner"
        // 10vh below, matching the `pt-[10vh]` above: the two must be changed together. theme.css
        // caps every modal at 90vh as a `:where()` default at zero specificity, so this 80vh
        // simply wins with no `!` needed.
        className="grid max-h-[80vh] w-[56rem] max-w-[94vw] grid-rows-[auto_auto_1fr] rounded border border-edge bg-panel-raised text-pane whitespace-normal shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
          <span className="text-ink-soft">Study planner</span>
          <span className="flex-1" />
          <button
            type="button"
            data-testid="study-planner-close"
            onClick={onDismiss}
            className="rounded px-1.5 text-ink-dim hover:text-ink"
          >
            Close
          </button>
        </div>

        {summaryLine === null && notice === null ? (
          <div />
        ) : (
        <div className="border-b border-edge px-2 py-1 text-ink-dim">
          {summaryLine === null ? null : (
            <span data-testid="study-planner-summary">{summaryLine}</span>
          )}
          {notice === null ? null : (
            <span
              data-testid="study-planner-allied-notice"
              className={summaryLine === null ? "text-warn" : "ml-2 text-warn"}
            >
              {notice}
            </span>
          )}
        </div>
        )}

        {picked === null ? (
          <div data-testid="study-planner-empty" className="min-h-0 overflow-y-auto p-3">
            <p className="text-ink">{emptyCopy.headline}</p>
            <p className="text-ink-dim">{emptyCopy.detail}</p>
          </div>
        ) : (
          <div className="grid min-h-0 grid-cols-[17rem_1fr]">
            <StudyPlannerList
              listRef={list}
              groups={groups}
              picked={picked}
              onPick={setPickedKey}
              onMove={move}
            />
            <StudyPlannerDetail mage={picked} label={label} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The mage list, grouped by faction with a sticky heading each. Hook-free, so a test can walk it. */
export function StudyPlannerList({
  groups,
  picked,
  onPick,
  onMove,
  listRef
}: {
  groups: readonly PlannerGroup[];
  picked: PlannerMage;
  onPick: (key: string) => void;
  /** Answers the arrow keys; true when it took the key. */
  onMove: (key: string) => boolean;
  listRef?: React.RefObject<HTMLUListElement | null>;
}) {
  return (
    <ul
      ref={listRef}
      data-testid="study-planner-list"
      role="listbox"
      aria-label="Mages"
      tabIndex={0}
      aria-activedescendant={`study-planner-option-${picked.key}`}
      onKeyDown={(event) => {
        if (onMove(event.key)) {
          event.preventDefault();
        }
      }}
      className="min-h-0 overflow-y-auto border-r border-edge outline-none"
    >
      {groups.map((group) => (
        <li key={group.factionId} role="presentation">
          <p
            data-testid={`study-planner-group-${group.factionId}`}
            className="sticky top-0 bg-panel-raised px-2 py-0.5 text-brass"
          >
            {group.heading}
          </p>
          <ul role="presentation">
            {group.mages.map((mage) => (
              <li
                key={mage.key}
                // Keyed on `mage.key`, not on the unit number: a report and an allied sheet can
                // carry the same one, and `aria-activedescendant` and the scroll below would then
                // both address the wrong row.
                id={`study-planner-option-${mage.key}`}
                role="option"
                data-testid={`study-planner-mage-${mage.key}`}
                aria-selected={mage.key === picked.key}
                onClick={() => onPick(mage.key)}
                // The stale tint is applied to unselected rows only: appended unconditionally it
                // would give every row of a stale group the selected row's background, and the
                // selection would come down to the ink alone.
                className={`cursor-pointer border-l-2 px-2 py-0.5 ${
                  mage.key === picked.key
                    ? "border-select bg-panel text-ink"
                    : `border-transparent text-ink-soft hover:text-ink ${
                        group.stale ? "bg-panel" : ""
                      }`
                }`}
              >
                <span>
                  {mage.name} ({mage.unitId})
                </span>
                <span className="block text-ink-dim">{mage.summary}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** One mage read out: where he is, what he knows, what he may begin, and what holds him back. */
export function StudyPlannerDetail({
  mage,
  label
}: {
  mage: PlannerMage;
  label: (regionId: string) => string;
}) {
  const unreported = unreportedLine(mage);
  const heldBack = mage.knows.filter((skill) => skill.standing.kind === "ceiling");
  const missing = mage.standing.missing;
  return (
    <div data-testid="study-planner-detail" className="min-h-0 overflow-y-auto p-3">
      <p className="text-ink">
        {mage.name} ({mage.unitId})
      </p>
      <p className="text-ink-dim">
        {`${mage.factionLabel} · ${label(mage.regionId)}`}
        {mage.sheetTurn === null ? " · from this turn's report" : ""}
      </p>
      {unreported === null ? null : (
        <p
          data-testid="study-planner-unreported"
          className="my-2 border-l-2 border-warn pl-2 text-warn"
        >
          {unreported}
        </p>
      )}

      <p className="mt-3 text-ink-soft">Knows</p>
      <ul>
        {mage.knows.map((skill) => (
          <li key={skill.tag} data-testid={`study-planner-knows-${skill.tag}`} className="text-ink">
            <span
              className={`rounded border px-1 text-pane-xs ${STANDING_CHIP[skill.standing.kind]}`}
            >
              {skill.projected === null
                ? `${skill.name} ${skill.level}`
                : `${skill.name} ${skill.level} → up to ${skill.projected}`}
            </span>{" "}
            <span className="text-ink-dim">{standingWords(skill.standing)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-ink-soft" data-testid="study-planner-can-study-heading">
        Can study now — {mage.canStudy.length}
      </p>
      <ul>
        {mage.canStudy.map((node) => (
          <li key={node.tag} data-testid={`study-planner-open-${node.tag}`}>
            <span className={`rounded border px-1 text-pane-xs ${STANDING_CHIP.open}`}>
              {node.name}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-ink-soft">Held back</p>
      {heldBack.length === 0 ? (
        <p className="text-ink-dim">Nothing he holds is at a prerequisite&apos;s ceiling.</p>
      ) : (
        <ul>
          {heldBack.map((skill) => (
            <li key={skill.tag} className="text-ink">
              {`${skill.name} — ${standingWords(skill.standing)}`}
            </li>
          ))}
        </ul>
      )}

      {missing.length === 0 ? null : (
        <p className="mt-3 text-ink-dim" data-testid="study-planner-missing">
          {missing.length === 1
            ? "Also knows 1 skill this ruleset does not describe."
            : `Also knows ${missing.length} skills this ruleset does not describe.`}
        </p>
      )}
    </div>
  );
}
