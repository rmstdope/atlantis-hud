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

/** Where a `FORM` block sits inside the document, as line indices. */
export type FormBlock = {
  /** The alias exactly as the `form` line wrote it, so `"1"` for `form 1`. */
  alias: string;
  /** The reported unit whose `unit <id>` block encloses it, however deep the `FORM` nesting. */
  unitId: string;
  /** Index of the `form <alias>` line itself. */
  headerLine: number;
  /** First and last line of the formed unit's own content, exclusive of `form` and `end`. */
  firstLine: number;
  lastLine: number;
  /** Index in this array of the `FORM` block enclosing it, or `null` at a unit block's top level. */
  parentIndex: number | null;
};

/** The first non-blank token of a line, lowercased, with a leading `@` and comments accounted for. */
function firstToken(line: string): string | null {
  const trimmed = line.trim();
  // "anything after a semicolon is treated as a comment" (rules/orders), so a line opening with
  // one carries no order at all. `@;` is a repeating comment and is equally not a block keyword.
  if (trimmed === "" || trimmed.startsWith(";")) {
    return null;
  }
  // "You may precede orders with the at sign (@)" (rules/orders), and "The parser is not case
  // sensitive" - so the keyword is read past an optional `@` and folded to lower case.
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;
  if (withoutAt === "" || withoutAt.startsWith(";")) {
    return null;
  }
  return (withoutAt.split(/\s+/u)[0] ?? "").toLowerCase();
}

/** The arguments of a line, after its keyword. */
function argumentsOf(line: string): string[] {
  const trimmed = line.trim();
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;
  return withoutAt.split(/\s+/u).slice(1);
}

/** An alias the game accepts: a run of digits naming at least 1 (`rules/form`, `forms::read_alias`). */
function readAlias(token: string | undefined): string | null {
  if (token === undefined || !/^[0-9]+$/u.test(token)) {
    return null;
  }
  return token.replace(/^0+/u, "") === "" ? null : token;
}

type OpenBlock = { kind: "turn" | "form"; index: number | null; headerLine: number };

/**
 * Every syntactically formed `FORM` block, in document order.
 *
 * Mirrors `crates/core/src/orders/walk.rs` and `intents.rs`'s `FormReader`, and invents no rules of
 * its own. It is mirrored rather than called for the same reason `orderIndent.ts` mirrors the same
 * walk: the need is synchronous and per-keystroke, and `CoreClient.validateOrders` is a debounced
 * round trip.
 *
 * A `FORM` the game would not read - inside a `TURN`, with an alias that is not a number of at
 * least one, outside any reported unit's block, or nested inside one of those - is still *opened*,
 * so its orders never fall through to whatever encloses it, but it is never returned.
 */
export function findFormBlocks(document: string): FormBlock[] {
  const lines = document.split("\n");
  const blocks: FormBlock[] = [];
  const stack: OpenBlock[] = [];
  let currentUnit: string | null = null;

  /** Closes an open block at `index`, ending its content on the line above `endsBefore`. */
  const close = (opened: OpenBlock, endsBefore: number): void => {
    if (opened.index === null) {
      return;
    }
    const block = blocks[opened.index];
    if (!block) {
      return;
    }
    let end = endsBefore - 1;
    while (end >= block.firstLine && belongsToDocument(lines[end] ?? "")) {
      end -= 1;
    }
    block.lastLine = end;
  };

  const closeAll = (endsBefore: number): void => {
    while (stack.length > 0) {
      close(stack.pop() as OpenBlock, endsBefore);
    }
  };

  lines.forEach((line, index) => {
    const command = firstToken(line);
    if (command === null) {
      return;
    }

    if (command.startsWith("#")) {
      closeAll(index);
      currentUnit = null;
      return;
    }

    if (command === "unit") {
      closeAll(index);
      // The enclosing reported unit is the first argument only when it is all digits
      // (`intents.rs`, which filters on `TokenKind::Number`) - which is what makes a stale
      // `unit new-1` block enclose no reported unit and form nothing.
      const first = argumentsOf(line)[0];
      currentUnit = first !== undefined && /^[0-9]+$/u.test(first) ? first : null;
      return;
    }

    if (command === "turn") {
      stack.push({ kind: "turn", index: null, headerLine: index });
      return;
    }

    if (command === "endturn") {
      const top = stack[stack.length - 1];
      if (top?.kind === "turn") {
        stack.pop();
        close(top, index);
      }
      return;
    }

    if (command === "form") {
      const insideTurn = stack.some((opened) => opened.kind === "turn");
      const alias = readAlias(argumentsOf(line)[0]);
      const parent = stack[stack.length - 1];
      const parentUsable = parent === undefined || parent.index !== null;
      if (insideTurn || alias === null || currentUnit === null || !parentUsable) {
        stack.push({ kind: "form", index: null, headerLine: index });
        return;
      }
      const position = blocks.length;
      blocks.push({
        alias,
        unitId: currentUnit,
        headerLine: index,
        firstLine: index + 1,
        lastLine: index,
        parentIndex: parent?.index ?? null
      });
      stack.push({ kind: "form", index: position, headerLine: index });
      return;
    }

    if (command === "end") {
      const top = stack[stack.length - 1];
      if (top?.kind === "form") {
        stack.pop();
        close(top, index);
      }
    }
  });

  closeAll(lines.length);

  return blocks;
}

