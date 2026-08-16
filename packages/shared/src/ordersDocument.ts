import { MOVEMENT_ORDER_COMMANDS } from "@atlantis/core-client";

/**
 * Projects one unit's orders out of the faction's orders document, and splices edits back.
 *
 * The document is the record, not a rendering of one. It arrives from the report's orders template
 * complete with the `#atlantis` line, the region banners and the game's descriptive comments, and
 * it must go back to the server in that form. So the editor never rebuilds it: it reads out the
 * lines belonging to the selected unit and writes the edited lines back into the same place,
 * leaving every other byte untouched.
 *
 * The `#atlantis` line carries the faction password. It is never surfaced and never logged.
 */

/** Where one unit's orders sit inside the document, as line indices. */
export type UnitBlock = {
  unitId: string;
  /** Index of the `unit <id>` line itself. */
  headerLine: number;
  /** First and last line of the unit's own content, exclusive of the header. */
  firstLine: number;
  lastLine: number;
};

const UNIT_LINE = /^unit\s+(\S+)\s*$/u;
const DOCUMENT_END = "#end";
/** `;*** mountain (7,53) in Inhead, contains Inholm [city] ***`, one before each region's units. */
const REGION_BANNER = /^;\*\*\*/u;

/**
 * Whether a line is the document's own furniture rather than any unit's orders.
 *
 * The banner matters as much as the directives. It announces the *next* region, so it sits between
 * the last unit of one region and the first unit of the next - and a block that runs to the line
 * before the next `unit` swallows it, putting another region's heading in this unit's editor and
 * appending everything typed afterwards below it.
 */
function belongsToDocument(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === "" ||
    trimmed === DOCUMENT_END ||
    trimmed.startsWith("#atlantis") ||
    REGION_BANNER.test(trimmed)
  );
}

/** Finds every unit block in a document. */
export function findUnitBlocks(document: string): UnitBlock[] {
  const lines = document.split("\n");
  const blocks: UnitBlock[] = [];

  lines.forEach((line, index) => {
    const match = UNIT_LINE.exec(line.trim());
    if (match?.[1]) {
      blocks.push({
        unitId: match[1],
        headerLine: index,
        firstLine: index + 1,
        lastLine: index
      });
    }
  });

  blocks.forEach((block, position) => {
    const next = blocks[position + 1];
    let end = next ? next.headerLine - 1 : lines.length - 1;

    // Wind back over everything between this unit's last order and the next unit's header: the
    // separating blank lines, the closing directive, and the banner announcing the next region.
    // None of them belong to the unit above them, and they arrive in no fixed order.
    while (end >= block.firstLine && belongsToDocument(lines[end] ?? "")) {
      end -= 1;
    }

    block.lastLine = end;
  });

  return blocks;
}

/** Reads one unit's lines out of the document, or `null` when it has no block. */
export function readUnitOrders(document: string, unitId: string): string | null {
  const block = findUnitBlocks(document).find((candidate) => candidate.unitId === unitId);
  if (!block) {
    return null;
  }

  const lines = document.split("\n");
  if (block.lastLine < block.firstLine) {
    return "";
  }
  return lines.slice(block.firstLine, block.lastLine + 1).join("\n");
}

/**
 * Writes one unit's lines back, leaving the rest of the document byte for byte as it was.
 *
 * A unit with no block yet is left alone rather than invented: a unit the server did not list is
 * not one the player can order, and silently adding a block would produce an orders file the server
 * would reject.
 */
export function writeUnitOrders(document: string, unitId: string, orders: string): string {
  const block = findUnitBlocks(document).find((candidate) => candidate.unitId === unitId);
  if (!block) {
    return document;
  }

  const lines = document.split("\n");
  // Trailing blank lines are dropped rather than written. The editor keeps one while a line is
  // being opened, which is what makes Enter work, but a block read back never includes it - so a
  // blank line written here would sit above the next write instead of being replaced by it, and
  // every line the player opened would leave one behind for good.
  const kept = withoutTrailingBlankLines(orders);
  const replacement = kept === "" ? [] : kept.split("\n");
  const before = lines.slice(0, block.firstLine);
  const after = lines.slice(block.lastLine + 1);

  return [...before, ...replacement, ...after].join("\n");
}

