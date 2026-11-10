/**
 * The rules of an assistant's write to the orders document (ah-a97xg.9).
 *
 * Every read of an own unit's orders carries a version, and every write hands it back: a write
 * whose version no longer matches the unit's block is refused, so orders the player typed after
 * the assistant read them are never silently replaced. The version is a function of the block's
 * text alone, so there is nothing to store or forget - a block changed and changed back has its
 * old version again, which is right: the assistant's picture of it is true again.
 *
 * Plain functions with no host, so every rule is testable on its own (ah-nass).
 */

/** One unit's part of a write: its whole orders, or lines to remove and lines to add. */
export type UnitWrite = {
  readonly unitId: string;
  readonly version: string;
  readonly orders?: string;
  readonly add?: readonly string[];
  readonly remove?: readonly string[];
};

/** The version of a unit's orders as `readUnitOrders` gives them: eight hex digits of FNV-1a. */
export function ordersVersion(orders: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < orders.length; index += 1) {
    hash ^= orders.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * `current` with each `remove` line taken out - the first line equal to it once surrounding spaces
 * are trimmed - and then each `add` line appended at the end. Lines it cannot find are answered
 * instead, since a guess would edit an order the assistant did not mean.
 */
export function editedOrders(
  current: string,
  edit: { readonly add?: readonly string[]; readonly remove?: readonly string[] }
): string | { missing: string[] } {
  const lines = current === "" ? [] : current.split("\n");
  const missing: string[] = [];
  for (const line of edit.remove ?? []) {
    const at = lines.findIndex((candidate) => candidate.trim() === line.trim());
    if (at === -1) {
      missing.push(line);
    } else {
      lines.splice(at, 1);
    }
  }
  if (missing.length > 0) {
    return { missing };
  }
  return [...lines, ...(edit.add ?? [])].join("\n");
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function linesOf(value: unknown, name: string, unitId: string): readonly string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((line) => typeof line !== "string")) {
    throw new Error(`Unit ${unitId}: "${name}" must be a list of order lines.`);
  }
  return value as string[];
}

/** The `units` of a write, read strictly: throws a sentence naming what is wrong. */
export function parseUnitWrites(units: unknown): UnitWrite[] {
  if (!Array.isArray(units) || units.length === 0) {
    throw new Error('"units" must list at least one unit to write.');
  }
  const seen = new Set<string>();
  return units.map((entry: unknown) => {
    const fields = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const unitId = textOf(fields.unitId) ?? fail('Every unit needs its "unitId".');
    const version = textOf(fields.version) ?? fail(`Unit ${unitId} needs the "version" its orders were read with.`);
    if (seen.has(unitId)) {
      fail(`Unit ${unitId} is named twice; give each unit once.`);
    }
    seen.add(unitId);
    const orders = fields.orders === undefined || fields.orders === null ? undefined : fields.orders;
    if (orders !== undefined && typeof orders !== "string") {
      fail(`Unit ${unitId}: "orders" must be text, one order per line.`);
    }
    const add = linesOf(fields.add, "add", unitId);
    const remove = linesOf(fields.remove, "remove", unitId);
    const edits = add !== undefined || remove !== undefined;
    if ((orders === undefined) === !edits) {
      fail(`Unit ${unitId}: give either "orders" (the whole block) or "add"/"remove" (single lines).`);
    }
    return {
      unitId,
      version,
      ...(orders !== undefined ? { orders } : {}),
      ...(add !== undefined ? { add } : {}),
      ...(remove !== undefined ? { remove } : {})
    };
  });
}

function fail(message: string): never {
  throw new Error(message);
}
