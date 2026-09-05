import { useEffect, useRef, useState } from "react";
import { copyText } from "../copyText";

/**
 * A button that puts `text` on the clipboard and says so for two seconds (`ah-lyg6.4.1`).
 *
 * Extracted from `UnreadableCopyButton`, which was the application's one copy-to-clipboard button
 * until the study planner's Orders tab wanted four more of it.
 *
 * A refusal changes nothing at all, which is `copyText`'s own stated contract: the text it would
 * have copied is on screen and selectable, so a failed copy costs the player nothing worth a
 * second notice.
 */
export function CopyButton({
  text,
  label,
  copiedLabel = "Copied",
  testId,
  className,
  disabled = false
}: {
  text: string;
  /** The idle label, e.g. `Copy` or `Copy all`. */
  label: string;
  copiedLabel?: string;
  testId: string;
  className?: string;
  /** Greyed and inert, for a caller holding a question open over it. */
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  // Cleared on unmount: this button now has five instances, four of them inside a dialog the
  // player closes with Escape, so a copy two seconds before that would set state on a dead one.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          timer.current = setTimeout(() => setCopied(false), 2000);
        });
      }}
      className={className}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