/**
 * The document with the server's unit descriptions thrown away.
 *
 * Every `unit` block in a report's template opens with a description of that unit - name, flags,
 * weight, capacity, every skill and everything it could study - wrapped over as many `;` lines as
 * it takes, which for a leader is eight. The unit panel already says all of it, so in the editor it
 * is nothing but the thing you have to scroll past to write an order, and on a unit with no orders
 * yet it is the entire contents.
 *
 * Only inside a block, which is what spares the region banners and the `#atlantis` line. Only a
 * line whose first non-blank character is `;`, which is what spares `@;` - a repeating comment is
 * an order the server acts on rather than something it wrote. Leading blanks are ignored because
 * the server indents a description's continuation lines and a player may indent anything.
 *
 * Meant for a template as it arrives, not for a document already in play: a `;` line in a saved
 * draft was typed by the player and is theirs to keep.
 */
/**
 * Whether a line is the server's own descriptive comment rather than an order.
 *
 * First non-blank character `;`, but not `@;` - a repeating comment is an order the server acts
 * on, not something it wrote. Shared between {@link stripUnitComments} and {@link withUnitComments}
 * so the two can never disagree about what a description line looks like.
 */
function isServerCommentLine(line: string): boolean {
  return line.trim().startsWith(";");
}

export function stripUnitComments(document: string): string {
  const lines = document.split("\n");
  const descriptions = new Set<number>();

  for (const block of findUnitBlocks(document)) {
    for (let index = block.firstLine; index <= block.lastLine; index += 1) {
      if (isServerCommentLine(lines[index] ?? "")) {
        descriptions.add(index);
      }
    }
  }

  return lines.filter((_, index) => !descriptions.has(index)).join("\n");
}

/**
 * The inverse of {@link stripUnitComments}: puts the server's own description back under each
 * unit's `unit` line, exactly as the template carried it.
 *
 * `template` is the report's own long-format orders template - the same text `stripUnitComments`
 * strips from, not the document in play. `document` is matched against it by unit id, using
 * {@link findUnitBlocks} on both so the two can never disagree about where a block starts and
 * ends. A unit the template does not know (formed this turn, say) is left exactly as it was: no
 * error, no invented description.
 *
 * The player's own lines are never touched - they simply end up below the restored description,
 * in the order they were already in.
 */
export function withUnitComments(document: string, template: string): string {
  const templateLines = template.split("\n");
  const descriptionsByUnit = new Map<string, string[]>();

  for (const block of findUnitBlocks(template)) {
    const description = templateLines
      .slice(block.firstLine, block.lastLine + 1)
      .filter((line) => isServerCommentLine(line));
    if (description.length > 0) {
      descriptionsByUnit.set(block.unitId, description);
    }
  }

  if (descriptionsByUnit.size === 0) {
    return document;
  }

  const lines = document.split("\n");
  const blocks = findUnitBlocks(document);

  // Inserted from the bottom up, so an earlier insertion never shifts the header line index a
  // later one was computed against.
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    const description = descriptionsByUnit.get(block.unitId);
    if (description) {
      lines.splice(block.headerLine + 1, 0, ...description);
    }
  }

  return lines.join("\n");
}

/**
 * The text with any blank lines at the end removed.
 *
 * The one thing a block cannot hold. A blank line at the end of one is indistinguishable from the
 * blank line separating it from the next unit, so the document gives back less than it was handed -
 * which is why the editor compares what it sent this way rather than taking the answer whole.
 */
export function withoutTrailingBlankLines(text: string): string {
  const lines = text.split("\n");
  let end = lines.length;

  while (end > 0 && (lines[end - 1] ?? "").trim() === "") {
    end -= 1;
  }

  return lines.slice(0, end).join("\n");
}

/**
 * The orders a unit has, with the game's descriptive comments dropped.
 *
 * The comments stay in the document, so this is a reading aid rather than an edit.
 */
export function commandsOnly(orders: string): string[] {
  return orders
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith(";"));
}

/** Whether the document still carries the header the server requires. */
export function hasFactionHeader(document: string): boolean {
  return document.split("\n").some((line) => line.trim().startsWith("#atlantis"));
}

/** A line that is one of the core's movement orders, `@`-repeated or not. */
const MOVEMENT_ORDER_LINE = new RegExp(`^\\s*@?\\s*(${MOVEMENT_ORDER_COMMANDS.join("|")})\\b`, "iu");

/**
 * A unit's orders with any existing movement order removed, so a newly planned route replaces
 * whichever one was there before rather than sitting alongside it.
 *
 * MOVE, ADVANCE and SAIL are all movement orders in this sense: a planned land route always
 * replaces a land order, and a planned sea route always replaces a written SAIL, whichever kind was
 * there originally - the planner only ever writes the one that matches the mode it found.
 */
export function stripMovementOrderLines(orders: string): string {
  return orders
    .split("\n")
    .filter((line) => !MOVEMENT_ORDER_LINE.test(line))
    .join("\n")
    .trim();
}