/** The alias in a formed unit's id - `"1"` for `new-1` - or `null` for an id the report shows. */
export function formedAlias(unitId: string): string | null {
  const match = /^new-([0-9]+)$/u.exec(unitId);
  return match?.[1] ?? null;
}

/** What one load-time repair did, for the header line that reports it. */
export type FormedBlockRepair = {
  /** The document after the repair. Reference-identical to the input when nothing was repairable. */
  document: string;
  /** One entry per stale block folded back, in document order. */
  moved: { alias: string; orderCount: number }[];
  /** `new-<alias>` of every stale block that held nothing and lost its header alone. */
  emptied: string[];
  /** `new-<alias>` of every stale block with orders and no `FORM` in its region to take them. */
  orphaned: string[];
};

/**
 * Removes a stale block's header and body, and the blank line `ensureUnitBlock` put above it.
 *
 * The range is `max`ed because `findUnitBlocks` winds an empty block's `lastLine` back to its
 * header. The blank line above goes only when the line now standing where the block did is blank
 * too, or the document ends there - otherwise the repair would close a gap it did not open.
 */
function withoutBlockAt(lines: string[], headerLine: number, lastLine: number): string[] {
  const end = Math.max(lastLine, headerLine);
  let start = headerLine;
  const above = lines[headerLine - 1];
  const below = lines[end + 1];
  if (headerLine > 0 && (above ?? "").trim() === "" && (below === undefined || below.trim() === "")) {
    start = headerLine - 1;
  }
  return [...lines.slice(0, start), ...lines.slice(end + 1)];
}

/**
 * Folds every stale `unit new-<n>` block back into the `FORM` that creates it.
 *
 * Such a block could only be written before ah-ty3s.1 stopped `ensureUnitBlock` making them: it
 * names no unit the report lists, so the server refuses the file, and once `new-<n>` resolves to
 * its `FORM` block instead there is no editor that can reach the orders inside it. This puts them
 * back, once, as the document is loaded.
 *
 * Pure, and idempotent: running it on its own output changes nothing. Run once as a document is
 * loaded, never while typing.
 *
 * The loop repairs one block and recomputes rather than planning a set of splices - every repair
 * moves line indices, and one recomputation per block on a document of a few hundred lines is not
 * worth an off-by-one. `skip` steps past blocks left alone, which is what terminates it: a folded
 * or emptied block is gone and cannot be found again, an orphan is not. It counts rather than keys
 * on the id, because a document can hold two `unit new-1` blocks.
 */
