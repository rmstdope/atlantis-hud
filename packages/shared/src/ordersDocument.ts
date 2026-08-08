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

function isDocumentDirective(line: string): boolean {
  return line.trim() === DOCUMENT_END || line.trim().startsWith("#atlantis");
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

    // A closing directive belongs to the document, not to the last unit above it.
    while (end >= block.firstLine && isDocumentDirective(lines[end] ?? "")) {
      end -= 1;
    }
    // Neither do the blank lines separating one unit from the next.
    while (end >= block.firstLine && (lines[end] ?? "").trim() === "") {
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
  const replacement = orders === "" ? [] : orders.split("\n");
  const before = lines.slice(0, block.firstLine);
  const after = lines.slice(block.lastLine + 1);

  return [...before, ...replacement, ...after].join("\n");
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
