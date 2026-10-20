import type { PointerEvent, ReactNode } from "react";
import { useWorkspaceStore, type PanelName } from "../workspaceStore";
import { guardSelection } from "./selectionGuard";

type CollapsiblePanelProps = {
  panel: PanelName;
  title: string;
  /** Shown beside the title: which hex, which unit, how many rows. */
  hint?: string;
  /** Marks data carried over from an earlier turn, as in "as of turn 71". */
  asOf?: string | null;
  actions?: ReactNode;
  /**
   * A tab strip that stands where the title would.
   *
   * Given one, the header renders it, then `actions`, then a fold control carrying only the caret;
   * `title` is then used for that control's accessible name and nothing else. The body also stops
   * scrolling and stops padding - each tab panel supplies its own, because a scroller here plus a
   * scroller inside a tab panel scrolls that panel's pinned row away (ah-zh5i.2).
   */
  tabs?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * The header of a tabbed panel: tabs, then the actions, then the fold, on one line while they fit.
 *
 * When they do not, the actions wrap onto a slim row of their own, right-aligned, and the tabs and
 * the fold keep the title line (ah-14xq, docs/ui/ah-14xq-header-wrap.html). Plain flex-wrap decides
 * it: the actions reserve their widest wording and the tabs the route dot's room, so the decision
 * follows the panel's width and never what the buttons happen to say.
 *
 * - The spacing is the tightened one agreed for the default 21rem rail (gaps 4px, edges 6px;
 *   docs/ui/ah-14xq-default-width.html), so the widest state still fits on one line there.
 * - `pr-[1.125rem]` is the fold's column: 6px edge + its 8px + one 4px gap.
 * - The line between the two rows is a 1px background stripe at the title line's bottom. With one
 *   row it lies under the header's own bottom border and cannot be seen; CSS has no other way to
 *   draw something only when a flex line has wrapped.
 */
const TABBED_HEADER =
  "relative flex min-h-7 flex-none flex-wrap items-center gap-x-1 border-b border-edge pl-1.5 pr-[1.125rem] " +
  "bg-[linear-gradient(var(--color-edge),var(--color-edge))] bg-[length:100%_1px] bg-[position:0_calc(1.75rem-1px)] bg-no-repeat";

/**
 * A panel that folds to its title bar so the map underneath can be opened up.
 *
 * Collapsed it leaves the strip behind rather than disappearing, so the user can always see what
 * they have hidden and get it back.
 */
export function CollapsiblePanel({
  panel,
  title,
  hint,
  asOf,
  actions,
  tabs,
  children,
  className = ""
}: CollapsiblePanelProps) {
  const collapsed = useWorkspaceStore((state) => state.collapsed[panel]);
  const togglePanel = useWorkspaceStore((state) => state.togglePanel);

  // A selection that starts in this pane may sweep the whole pane but must stop at its edge:
  // dragging on past it used to mark every pane and the map too. The guard makes this pane the
  // one selectable island until the pointer comes up, wherever it comes up.
  const confineSelection = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    const release = guardSelection(event.currentTarget);
    const done = () => {
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
      release();
    };
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  };

  return (
    <section
      data-testid={`panel-${panel}`}
      data-collapsed={collapsed}
      onPointerDown={confineSelection}
      // `pointer-events-auto` sits here rather than on the slot around it: the shell's overlay is
      // pointer-events-none, so the panel takes clicks and everything the panel is not - the gaps
      // between panels, and the space a folded one gives up - stays live map. `MapViewControls` does
      // the same thing for the same reason.
      //
      // `h-full` only while open. Expanded, the section has to fill the slot it was given or it
      // sizes to its content and spills out, painting over the panel below. Folded, it must do the
      // opposite and shrink to its title bar - which is what issue #60 was: the body disappeared
      // and the frame stayed, a full-height empty slab over the map.
      // `bg-pane`, not `bg-panel/95`: the panes' alpha is the transparency setting, one custom
      // property stamped on the root, so the slider re-paints every pane without a re-render.
      className={`pointer-events-auto flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-edge bg-pane shadow-lg backdrop-blur ${collapsed ? "" : "h-full"} ${className}`}
    >
      <header className={tabs ? TABBED_HEADER : "flex h-7 flex-none items-center gap-2 border-b border-edge px-2.5"}>
        {tabs ? (
          <>
            {tabs}
            {actions}
            {/*
              Last in the DOM, so the keyboard still meets it after the actions, but pinned to the
              title line's right end: when the actions drop to their own row the fold stays up here
              with the tabs. Its fixed width is what the header's right padding keeps free for it.
            */}
            <button
              type="button"
              onClick={() => togglePanel(panel)}
              aria-expanded={!collapsed}
              aria-label={`Collapse ${title}`}
              className="absolute right-1.5 top-0 flex h-[calc(1.75rem-1px)] w-2 items-center justify-center text-pane-sm text-ink-dim focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
            >
              <span aria-hidden>{collapsed ? "▸" : "▾"}</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => togglePanel(panel)}
              aria-expanded={!collapsed}
              className="flex flex-1 items-center gap-2 text-left text-pane-sm uppercase tracking-[0.12em] text-brass focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
            >
              <span>{title}</span>
              {hint ? (
                <span className="normal-case tracking-normal text-ink-dim">{hint}</span>
              ) : null}
              <span className="flex-1" />
              {asOf ? <span className="normal-case tracking-normal text-warn">{asOf}</span> : null}
              <span aria-hidden className="text-ink-dim">
                {collapsed ? "▸" : "▾"}
              </span>
            </button>
            {actions}
          </>
        )}
      </header>
      {collapsed ? null : tabs ? (
        <div className="flex min-h-0 flex-1 flex-col text-pane leading-snug">{children}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-2.5 py-2 text-pane leading-snug">
          {children}
        </div>
      )}
    </section>
  );
}
