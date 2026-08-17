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
  children: ReactNode;
  className?: string;
};

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
      // between panels, and the space a folded one gives up - stays live map. `LayerChips` does
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
      <header className="flex h-7 flex-none items-center gap-2 border-b border-edge px-2.5">
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
      </header>
      {collapsed ? null : (
        <div className="min-h-0 flex-1 overflow-auto px-2.5 py-2 text-pane leading-snug">
          {children}
        </div>
      )}
    </section>
  );
}
