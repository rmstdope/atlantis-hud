import { MOVEMENT_ORDER_COMMANDS } from "@atlantis/core-client";
import { passwordIsSendable } from "./workspace/ordersUpload";

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

export function regionBannerLine(
  region: {
    terrain: string;
    coordinate: { x: number; y: number; z: number };
    province: string;
    settlement: { name: string; size: string } | null;
  },
  levelField: string | null
): string {
  const coordinate = `(${region.coordinate.x},${region.coordinate.y}${levelField === null ? "" : `,${levelField}`})`;
  const settlement = region.settlement
    ? `, contains ${region.settlement.name} [${region.settlement.size}]`
    : "";
  return `;*** ${region.terrain} ${coordinate} in ${region.province}${settlement} ***`;
}

export function ensureUnitBlock(document: string, unitId: string, banner: string): string {
  if (findUnitBlocks(document).some((block) => block.unitId === unitId)) return document;
  const lines = document.split("\n");
  const bannerIndex = lines.findIndex((line) => line.trim() === banner.trim());
  let at: number;
  if (bannerIndex >= 0) {
    let regionEnd = lines.findIndex((line, index) => index > bannerIndex && REGION_BANNER.test(line));
    if (regionEnd < 0) {
      regionEnd = lines.findIndex(
        (line, index) => index > bannerIndex && DOCUMENT_END_LINE.test(line.trim())
      );
    }
    const end = regionEnd >= 0 ? regionEnd : lines.length;
    const mine = findUnitBlocks(document).filter((block) => block.headerLine > bannerIndex && block.headerLine < end);
    at = mine.length > 0 ? mine[mine.length - 1].lastLine + 1 : bannerIndex + 1;
    lines.splice(at, 0, "", `unit ${unitId}`);
  } else {
    const end = lines.findIndex((line) => DOCUMENT_END_LINE.test(line.trim()));
    at = end >= 0 ? end : lines.length;
    const prefix = at > 0 && lines[at - 1].trim() !== "" ? [""] : [];
    lines.splice(at, 0, ...prefix, banner, "", `unit ${unitId}`, "");
  }
  return lines.join("\n");
}

export function seedOrdersDocument(templateText: string, factionId: string | null): string {
  if (templateText.trim() !== "" || factionId === null) return templateText;
  return [
    "; This report carried no orders template, so this file was started from scratch.",
    `; If your faction has a password, add it: #atlantis ${factionId} "your password"`,
    `#atlantis ${factionId}`,
    "",
    "#end"
  ].join("\n");
}

export function applyUnitOrders(document: string, unitId: string, orders: string, banner: string | null): string {
  const base = orders === "" || banner === null ? document : ensureUnitBlock(document, unitId, banner);
  return writeUnitOrders(base, unitId, orders);
}

const UNIT_LINE = /^unit\s+(\S+)\s*$/iu;
const DOCUMENT_END_LINE = /^#end$/iu;
/** `;*** mountain (7,53) in Inhead, contains Inholm [city] ***`, one before each region's units. */
const REGION_BANNER = /^;\*\*\*/u;
const ATLANTIS_HEADER_LINE = /^#atlantis\b/iu;

/**
 * Whether a line is the document's own furniture rather than any unit's orders.
 *
 * The banner matters as much as the directives. It announces the *next* region, so it sits between
 * the last unit of one region and the first unit of the next - and a block that runs to the line
 * before the next `unit` swallows it, putting another region's heading in this unit's editor and
 * appending everything typed afterwards below it.
 *
 * Case-insensitively, for `#end` and `#atlantis` alike: "The parser is not case sensitive, so all
 * commands may be given in upper case, lower case or a mixture of the two... [this] applies to the
 * #ATLANTIS and #END lines as well as to order lines"
 * (https://atlantis-pbem.com/rules). A document this app itself
 * writes is always lowercase, which is easy to mistake for the only shape worth reading - a hand-
 * edited file, or one written by another client, is under no obligation to match it.
 */
