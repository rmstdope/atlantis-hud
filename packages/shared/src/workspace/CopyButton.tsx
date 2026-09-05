import { useState } from "react";
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
  className
}: {
  text: string;
  /** The idle label, e.g. `Copy` or `Copy all`. */
  label: string;
  copiedLabel?: string;
  testId: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className={className}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