export function repairFormedUnitBlocks(document: string): FormedBlockRepair {
  const moved: { alias: string; orderCount: number }[] = [];
  const emptied: string[] = [];
  const orphaned: string[] = [];
  let current = document;
  let skip = 0;

  for (;;) {
    const lines = current.split("\n");
    // The parser is not case sensitive (rules/orders), so a hand-edited file may say `unit NEW-1`.
    const stale = findUnitBlocks(current).filter(
      (block) => formedAlias(block.unitId.toLowerCase()) !== null
    )[skip];
    if (!stale) {
      break;
    }
    const alias = formedAlias(stale.unitId.toLowerCase()) as string;
    const body =
      stale.lastLine >= stale.firstLine
        ? lines.slice(stale.firstLine, stale.lastLine + 1).join("\n")
        : "";
    const text = withoutTrailingBlankLines(body);

    if (text === "") {
      current = withoutBlockAt(lines, stale.headerLine, stale.lastLine).join("\n");
      emptied.push(`new-${alias}`);
      continue;
    }

    // The region is read while the stale block is still in place - the banner it sits under is what
    // says where it stood - but the match is asked of the document actually written to, so the
    // guard cannot pass while `writeUnitOrders` silently declines and loses the orders with it.
    const regionUnitIds = regionUnitIdsAt(current, stale.headerLine);
    const without = withoutBlockAt(lines, stale.headerLine, stale.lastLine).join("\n");
    if (!formBlockFor(without, alias, regionUnitIds)) {
      orphaned.push(`new-${alias}`);
      skip += 1;
      continue;
    }

    const existing = readUnitOrders(without, `new-${alias}`, regionUnitIds) ?? "";
    const next = existing === "" ? text : `${existing}\n${text}`;
    current = writeUnitOrders(without, `new-${alias}`, next, regionUnitIds);
    // What "2 orders" means to a player: a blank line inside the block is not an order.
    moved.push({ alias, orderCount: text.split("\n").filter((line) => line.trim() !== "").length });
  }

  return { document: current, moved, emptied, orphaned };
}

/**
 * The reported units standing under the same `;***` region banner as `line`.
 *
 * Read out of the document rather than out of the report, because a stale `unit new-<n>` block
 * names no reported unit and so has no region of its own: the banner it was inserted under is what
 * says where it stood. The section runs from the greatest banner at or before `line` - or the start
 * of the document when there is none - to the next banner, or the end of the document.
 *
 * Only ids that are a run of digits count, matching `intents.rs`'s filter on `TokenKind::Number` -
 * the same rule that makes `unit new-1` enclose no reported unit and form nothing.
 *
 * A document with no banners at all is one section holding every unit, which is the honest answer
 * for a hand-written file that carries nothing to scope by.
 */
export function regionUnitIdsAt(document: string, line: number): ReadonlySet<string> {
  const lines = document.split("\n");

  let start = 0;
  for (let index = Math.min(line, lines.length - 1); index >= 0; index -= 1) {
    if (REGION_BANNER.test((lines[index] ?? "").trim())) {
      start = index;
      break;
    }
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (REGION_BANNER.test((lines[index] ?? "").trim())) {
      end = index;
      break;
    }
  }

  const ids = new Set<string>();
  for (const block of findUnitBlocks(document)) {
    if (block.headerLine >= start && block.headerLine < end && /^[0-9]+$/u.test(block.unitId)) {
      ids.add(block.unitId);
    }
  }
  return ids;
}

/**
 * The `FORM` block creating `new-<alias>` in the hex whose reported units are `regionUnitIds`,
 * or `null` when the document has none.
 *
 * The region is where the taken aliases live, because the core scopes an alias by the hex the unit
 * writing the `FORM` stands in (`intents.rs`): a second `form 1` in the same hex is swallowed by
 * the server rather than applied, and so is anything nested inside it. First wins.
 */
export function formBlockFor(
  document: string,
  alias: string,
  regionUnitIds: ReadonlySet<string>
): FormBlock | null {
  const blocks = findFormBlocks(document);
  const taken = new Set<string>();
  const swallowed = new Set<number>();

  for (const [index, block] of blocks.entries()) {
    if (!regionUnitIds.has(block.unitId)) {
      continue;
    }
    if (block.parentIndex !== null && swallowed.has(block.parentIndex)) {
      swallowed.add(index);
      continue;
    }
    if (taken.has(block.alias)) {
      swallowed.add(index);
      continue;
    }
    taken.add(block.alias);
    if (block.alias === alias) {
      return block;
    }
  }

  return null;
}

/**
 * Where one unit's editable lines sit: its own `unit` block, or the `FORM` block that creates it.
 *
 * `regionUnitIds` is the reported units of the hex the unit stands in, which is what a `NEW n`
 * alias is scoped by (`rules/form`). Omitted, a `new-<n>` id resolves to `null` - which is what
 * every caller with no hex in hand wants.
 */
