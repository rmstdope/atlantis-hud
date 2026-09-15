import type { FactionStatus, ProductionOverview, ReportRegion, SlotOrder, WorkedRegion, WorkedResource, WorkedTax } from "@atlantis/core-client";

/**
 * The Production window's words and judgements (ah-nneu).
 *
 * The core sends facts - which regions this turn's orders tax, pillage or produce in, what their tax
 * collects and what each raw resource yields - and every string and every "is this a gap" is made
 * here, where a test can pin each word. The dialog only renders what this returns. The words are the
 * ones agreed at the design stage, verbatim (`docs/ui/ah-nneu-production.html`).
 */

export type Tone = "ok" | "gap" | "estimate";
export type ProductionCell = { text: string; tone: Tone };

export type CountLine = {
  label: "Regions" | "Tax regions" | "Trade regions";
  used: number;
  maximum: number;
  /** used / maximum clamped to 1; 1 when over; 0 when maximum is 0 and used is 0. */
  fraction: number;
  state: "room" | "full" | "over";
  /** "" when there is nothing to say. */
  note: string;
};

export type ProductionRow = {
  regionId: string;
  terrain: string;
  /** "(12,18)" */
  coordinates: string;
  province: string;
  /** "TAX · PRODUCE" */
  orders: string;
  tax: ProductionCell;
  resources: ProductionCell[];
  gap: boolean;
};

export type ProductionView = {
  title: string;
  counts: CountLine[];
  gapRows: ProductionRow[];
  fullRows: ProductionRow[];
  /** "Worked to the full · 30 hexes", or null when fullRows is empty. */
  divider: string | null;
  /** True when the overview lists no region at all. */
  empty: boolean;
};

const REGION_LIMIT_LABELS = ["regions", "tax regions", "trade regions"];

/** True when the report prints a Regions, Tax Regions or Trade Regions allowance (case-insensitive). */
export function statesRegionLimit(status: FactionStatus | null): boolean {
  return (status?.entries ?? []).some((entry) => REGION_LIMIT_LABELS.includes(entry.label.toLowerCase()));
}

/** The keys that activate a focused row. */
export function activatesRow(key: string): boolean {
  return key === "Enter";
}

const hexes = (count: number) => (count === 1 ? "hex" : "hexes");

/** What a count line's note says the hexes could do, and what the faction may not. */
type Doing = { could: string; mayNot: string };

function countLine(
  label: CountLine["label"],
  used: number,
  maximum: number,
  listed: number,
  doing: Doing
): CountLine {
  const state: CountLine["state"] = used > maximum ? "over" : maximum > 0 && used === maximum ? "full" : "room";
  const fraction = maximum > 0 ? Math.min(used / maximum, 1) : used > 0 ? 1 : 0;
  let note = "";
  if (maximum === 0) {
    note = `this faction may not ${doing.mayNot} anywhere`;
  } else if (used > maximum) {
    const over = used - maximum;
    note = `${over} ${hexes(over)} over — orders in ${over} ${hexes(over)} will be refused`;
  } else if (listed > 0 && used < maximum) {
    const room = maximum - used;
    note = `${room} more ${hexes(room)} could ${doing.could}`;
  }
  return { label, used, maximum, fraction, state, note };
}

function counts(overview: ProductionOverview): CountLine[] {
  const { limits, regions } = overview;
  if (limits.pooled !== null) {
    return [
      countLine("Regions", regions.length, limits.pooled, regions.length, {
        could: "tax or produce",
        mayNot: "tax or produce"
      })
    ];
  }
  const lines: CountLine[] = [];
  if (limits.tax !== null) {
    const used = regions.filter((region) => region.usesTaxSlot).length;
    lines.push(countLine("Tax regions", used, limits.tax, regions.length, { could: "tax", mayNot: "tax" }));
  }
  if (limits.trade !== null) {
    const used = regions.filter((region) => region.usesTradeSlot).length;
    lines.push(
      countLine("Trade regions", used, limits.trade, regions.length, { could: "produce", mayNot: "produce" })
    );
  }
  return lines;
}

function title(overview: ProductionOverview, lines: CountLine[]): string {
  if (overview.limits.pooled !== null && lines.length === 1) {
    return `Production · ${lines[0].used} of ${lines[0].maximum} regions`;
  }
  const parts = lines.map((line) => `${line.label === "Tax regions" ? "tax" : "trade"} ${line.used} of ${line.maximum}`);
  return ["Production", ...parts].join(" · ");
}

function orderWord(order: SlotOrder): string {
  switch (order.kind) {
    case "tax":
      return "TAX";
    case "tax-by-flag":
      return "TAX (every turn)";
    case "pillage":
      return "PILLAGE";
    case "produce":
      return order.crafted === null ? "PRODUCE" : `PRODUCE ${order.crafted}`;
  }
}

function taxCell(tax: WorkedTax): ProductionCell {
  const { base, taxed, collected, pillaged, atMost } = tax;
  if (pillaged !== null) {
    return { text: `pillaged · $${pillaged}`, tone: "ok" };
  }
  if (!taxed && (base === null || base === 0)) {
    return { text: "no tax here", tone: "estimate" };
  }
  if (!taxed) {
    return { text: `not taxed · $${base}`, tone: "gap" };
  }
  if (atMost && base !== null) {
    return { text: `$${collected} of $${base} at most`, tone: "estimate" };
  }
  if (atMost || base === null) {
    return { text: `$${collected} at most`, tone: "estimate" };
  }
  return { text: `$${collected} of $${base}`, tone: collected >= base ? "ok" : "gap" };
}

function resourceCell(resource: WorkedResource): ProductionCell {
  const { name, produced, available } = resource;
  if (available === null) {
    return { text: `${name} ${produced}/?`, tone: "estimate" };
  }
  return { text: `${name} ${produced}/${available}`, tone: produced >= available ? "ok" : "gap" };
}

function row(region: WorkedRegion, regionOf: (regionId: string) => ReportRegion | undefined): ProductionRow {
  const report = regionOf(region.regionId);
  const tax = taxCell(region.tax);
  const resources =
    region.resources.length > 0
      ? region.resources.map(resourceCell)
      : [{ text: "none offered", tone: "estimate" } satisfies ProductionCell];
  return {
    regionId: region.regionId,
    terrain: report?.terrain ?? region.regionId,
    coordinates: report ? `(${report.coordinate.x},${report.coordinate.y})` : "",
    province: report?.province ?? "",
    orders: region.orders.map(orderWord).join(" · "),
    tax,
    resources,
    gap: tax.tone === "gap" || resources.some((cell) => cell.tone === "gap")
  };
}

export function productionView(
  overview: ProductionOverview,
  regionOf: (regionId: string) => ReportRegion | undefined
): ProductionView {
  const lines = counts(overview);
  const rows = overview.regions.map((region) => row(region, regionOf));
  const gapRows = rows.filter((candidate) => candidate.gap);
  const fullRows = rows.filter((candidate) => !candidate.gap);
  return {
    title: title(overview, lines),
    counts: lines,
    gapRows,
    fullRows,
    divider: fullRows.length > 0 ? `Worked to the full · ${fullRows.length} ${hexes(fullRows.length)}` : null,
    empty: overview.regions.length === 0
  };
}
