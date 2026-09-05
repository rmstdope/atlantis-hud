import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UnreadableLine } from "@atlantis/core-client";
import { UnreadableCopyButton } from "./UnreadableLinesList";

/**
 * The net under `ah-lyg6.4.1`'s extraction of `CopyButton`: this button's label, test id and
 * classes are what `tests/smoke` and the report panel rely on, and none of them may move.
 *
 * `renderToStaticMarkup` runs no effects and fires no timers (`packages/shared` has no jsdom, by
 * decision - ah-nass), so the two-second "Copied" flash is proved in the smoke suite instead.
 */
const entries: UnreadableLine[] = [
  { kind: "unit", lineStart: 412, lineEnd: 412, text: "* Smiley (100)", lost: null }
];

describe("UnreadableCopyButton", () => {
  it("the_unreadable_copy_button_renders_copy_all_with_its_test_id", () => {
    const html = renderToStaticMarkup(
      <UnreadableCopyButton entries={entries} turnNumber={71} factionLabel="Borg (73)" />
    );
    expect(html).toContain('data-testid="unreadable-copy"');
    expect(html).toContain(
      'class="rounded border border-edge px-1.5 text-ink-dim hover:text-ink"'
    );
    expect(html).toContain(">Copy all</button>");
  });
});