export function blockFor(
  document: string,
  unitId: string,
  regionUnitIds?: ReadonlySet<string>
): UnitBlock | null {
  const alias = formedAlias(unitId);
  if (alias === null) {
    return findUnitBlocks(document).find((candidate) => candidate.unitId === unitId) ?? null;
  }
  if (!regionUnitIds) {
    return null;
  }
  const block = formBlockFor(document, alias, regionUnitIds);
  return block
    ? {
        unitId,
        headerLine: block.headerLine,
        firstLine: block.firstLine,
        lastLine: block.lastLine
      }
    : null;
}

/**
 * The `;***` banner line a report writes above a region's units in its orders template.
 *
 * `levelField` is the third component the report prints inside the coordinate - `null` on the
 * surface, `"nexus"` in the nexus, and so on (see `levelFieldOf`). The wording is the server's own,
 * reproduced byte for byte so a banner this app writes into a document is indistinguishable from
 * one the report brought with it; a corpus test pins that against every committed fixture.
 */
export function regionBannerLine(
  region: {
    terrain: string;
    coordinate: { x: number; y: number; z: number };
    province: string;
    settlement: { name: string; size: string } | null;
  },
  levelField: string | null
): string {
  const { x, y } = region.coordinate;
  const coordinate = levelField === null ? `${x},${y}` : `${x},${y},${levelField}`;
  const settlement = region.settlement
    ? `, contains ${region.settlement.name} [${region.settlement.size}]`
    : "";
  return `;*** ${region.terrain} (${coordinate}) in ${region.province}${settlement} ***`;
}

/**
 * Reads one unit's lines out of the document, or `null` when it has no block.
 *
 * `regionUnitIds` is the reported units of the hex on screen, which is what lets a `new-<n>` id
 * resolve to the `FORM` block that creates it.
 */
