import type { HexFindings } from "../orderEditor";
import { POPOVER_BODY_MAX_H } from "./primitives";
import { PopoverFrame } from "./popover";

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
  const total = hexes.reduce((count, hex) => count + hex.findings.length, 0);

  return (
    <PopoverFrame testId="problems-panel" label="Order problems" align="left" width="w-80">
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
    </PopoverFrame>
  );
}
