import type { HexFindings } from "../orderEditor";
import { PROBLEM_CARD, ProblemMessage, ProblemWho, SeverityMark } from "./primitives";

/**
 * Everything order validation found, across the whole map, grouped by hex.
 *
 * The region panel answers "what is wrong here", and that is the question you ask about a hex you
 * are already looking at. This answers the one that actually costs a turn: what is wrong in the
 * hex you have not looked at. A faction of four hundred units has more hexes than anybody clicks
 * through before sending orders in.
 *
 * The body of the turn-report panel's Problems tab, and nothing else: the frame, the header line,
 * the scroller and the footer are the panel's, so all four tabs share one of each (ah-30hg.2).
 * Every hex is a button, because finding out that something is wrong somewhere is only half of
 * what the player needs; the other half is getting there.
 */
export function ProblemsList({
  hexes,
  labelFor,
  onSelectHex,
  onDismiss,
  known,
  onSelectUnit
}: {
  hexes: HexFindings[];
  /** How a hex reads in the interface, for instance `mountain (7,53)`. */
  labelFor: (regionId: string) => string;
  onSelectHex: (regionId: string) => void;
  /** Closes the panel this list is the body of, since selecting a hex is navigation. */
  onDismiss: () => void;
  /** The unit ids the loaded turn describes, so only a unit that can be reached becomes a button. */
  known?: ReadonlySet<string>;
  /** Go and look at a unit. The caller closes this popover, since it is the one that opened it. */
  onSelectUnit?: (unitId: string) => void;
}) {
  return (
    <ul data-testid="problems-panel" className="list-none space-y-2">
      {hexes.map((hex) => (
        <li key={hex.regionId} data-testid={`problem-hex-${hex.regionId}`} className={PROBLEM_CARD}>
          <button
            type="button"
            // Selecting the hex is the point of the row; dismissing afterwards is what makes it
            // feel like navigation rather than a checklist that stays in the way of the map it
            // just sent you to.
            onClick={() => {
              onSelectHex(hex.regionId);
              onDismiss();
            }}
            className="flex w-full items-baseline gap-1.5 border-b border-edge bg-brass/10 px-1.5 py-0.5 text-left text-pane-sm uppercase tracking-[0.06em] text-brass hover:bg-brass/20"
          >
            {labelFor(hex.regionId)}
            <span className="ml-auto normal-case tracking-normal text-ink-dim">
              {hex.findings.length}
            </span>
          </button>
          <ul className="m-0 list-none p-0">
            {hex.findings.map((finding, index) => (
              <li
                key={`${finding.code}-${finding.unitId ?? "hex"}-${index}`}
                data-testid="problem-entry"
                data-code={finding.code}
                className="flex gap-1.5 border-t border-edge-soft px-1.5 py-0.5 first:border-t-0"
              >
                <SeverityMark severity={finding.severity} />
                <ProblemWho
                  unitId={finding.unitId}
                  formed={finding.formed}
                  known={known}
                  onSelectUnit={onSelectUnit}
                />
                <span className="text-ink">
                  <ProblemMessage
                    message={finding.message}
                    known={known}
                    onSelectUnit={onSelectUnit}
                  />
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