function belongsToDocument(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === "" ||
    DOCUMENT_END_LINE.test(trimmed) ||
    ATLANTIS_HEADER_LINE.test(trimmed) ||
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
  return document.split("\n").some((line) => ATLANTIS_HEADER_LINE.test(line.trim()));
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

/**
 * The document with the typed password written into its `#atlantis` line, on a copy.
 *
 * The engine traditionally authenticates from that line, so a document uploaded with a stale or
 * blank header password can have its turn rejected after the upload appeared to succeed. The id the
 * line already carried is kept, and every other byte of the document is left exactly as it was -
 * the same splice-and-rejoin discipline `writeUnitOrders` keeps. A document with no such line comes
 * back unchanged.
 *
 * This writes a password in and returns; it never reads one out, so the module's promise that the
 * password is never surfaced and never logged still holds.
 */
export function withFactionPassword(document: string, password: string): string {
  // A password carrying a quote or a line break would not be written into the line, it would forge
  // one - a second `#atlantis` directive the server would read instead. Refused rather than escaped:
  // the Atlantis orders format has no escape for either.
  if (!passwordIsSendable(password)) {
    throw new Error("This password cannot be written into the orders header as it is written.");
  }

  const lines = document.split("\n");
  const index = lines.findIndex((line) => FACTION_HEADER.test(line));
  if (index === -1) {
    return document;
  }

  // Everything about the line except the password is kept: its indentation, the id it carried, and
  // the `\r` of a document written with CRLF endings - which is a byte the rest of the document
  // still has, so dropping it here would leave the uploaded copy mixed.
  const [, indent, id = "", carriageReturn = ""] = FACTION_HEADER.exec(lines[index]) ?? [];
  lines[index] = `${indent}#atlantis${id === "" ? "" : ` ${id}`} "${password}"${carriageReturn}`;
  return lines.join("\n");
}

/**
 * The header line, with what must survive a rewrite of it.
 *
 * Anchored on a word boundary so `#atlantisfoo` is not mistaken for it, and the id is read only as
 * a bare token - an old password, which is quoted, is deliberately not captured as one.
 */
const FACTION_HEADER = /^([ \t]*)#atlantis\b[ \t]*([^\s"]*)[^\r]*(\r?)$/;

/**
 * The orders that occupy a unit's whole month, exactly as the rules name them: "The orders which
 * take an entire month are ADVANCE, BUILD, ENTERTAIN, MOVE, PILLAGE, PRODUCE, SAIL, STUDY, TAX,
 * TEACH and WORK." A unit can issue as many other orders as it likes alongside these (GIVE, GUARD,
 * CLAIM, AUTOTAX...), but only one of these eleven counts.
 *
 * Not the Rust core's `MOVEMENT_ORDER_COMMANDS`: that list exists for the planner, which only ever
 * needs to know a movement order from a non-movement one. This is the ruleset's own full list.
 */
export const LONG_ORDER_COMMANDS = [
  "ADVANCE",
  "BUILD",
  "ENTERTAIN",
  "MOVE",
  "PILLAGE",
  "PRODUCE",
  "SAIL",
  "STUDY",
  "TAX",
  "TEACH",
  "WORK"
] as const;

/** A line that is one of the eleven month-long orders, `@`-repeated or not. */
const LONG_ORDER_LINE = new RegExp(`^\\s*@?\\s*(${LONG_ORDER_COMMANDS.join("|")})\\b`, "iu");

/**
 * The month-long order a unit's orders currently carry, if the document has one - for a display
 * that wants to say what a unit is actually going to spend its month on, at a glance. Comments and
 * blank lines are never it; if a document somehow holds two, the first is what the game will keep,
 * so the first is what is shown.
 */
export function longOrderOf(orders: string): string | null {
  return commandsOnly(orders).find((line) => LONG_ORDER_LINE.test(line)) ?? null;
}