export function readUnitOrders(
  document: string,
  unitId: string,
  regionUnitIds?: ReadonlySet<string>
): string | null {
  const block = blockFor(document, unitId, regionUnitIds);
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
export function writeUnitOrders(
  document: string,
  unitId: string,
  orders: string,
  regionUnitIds?: ReadonlySet<string>
): string {
  const block = blockFor(document, unitId, regionUnitIds);
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
 * The orders document a freshly imported report starts from: its own template when it carries one,
 * and otherwise a minimal `#atlantis <faction>` ... `#end` skeleton so the turn is still orderable
 * and still exports as a valid orders file.
 *
 * A report carries no template when its faction has issued `OPTION TEMPLATE OFF` (`rules/option`),
 * and the rules make that a display choice rather than a loss of the right to give orders: the
 * template "gives you a formatted orders form... or write them on your own" (`rules/reportformat`).
 * Seeded silently - a player who turned the template off chose this and does not need telling.
 *
 * Unchanged when there is no faction id to write: nothing honest can be put in a header for a
 * faction the report did not name.
 *
 * That branch is unreachable from either import door since ah-brd: `judgeReportUsable`
 * (`reportLoadDecision.ts`) refuses a report naming no faction, and both `routeReport` and
 * `prepareBatch` run it first. Kept as defence for any future caller, and pinned by "the import
 * doors refuse a report that names no faction" in this module's test file.
 */
export function seedOrdersDocument(templateText: string, factionId: string | null): string {
  if (templateText.trim() !== "" || factionId === null) {
    return templateText;
  }

  // The two notes sit above the header, where `isOrdersFile`'s sniffer skips them and
  // `withFactionPassword`'s anchored pattern cannot mistake the second for the header itself. The
  // password one is there because a seeded header carries none, and a turn mailed without one is
  // silently ignored by the server.
  return [
    "; This report carried no orders template, so this file was started from scratch.",
    `; If your faction has a password, add it: #atlantis ${factionId} "your password"`,
    `#atlantis ${factionId}`,
    "",
    "#end"
  ].join("\n");
}

/**
 * The document with a `unit <id>` block for `unitId`, created under `banner` if it has none.
 *
 * The report's orders template is a convenience, not a permission list: an orders file is nothing
 * but `#atlantis`, some `unit` blocks and `#end` (`rules/orders`), and a player who has issued
 * `OPTION TEMPLATE OFF` (`rules/option`) receives no template at all and still writes orders every
 * turn. So a unit the template never listed is still orderable, and this is what makes room for it.
 *
 * Nothing already in the document ever moves: the new block goes after the last unit already
 * standing under the region's banner, or straight under the banner when it has none yet, or - when
 * the document carries no banner for the region at all - the banner is written too, before `#end`.
 * Unchanged when the unit already has a block.
 */
export function ensureUnitBlock(document: string, unitId: string, banner: string): string {
  // A unit this month's `FORM` orders create has no `unit` block and never gains one: its orders
  // live between its `form` line and its `end`, and a literal `unit new-1` block is a file the
  // server refuses. This is the guard, here rather than in each caller.
  if (formedAlias(unitId) !== null) {
    return document;
  }

  const blocks = findUnitBlocks(document);
  if (blocks.some((block) => block.unitId === unitId)) {
    return document;
  }

  const lines = document.split("\n");
  const wanted = banner.trim();
  const bannerIndex = lines.findIndex((line) => line.trim() === wanted);

  if (bannerIndex !== -1) {
    // The region ends at the next banner, or failing that at `#end`, or at the end of the file.
    let regionEnd = lines.findIndex(
      (line, index) => index > bannerIndex && REGION_BANNER.test(line.trim())
    );
    if (regionEnd === -1) {
      regionEnd = lines.findIndex((line) => DOCUMENT_END_LINE.test(line.trim()));
    }
    if (regionEnd === -1) {
      regionEnd = lines.length;
    }

    const mine = blocks.filter(
      (block) => block.headerLine > bannerIndex && block.headerLine < regionEnd
    );
    const last = mine[mine.length - 1];
    const at = last ? last.lastLine + 1 : bannerIndex + 1;
    lines.splice(at, 0, "", `unit ${unitId}`);
    return lines.join("\n");
  }

  let at = lines.findIndex((line) => DOCUMENT_END_LINE.test(line.trim()));
  if (at === -1) {
    at = lines.length;
  }
  const insertion = [banner, "", `unit ${unitId}`, ""];
  if (at > 0 && (lines[at - 1] ?? "").trim() !== "") {
    insertion.unshift("");
  }
  lines.splice(at, 0, ...insertion);
  return lines.join("\n");
}

/**
 * The document after one edit to a unit's block, creating the block if the unit has none.
 *
 * `banner` is `null` when the app cannot say which region the unit stands in; no block is created
 * then. Nor is one created for an edit that carries no text, which is what keeps merely clicking
 * round the map from writing into the file: the block appears on the first keystroke.
 *
 * The rule lives here rather than in the editor's callback so it can be tested directly.
 */
export function applyUnitOrders(
  document: string,
  unitId: string,
  orders: string,
  banner: string | null,
  regionUnitIds?: ReadonlySet<string>
): string {
  const base =
    orders === "" || banner === null ? document : ensureUnitBlock(document, unitId, banner);
  return writeUnitOrders(base, unitId, orders, regionUnitIds);
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
 * A unit's orders with every month-long order line removed, so a newly written one replaces
 * whichever was there rather than standing beside it: a unit spends its month on one of the eleven
 * (`rules/sequenceofevents`, and {@link LONG_ORDER_COMMANDS}).
 *
 * Unlike {@link stripMovementOrderLines} this does not `trim()`. That one is used on a block about
 * to be rewritten whole; here the surviving lines are the player's own and the first one's
 * indentation is part of what they wrote.
 */
export function stripLongOrderLines(orders: string): string {
  return orders
    .split("\n")
    .filter((line) => !LONG_ORDER_LINE.test(line))
    .join("\n");
}

/**
 * The month-long order a unit's orders currently carry, if the document has one - for a display
 * that wants to say what a unit is actually going to spend its month on, at a glance. Comments and
 * blank lines are never it; if a document somehow holds two, the first is what the game will keep,
 * so the first is what is shown.
 */
export function longOrderOf(orders: string): string | null {
  return commandsOnly(orders).find((line) => LONG_ORDER_LINE.test(line)) ?? null;
}
