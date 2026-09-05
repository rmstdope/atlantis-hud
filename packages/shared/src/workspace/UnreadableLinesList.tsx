import { useMemo } from "react";
import type { UnreadableLine } from "@atlantis/core-client";
import {
  unreadableClipboardText,
  unreadableCostNote,
  unreadableKindLabel,
  unreadableLineRange
} from "../unreadableLines";
import { CopyButton } from "./CopyButton";

/**
 * Every line of the loaded report the parser could not read, verbatim.
 *
 * A dropped line used to leave no trace at all: a player looking at a hex simply did not see one of
 * their own units. This is the whole of the remedy - it never guesses at what a line meant, it only
 * says what was lost and lets the player go and look.
 *
 * Nothing is truncated and nothing is capped: a shortened list would be a second silence about the
 * same report. Rebuilt from the loaded report on every open, so it follows a turn switch and comes
 * back after a reload, and there is nothing to dismiss permanently.
 *
 * The body of the turn-report panel's "Not read" tab, and nothing else: the frame, the header line,
 * the scroller and the footer are the panel's (ah-30hg.2).
 */
export function UnreadableLinesList({ entries }: { entries: readonly UnreadableLine[] }) {
  return (
    <ul data-testid="unreadable-lines" className="m-0 list-none space-y-2">
      {entries.map((entry, index) => {
        const cost = unreadableCostNote(entry);
        return (
          <li
            key={`${entry.lineStart}-${entry.lineEnd}-${index}`}
            data-testid="unreadable-entry"
            data-kind={entry.kind}
            // Stacked below `sm`, so the raw text never loses width at the one size where it is
            // hardest to read.
            className="grid grid-cols-1 gap-x-2 gap-y-0.5 sm:grid-cols-[5rem_4.5rem_1fr]"
          >
            <span className="font-mono text-ink-dim">{unreadableLineRange(entry)}</span>
            <span className="text-ink-soft">{unreadableKindLabel(entry.kind)}</span>
            <div className="sm:col-start-3">
              <pre
                className={`m-0 overflow-hidden whitespace-pre-wrap break-all border-l-2 ${
                  entry.kind === "region" ? "border-l-danger" : "border-l-warn"
                } pl-2 font-mono text-ink`}
              >
                {entry.text}
              </pre>
              {cost ? <p className="m-0 pl-2 text-danger">{cost}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Puts every unread line on the clipboard, for a bug report.
 *
 * Lives in the report panel's header row, and only while the "Not read" tab is the open one - it
 * copies that tab's list, not the panel's (ah-30hg.2, round 5, H2).
 */
export function UnreadableCopyButton({
  entries,
  turnNumber,
  factionLabel
}: {
  entries: readonly UnreadableLine[];
  /** From `parsed.header.turnNumber`, which is nullable. */
  turnNumber: number | null;
  /** `Borg (73)`, or null when the report does not name both parts. */
  factionLabel: string | null;
}) {
  // Built on click rather than on every render of the panel: a report with many unreadable lines
  // makes this a long string, and the panel re-renders as the workspace does.
  const text = useMemo(
    () => unreadableClipboardText(entries, turnNumber, factionLabel),
    [entries, turnNumber, factionLabel]
  );

  return (
    <CopyButton
      text={text}
      label="Copy all"
      testId="unreadable-copy"
      className="rounded border border-edge px-1.5 text-ink-dim hover:text-ink"
    />
  );
}
