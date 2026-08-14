import { useEffect, useRef } from "react";
import type { HexFindings } from "../orderEditor";
import { POPOVER_BODY_MAX_H } from "./primitives";

/**
 * Everything order validation found, across the whole map, grouped by hex.
 *
 * The region panel answers "what is wrong here", and that is the question you ask about a hex you
 * are already looking at. This answers the one that actually costs a turn: what is wrong in the
 * hex you have not looked at. A faction of four hundred units has more hexes than anybody clicks
 * through before sending orders in.
 *
 * A panel under a chip, in the shape `MergedFactionsPanel` and `TurnMessagesPanel` already use.
 * Every hex is a button, because finding out that something is wrong somewhere is only half of
 * what the player needs; the other half is getting there.
 */
export function ProblemsPanel({
  hexes,
  labelFor,
  onSelectHex,
  onDismiss
}: {
  hexes: HexFindings[];
  /** How a hex reads in the interface, for instance `mountain (7,53)`. */
  labelFor: (regionId: string) => string;
  onSelectHex: (regionId: string) => void;
  onDismiss: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    // The wrapper rather than the panel, as the sibling panels do: the chip that opened this sits
    // beside it in that wrapper, and testing the panel alone would dismiss on the chip's own press
    // and let its toggle reopen immediately.
    const onPointerDown = (event: PointerEvent) => {
      const trigger = panelRef.current?.parentElement ?? panelRef.current;
      if (!trigger?.contains(event.target as Node)) {
        onDismiss();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onDismiss]);

  const total = hexes.reduce((count, hex) => count + hex.findings.length, 0);

  return (
    <div
      ref={panelRef}
      data-testid="problems-panel"
      role="dialog"
      aria-label="Order problems"
      // Not a drop target: this floats over the map but is a child of the header, which is what
      // accepts a dropped report. Left alone it would become a second, invisible drop zone that
      // exists only while this happens to be open. The other header panels do the same.
      onDragOver={(event) => event.stopPropagation()}
      // `whitespace-normal` undoes the header's `whitespace-nowrap`, which inherits into anything
      // rendered inside it.
      className="absolute left-0 top-full z-20 mt-1 w-80 rounded border border-edge bg-panel-raised text-[11.5px] whitespace-normal shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
        <span className="text-ink-soft">
          {total} problem{total === 1 ? "" : "s"} in {hexes.length} hex
          {hexes.length === 1 ? "" : "es"}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="close order problems"
          onClick={onDismiss}
          className="rounded px-1.5 text-ink-dim hover:text-ink"
        >
          ✕
        </button>
      </div>

      <ul className={`${POPOVER_BODY_MAX_H} list-none overflow-y-auto p-2`}>
        {hexes.map((hex) => (
          <li
            key={hex.regionId}
            data-testid={`problem-hex-${hex.regionId}`}
            className="border-t border-edge-soft py-1 first:border-t-0"
          >
            <button
              type="button"
              // Selecting the hex is the point of the row; dismissing afterwards is what makes it
              // feel like navigation rather than a checklist that stays in the way of the map it
              // just sent you to.
              onClick={() => {
                onSelectHex(hex.regionId);
                onDismiss();
              }}
              className="w-full rounded px-1 text-left text-brass hover:bg-panel"
            >
              {labelFor(hex.regionId)}
              <span className="ml-1.5 text-ink-dim">
                {hex.findings.length} problem{hex.findings.length === 1 ? "" : "s"}
              </span>
            </button>
            <ul className="m-0 list-none p-0 pl-1">
              {hex.findings.map((finding, index) => (
                <li
                  key={`${finding.code}-${finding.unitId ?? "hex"}-${index}`}
                  data-testid="problem-entry"
                  data-code={finding.code}
                  className="flex gap-1.5"
                >
                  {finding.unitId === null ? null : (
                    <span className="shrink-0 tabular-nums text-ink-dim">{finding.unitId}</span>
                  )}
                  <span className={finding.severity === "error" ? "text-danger" : "text-warn"}>
                    {finding.message}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <p className="border-t border-edge px-2 py-1.5 text-ink-dim">
        These never block an export. They are what the report says will go wrong, not what the
        server will refuse.
      </p>
    </div>
  );
}
