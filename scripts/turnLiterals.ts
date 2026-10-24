import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Finds a walk that writes a HUD turn number out by hand (ah-iuofk).
 *
 * HUD numbers a turn from the report's date, and ah-m6pw's renumbering had to edit 19 smoke specs
 * and both native ones because each repeated the numbers it got - "restored turn 72",
 * `/Turn\s*72\b/`, `turn-row-71`. The walks now take a turn from `@atlantis/fixtures`'
 * `REPORT_TURNS`; this keeps a literal from creeping back into a walk about something else.
 *
 * A line is flagged when it is code rather than a comment and holds `turn <digits>`,
 * `turn-row-<digits>`, a `Turn\s*<digits>` pattern, a turn field set to or compared with a number (`turn_number: 72`), a comparison's `⇄ 71`, an
 * asserted file name HUD writes from the turn (`orders-turn-72.txt`), a study-planner test id
 * ending in its turn,
 * or a bare number asked of the header or the turn chip. Line by line, so a selector and its
 * assertion split over two lines are not seen together; the walks keep them on one. A number that is not HUD's date-derived turn
 * at all - an AtlaClient export's own stamp, a server's turn id a walk mocks - is marked on its own
 * line, or the line above, with `turn-literal:` and the reason.
 */
export interface TurnLiteral {
  file: string;
  line: number;
  text: string;
}

const LITERAL = new RegExp(
  [
    // "restored turn 72", "turn-row-71", /Turn\s*72\b/
    String.raw`\b[Tt]urn(?:\s+|\\s\*|\\s\+|-row-)\d+`,
    // turn_number: 72, seenTurn: 72, "Report turn: 72", turn_number === 72
    String.raw`\b\w*[Tt]urn\w*["']?\s*(?::|={2,3})\s*\d+`,
    // "⇄ 71", the turn a comparison is against
    String.raw`⇄\s*\d+`,
    // a file name HUD writes from the turn, asserted: orders-turn-72.txt, map-turn-72-level-1.txt
    String.raw`(?:expect|toBe|toMatch|defaultPath).*-turn-\d+(?:\\?\.txt|-level)`,
    String.raw`"/[^"]*-turn-\d+\.txt"`,
    // a study-planner test id ending in its turn: study-schedule-cell-${MAGE}-73, …-remove-74
    String.raw`study-schedule-(?:cell|cast|turn|remove|insert)-(?:[^"\x60]*-)?\d+["\x60]`,
    // the header or the turn chip asked for a bare number, in Playwright's words or WebdriverIO's
    String.raw`(?:app-header|turn-chip)\W[^;]*(?:toContainText|stringContaining)\("\d+"\)`
  ].join("|"),
  "u"
);
const MARKER = "turn-literal:";

/** Every unmarked turn literal in one file's text. */
export function turnLiterals(file: string, text: string): TurnLiteral[] {
  const lines = text.split("\n");
  const found: TurnLiteral[] = [];
  let inBlockComment = false;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (inBlockComment) {
      inBlockComment = !trimmed.includes("*/");
      return;
    }
    if (trimmed.startsWith("/*")) {
      inBlockComment = !trimmed.includes("*/");
      return;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || !LITERAL.test(line)) {
      return;
    }
    if (line.includes(MARKER) || (lines[index - 1] ?? "").includes(MARKER)) {
      return;
    }
    found.push({ file, line: index + 1, text: trimmed });
  });
  return found;
}

/** Every unmarked turn literal in the `.ts` files of `dir`, skipping the names in `exempt`. */
export function turnLiteralsIn(dir: string, exempt: readonly string[]): TurnLiteral[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !exempt.includes(name))
    .sort()
    .flatMap((name) => turnLiterals(name, readFileSync(join(dir, name), "utf8")));
}
