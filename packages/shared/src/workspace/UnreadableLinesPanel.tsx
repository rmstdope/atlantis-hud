import { useState } from "react";
import type { UnreadableLine } from "@atlantis/core-client";
import { copyText } from "../copyText";
import {
  unreadableClipboardText,
  unreadableCostNote,
  unreadableKindLabel,
  unreadableLineRange
} from "../unreadableLines";
import { POPOVER_BODY_MAX_H } from "./primitives";
import { PopoverFrame } from "./popover";

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
 */
export function UnreadableLinesPanel({
  entries,
  turnNumber,
  factionLabel,
  onDismiss
}: {
  entries: readonly UnreadableLine[];
  /** From `parsed.header.turnNumber`, which is nullable. */
  turnNumber: number | null;
  /** `Borg (73)`, or null when the report does not name both parts. */
  factionLabel: string | null;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <PopoverFrame
      testId="unreadable-lines"
      label="Lines that could not be read"
      align="right"
      width="w-[32rem] max-w-[calc(100vw-2rem)]"
    >
      <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
        <span className="text-ink-soft">Lines that could not be read</span>
        <span className="flex-1" />
        <button
          type="button"
          data-testid="unreadable-copy"
          onClick={() => {
            void copyText(unreadableClipboardText(entries, turnNumber, factionLabel)).then(
              (ok) => {
                if (!ok) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            );
          }}
          className="rounded border border-edge px-1.5 text-ink-dim hover:text-ink"
        >
          {copied ? "Copied" : "Copy all"}
        </button>
        <button
          type="button"
          aria-label="close unreadable lines"
          onClick={onDismiss}
          className="rounded px-1.5 text-ink-dim hover:text-ink"
        >
          ✕
        </button>
      </div>

      <ul className={`${POPOVER_BODY_MAX_H} m-0 list-none space-y-2 overflow-y-auto p-2`}>
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

      <p className="border-t border-edge px-2 py-1.5 text-ink-dim">None of this reached the map.</p>
    </PopoverFrame>
  );
}
