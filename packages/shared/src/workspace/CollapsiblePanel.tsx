import type { ReactNode } from "react";
import { useWorkspaceStore, type PanelName } from "../workspaceStore";

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

  return (
    <section
      data-testid={`panel-${panel}`}
      data-collapsed={collapsed}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-edge bg-panel/95 shadow-lg backdrop-blur ${className}`}
    >
      <header className="flex h-7 flex-none items-center gap-2 border-b border-edge px-2.5">
        <button
          type="button"
          onClick={() => togglePanel(panel)}
          aria-expanded={!collapsed}
          className="flex flex-1 items-center gap-2 text-left text-[10px] uppercase tracking-[0.12em] text-brass focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
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
        <div className="min-h-0 flex-1 overflow-auto px-2.5 py-2 text-[11.5px] leading-snug">
          {children}
        </div>
      )}
    </section>
  );
}
