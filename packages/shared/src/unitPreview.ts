import type {
  BuildSpend,
  CreatedItem,
  FieldChange,
  ItemAmount,
  ItemChange,
  OrdersPreviewResponse,
  ProducedItem,
  RegionPreview,
  ReportUnit,
  SkillInfo,
  SkillMerge,
  StudyForecast,
  TakenUnshown,
  TransportReceived,
  TransportSent,
  TransportTargetIssue,
  UnitPreview,
  UnitPreviewStatus,
  UnitSilver
} from "@atlantis/core-client";
import {
  buyAllSentences,
  castCapSentence,
  productionStatusSentence,
  productionMenSentence
} from "./unitTooltip";
import { unitRowKey } from "./unitTable";

/**
 * How the orders preview folds into the units table.
 *
 * Pure for the same reason unitTable.ts is: none of it needs a DOM, and the repository has no
 * jsdom, so keeping it out of the component is what makes it testable at all.
 */

/**
 * A table row: a unit, possibly as the orders leave it rather than as the report found it.
 *
 * An extension of `ReportUnit` rather than a wrapper, so everything that already handles units -
 * sorting, filtering, the row cap, the tooltip - keeps working without knowing the preview
 * exists. The extra fields are absent on a row the orders left alone.
 */
export type PreviewedUnit = ReportUnit & {
  previewStatus?: UnitPreviewStatus;
  /**
   * The hex whose numbering `structureId` is written in, when it is not this row's own.
   *
   * Set only by `mergePreviewAcross`' fold, which puts a mover's destination structure on the row
   * standing in its origin hex (`ah-ehgy`). Absent everywhere else, including every row
   * `mergePreview` returns, because there `structureId` and `regionId` name the same hex.
   */
  structureRegionId?: string;
  previewChanges?: FieldChange[];
  /** Where an arriving unit set out from. */
  arrivingFrom?: string | null;
  /** Where a departing unit ends the month, when the trace could say. */
  departingTo?: string | null;
  /** The fleet carrying this unit away, as `<name> [<id>]`, when the ship it stands in departs. */
  aboard?: string | null;
  /**
   * This unit's orders whose effect on its items could not be counted, verbatim, in document
   * order (`ah-agbm`).
   */
  uncounted?: string[];
  /** Silver or goods taken from a unit the report does not show in this hex (`ah-agbm`). */
  takenUnshown?: TakenUnshown[];
  /** What this unit's PRODUCE orders make this month (`ah-ofpb.1`). */
  produced?: ProducedItem[];
  /** What this unit's BUILD orders spend this month (`ah-ofpb.2`). */
  built?: BuildSpend[];
  /** What this unit's CAST orders create this month (`ah-ofpb.5`). */
  created?: CreatedItem[];
  /** What this unit's TRANSPORT/DISTRIBUTE orders send this month, in document order (`ah-bxgs`). */
  transportSent?: TransportSent[];
  /** What arrives at this unit by another unit's TRANSPORT/DISTRIBUTE this month (`ah-bxgs`). */
  transportReceived?: TransportReceived[];
  /**
   * This unit's TRANSPORT/DISTRIBUTE orders whose target the report cannot show as able to
   * receive. Those orders move nothing (`ah-64wm`).
   */
  transportTargetIssues?: TransportTargetIssue[];
  /**
   * Every item this month's orders move into or out of this unit, each with its cause, in the
   * month's order (`ah-rgkk.3.1`).
   */
  itemChanges?: ItemChange[];
  /**
   * The unit a dissolving row's goods revert to, as `<name> (<id>)` (`rules/form`, `ah-ty3s.3`).
   * `null` where the hex shows no own unit of ours for them to revert to.
   */
  dissolvesInto?: string | null;
  /**
   * This month's FORM creates this unit: it did not exist when the report was written, and its
   * `unitId` is the synthetic `new-<alias>`. Carried on every row of such a unit, including its
   * arriving row (`ah-4hux`).
   */
  formed?: boolean;
  /**
   * `rules/form` dissolves this unit before the month ends - a formed unit that gains nobody.
   * Always accompanied by `formed`, and drawn rather than skipped (`ah-ty3s.3`, decision K2).
   */
  dissolving?: boolean;
  /**
   * Why this unit's skills moved this month, one record per merge of arriving men, in the order
   * the merges ran (`ah-rgkk.2.1`).
   *
   * Optional only because this whole type is partial - a row the orders left alone carries none of
   * the preview's extras. The core populates all four of the skill fields on every `UnitPreview`
   * it emits and never sends `undefined`, so a reader may treat `undefined` and the empty value
   * alike: both mean the row came from the report rather than from the preview.
   */
  skillMerges?: SkillMerge[];
  /** This unit's skills exactly as the report printed them, typed (`ah-rgkk.2.1`). */
  reportedSkills?: SkillInfo[];
  /**
   * The report could only estimate this unit's headcount, so its recruits were never merged into
   * its skills (`ah-rgkk.2.1`).
   */
  recruitsUnmerged?: boolean;
  /**
   * Men credited from a unit the report does not show, whose own skills are unknown and who are
   * therefore left out of every merge (`ah-agbm`, `ah-rgkk.2.1`).
   */
  menOfUnknownSkill?: TakenUnshown[];
  /** Where this month's STUDY lands next turn, teaching included (`ah-rgkk.2.2`). */
  study?: StudyForecast | null;
};

/**
 * Whether this row's unit is dissolved before the month ends, so it holds nothing next month
 * (`rules/form`, decision **K2** of `ah-ty3s`).
 */
export function dissolves(unit: PreviewedUnit): boolean {
  return unit.dissolving === true;
}

/**
 * The hex's units with the orders preview folded in.
 *
 * A previewed unit replaces its report row in place, so the table keeps its arrangement; units
 * the report has no row for - arriving from another hex, or formed this month - are appended.
 * Untouched units come through as the very same objects, so memoization over them survives.
 */
export function mergePreview(
  units: ReportUnit[],
  preview: RegionPreview | null | undefined
): PreviewedUnit[] {
  return foldIn(units, preview?.units ?? []);
}

/**
 * A list spanning hexes - every own unit in the report - with the whole report's preview folded
 * in, one row per unit (`ah-tguk`).
 *
 * **Every `arriving` row is dropped, and that is what leaves exactly one row per unit.** The core
 * emits a moving unit twice: an `arriving` row in the destination region and a `departing` row in
 * the origin, pushed as a pair inside one block (`crates/core/src/orders/effects.rs`), so a list
 * that spans every hex would otherwise show the same unit twice - and a roster of your own units
 * is not a place for that. Dropping the arrival keeps the unit on the hex the report gave it, with
 * the `-> destination` marker its departing row already carries; a departure the trace could not
 * name a destination for has no arrival row at all, and is kept. A formed unit's pair is dropped
 * the same way: its arriving row goes and the row in the hex it was formed in stays, carrying the
 * `new` marker and the destination arrow together (`ah-4hux`).
 */
export function mergePreviewAcross(
  units: ReportUnit[],
  preview: OrdersPreviewResponse | null | undefined
): PreviewedUnit[] {
  const all = (preview?.regions ?? []).flatMap((region) => region.units);
  const arrivals = all.filter((one) => one.status === "arriving");
  return foldIn(
    units,
    all
      .filter((one) => one.status !== "arriving")
      .map((one) => standingWhereItArrives(one, arrivals))
  );
}

/** A previewed row plus the one thing the fold knows and the wire type cannot carry. */
type FoldedPreview = UnitPreview & { structureRegionId?: string };

/**
 * The kept row of a moving unit, standing where the month leaves it rather than where it set out.
 *
 * `mergePreviewAcross` keeps one row per unit and it is the *departing* one, so without this the
 * Structure column of a walker that left a fort behind goes on naming the fort - beside the very
 * `-> destination` arrow that says the unit will not be there (`ah-ehgy`). The arriving row is
 * where the core settles a mover's structure: it clears it for a walker, keeps it for a unit whose
 * fleet sails (`crates/core/src/orders/effects.rs`, `sails_along`), and records the `structureId`
 * change with the movement order as its cause. So the structure - the field and its change alike -
 * is taken from the arrival and everything else from the departure, which owns the hex, the arrow
 * and every other column.
 *
 * The pair is matched on both hexes as well as the unit id, never on the id alone: a formed unit's
 * alias (`new-1`) is reused hex by hex, so two of them can share an id in one response.
 */
function standingWhereItArrives(
  departing: UnitPreview,
  arrivals: readonly UnitPreview[]
): FoldedPreview {
  if (departing.departingTo === null || departing.departingTo === undefined) {
    return departing;
  }
  const arrival = arrivals.find(
    (one) =>
      one.unit.unitId === departing.unit.unitId &&
      one.unit.regionId === departing.departingTo &&
      one.arrivingFrom === departing.unit.regionId
  );
  if (!arrival) {
    return departing;
  }
  const changes = [
    ...departing.changes.filter((change) => change.field !== "structureId"),
    ...arrival.changes.filter((change) => change.field === "structureId")
  ];
  // Nothing to fold: the same object back, because `UnitTableDock`'s memoisation is keyed on row
  // identity and a fresh object every preview tick cancels an open tooltip (`ah-1wcw.1`). The
  // structure ids are compared only alongside the changes, and never as the whole test: a
  // structure number is scoped to its region (`rules/move`, "a structure number"), so `7` in the
  // origin and `7` in the destination are two different buildings that happen to share a number.
  if (
    arrival.unit.structureId === departing.unit.structureId &&
    sameChanges(changes, departing.changes)
  ) {
    return departing;
  }
  return {
    ...departing,
    unit: { ...departing.unit, structureId: arrival.unit.structureId },
    changes,
    structureRegionId: departing.departingTo
  };
}

/** Whether two change lists say the same things in the same order. */
function sameChanges(one: readonly FieldChange[], other: readonly FieldChange[]): boolean {
  return (
    one.length === other.length &&
    one.every(
      (change, index) =>
        change.field === other[index].field &&
        change.original === other[index].original &&
        change.cause === other[index].cause
    )
  );
}

/**
 * The fold itself, over previewed units already chosen by the caller.
 *
 * Two identity guarantees, both load-bearing rather than tidy: **the very same array back when
 * there is nothing to fold**, and **untouched units as the very same objects**. `visible` in
 * `UnitTableDock` is memoised over the row list and the hover that opens a unit's tooltip is
 * cancelled whenever that array's identity changes; the preview is refreshed on a 300ms debounce
 * as orders are typed, so a fresh array every call would cancel the hover 300ms after it began and
 * the tooltip would never appear (`ah-1wcw.1`, fixed in `ah-1wcw.6`).
 */
function foldIn(units: ReportUnit[], previewed: readonly FoldedPreview[]): PreviewedUnit[] {
  if (previewed.length === 0) {
    return units;
  }

  const changed = new Map(
    previewed.map((unit) => [unitRowKey(unit.unit.regionId, unit.unit.unitId), unit])
  );
  const rows: PreviewedUnit[] = units.map((unit) => {
    const key = unitRowKey(unit.regionId, unit.unitId);
    const found = changed.get(key);
    if (!found) {
      return unit;
    }
    changed.delete(key);
    return rowFor(found);
  });

  // Whatever is left has no report row here: arrivals and formed units, in preview order.
  for (const found of changed.values()) {
    rows.push(rowFor(found));
  }

  return rows;
}

/** One previewed unit as a table row: the predicted unit, with the preview's extras beside it. */
function rowFor(previewed: FoldedPreview): PreviewedUnit {
  return {
    ...previewed.unit,
    structureRegionId: previewed.structureRegionId,
    previewStatus: previewed.status,
    previewChanges: previewed.changes,
    arrivingFrom: previewed.arrivingFrom,
    departingTo: previewed.departingTo,
    aboard: previewed.aboard,
    formed: previewed.formed,
    dissolving: previewed.dissolving,
    uncounted: previewed.uncounted,
    takenUnshown: previewed.takenUnshown,
    produced: previewed.produced,
    built: previewed.built,
    created: previewed.created,
    transportSent: previewed.transportSent,
    transportReceived: previewed.transportReceived,
    transportTargetIssues: previewed.transportTargetIssues,
    itemChanges: previewed.itemChanges,
    dissolvesInto: previewed.dissolvesInto,
    skillMerges: previewed.skillMerges,
    reportedSkills: previewed.reportedSkills,
    recruitsUnmerged: previewed.recruitsUnmerged,
    menOfUnknownSkill: previewed.menOfUnknownSkill,
    study: previewed.study
  };
}

/** The recorded change for one field of a row, when the orders changed it. */
export function changeFor(
  unit: PreviewedUnit | undefined,
  field: string
): FieldChange | undefined {
  return unit?.previewChanges?.find((change) => change.field === field);
}

/**
 * The ITEMS cell's text: the same formatting the report uses, in one place so the cell and its
 * hover cannot drift apart (`ah-agbm`).
 *
 * `created` is what a CAST brings that the game leaves partly to chance: the amounts in `items`
 * are already the most the unit may end with, so each entry's low end is that figure less the
 * part that rests on a chance (`ah-ofpb.5`).
 */
export function formatItems(
  items: readonly ItemAmount[],
  created: readonly CreatedItem[] = []
): string {
  const shortfall = new Map<string, number>();
  for (const item of created) {
    shortfall.set(item.tag, (shortfall.get(item.tag) ?? 0) + (item.most - item.fewest));
  }
  return items
    .map((item) => {
      const gap = shortfall.get(item.tag) ?? 0;
      return gap > 0 ? `${item.amount - gap}-${item.amount} ${item.tag}` : `${item.amount} ${item.tag}`;
    })
    .join(", ");
}

/**
 * The ITEMS cell's hover: what the report said, what came from an unverifiable source, what this
 * month's production adds, what a `BUY ALL` settled to and what stopped it settling higher, what
 * stopped production short, and what could not be counted - in that order, known before unknown
 * (`ah-agbm`, `ah-ofpb.1`, `ah-jown`).
 *
 * `silver` is the row's own forecast, which is where the cap sentence and the `BUY ALL` sentences
 * live: the ITEMS and SILVER hovers say them in the same words because they call the same
 * functions. `undefined` when there is nothing to say, exactly today's behaviour for a cell the
 * orders left alone (`ah-agbm`).
 */
export function itemsTooltip(
  unit: PreviewedUnit | undefined,
  silver?: UnitSilver | null
): string | undefined {
  if (!unit) {
    return undefined;
  }

  const change = changeFor(unit, "items");
  const takenUnshown = unit.takenUnshown ?? [];
  const produced = unit.produced ?? [];
  const built = unit.built ?? [];
  const created = unit.created ?? [];
  const uncounted = unit.uncounted ?? [];
  const transportSent = unit.transportSent ?? [];
  const transportReceived = unit.transportReceived ?? [];
  const transportTargetIssues = unit.transportTargetIssues ?? [];
  const buyAll = buyAllSentences(silver);
  const capSentence = productionStatusSentence(silver);
  const menSentence = productionMenSentence(silver);
  const castCap = castCapSentence(silver);
  if (
    !change &&
    takenUnshown.length === 0 &&
    produced.length === 0 &&
    built.length === 0 &&
    created.length === 0 &&
    uncounted.length === 0 &&
    transportSent.length === 0 &&
    transportReceived.length === 0 &&
    transportTargetIssues.length === 0 &&
    buyAll.length === 0 &&
    capSentence === undefined &&
    menSentence === undefined &&
    castCap === undefined
  ) {
    return undefined;
  }

  // No `was:` lead and no per-item restatement: the Items popup draws every item as the pair the
  // report and the orders put it between, and names each movement in its own clause
  // (`ah-rgkk.3.3`, decisions **R1** and **T2**). What is left here is only what no clause can
  // say - the resolution rules, the caps, and what could not be counted at all.
  const lines: string[] = [];
  for (const taken of takenUnshown) {
    lines.push(
      `Includes ${taken.amount} ${taken.tag} taken from unit ${taken.from}, which your report does not show here.`
    );
  }
  // "this unit cannot", not "cannot be": since `ah-728m.2.2` a manufacturing output *can* be spent
  // this month - by a later manufacturer in the same hex, or by a BUILD, both of which
  // `rules/sequenceofevents` runs after "Manufacturing PRODUCE orders ... are processed". What
  // stays true is what this unit can do with it: GIVE and the market settle long before either
  // PRODUCE phase, and its own month is already spent on producing. Said once and naming no item,
  // because the clause block above has already named every amount.
  if (produced.length > 0) {
    lines.push(
      "Production resolves late, so this unit cannot give away or sell what it produces this month."
    );
  }
  for (const sentence of buyAll) {
    lines.push(sentence);
  }
  if (created.length > 0) {
    lines.push(
      "Casting resolves after GIVE, so this unit cannot give away what it casts this month."
    );
  }
  if (transportReceived.length > 0) {
    lines.push(
      "Transport resolves last, so this unit cannot spend what arrives by transport this month."
    );
  }
  // Before the cap sentence, because that one quotes "the N its skill and tools could make" and this one is
  // what explains why N is what it is (`ah-qct4`) - the same order the SILVER hover reads in.
  if (menSentence !== undefined) {
    lines.push(menSentence);
  }
  if (capSentence !== undefined) {
    lines.push(capSentence);
  }
  // What this unit's own clause will account for, per tag: `charge_shared_material` debits the
  // actor only for what it holds (`crates/core/src/orders/semantics.rs`), so a builder funded
  // wholly or partly by a hex neighbour is debited less than the structure takes - or not at all.
  const ownDebit = new Map<string, number>();
  for (const change of unit.itemChanges ?? []) {
    // `other === null` is the actor's own row: `charge_shared_material` writes a `build-spent`
    // change to every supplier too, naming the builder in `other`, and material this unit gave to
    // a neighbour's structure must not hide what its own is taking.
    if (change.cause === "build-spent" && change.other === null) {
      ownDebit.set(change.tag, (ownDebit.get(change.tag) ?? 0) + Math.abs(change.delta));
    }
  }
  for (const spend of built) {
    // Kept for exactly what the clause cannot name: the whole figure, wherever the unit's own
    // debit falls short of it. No `cappedBy` fires when the material was there, so without this
    // the amount the structure actually takes would appear nowhere at all.
    if ((ownDebit.get(spend.tag) ?? 0) < spend.amount) {
      lines.push(`Spends ${spend.amount} ${spend.tag} ${buildSpendTarget(spend)} this month.`);
    }
    if (spend.cappedBy === "materials") {
      lines.push(
        `This unit has ${spend.name} for ${spend.amount} units of work, not the ${spend.couldDo} its men could do.`
      );
    } else if (spend.cappedBy === "needs") {
      const needs = spend.founding
        ? `A new ${spend.place} needs ${spend.amount} units of work`
        : `${spend.place} needs ${spend.amount} more units of work`;
      lines.push(`${needs}, not the ${spend.couldDo} its men could do.`);
    }
  }
  if (castCap !== undefined) {
    lines.push(castCap);
  }
  // Only what no clause can name: a refused TRANSPORT, and one that moved nothing at all - the
  // core writes the `TransportSent` row unconditionally but records the `TransportedOut` change
  // only `if moved != 0` (`crates/core/src/orders/effects.rs`). Every line that did move is what
  // the `transported-out` clause now says, `toUnshown` included.
  for (const sentence of transportSentences(
    transportSent.filter((sent) => sent.refused || sent.amount === 0),
    transportTargetIssues
  )) {
    lines.push(sentence);
  }
  for (const order of uncounted) {
    lines.push(`and more that cannot be counted: ${order}`);
  }
  // A unit whose only change is an items change now leaves no line at all, and an empty note is
  // worse than none.
  return lines.length === 0 ? undefined : lines.join("\n");
}

/**
 * What one BUILD spend was spent on, as a sentence fragment: `on Fort`, `on a new Tower`, or
 * `helping unit 1502 build Fort`.
 *
 * `new-{alias}` is the canonical id Rust files a unit formed this month under; the player wrote it
 * as `NEW {alias}` and reads it back in their own spelling (`ah-zxvd`).
 */
export function buildSpendTarget(spend: BuildSpend): string {
  const place = spend.founding ? `a new ${spend.place}` : spend.place;
  if (spend.helping === null) {
    return `on ${place}`;
  }
  const helped = spend.helping.startsWith("new-")
    ? `NEW ${spend.helping.slice("new-".length)}`
    : `unit ${spend.helping}`;
  return `helping ${helped} build ${place}`;
}

/** One transported line as the hover states it. */
function transportSentSentence(sent: TransportSent): string {
  if (sent.refused) {
    return `The game will not transport ${sent.tag}, so they stay with this unit.`;
  }
  if (sent.toUnshown) {
    return `Sends ${sent.amount} ${sent.tag} to unit ${sent.to}, which your report does not show.`;
  }
  return `Sends ${sent.amount} ${sent.tag} to unit ${sent.to}.`;
}

/**
 * This month's TRANSPORT/DISTRIBUTE block as sentences, in the order the orders were written
 * (`ah-64wm`).
 *
 * The core splits one document across two lists - what left, and what a target would not take -
 * so reading them one after the other would put a refused order written first *after* a
 * successful one written second. `orderIndex` is what each line carries to be put back in its
 * place; a stable sort by it keeps every line one order wrote together and in the order the core
 * pushed them.
 */
export function transportSentences(
  sent: readonly TransportSent[],
  issues: readonly TransportTargetIssue[]
): string[] {
  const lines = [
    ...sent.map((one) => ({ orderIndex: one.orderIndex, sentence: transportSentSentence(one) })),
    ...issues.map((one) => ({
      orderIndex: one.orderIndex,
      sentence: transportTargetSentence(one)
    }))
  ];
  return lines
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((line) => line.sentence);
}

/**
 * Whether a target issue is a gap in the report rather than a refusal it can prove (`ah-64wm`).
 *
 * A definite refusal is a fact the hover states and the cell need say nothing more about; a gap is
 * what the ` + ?` mark is for - the month could not be fully counted.
 */
export function transportTargetUncertain(issue: TransportTargetIssue): boolean {
  return issue.reason === "eligibilityUnknown" || issue.reason === "acceptanceUnknown";
}

/** Whether any of this row's transports was aimed at a target the report cannot settle. */
export function hasUncertainTransportTarget(unit: PreviewedUnit | undefined): boolean {
  return (unit?.transportTargetIssues ?? []).some(transportTargetUncertain);
}

/**
 * One target issue as the hover states it (`ah-64wm`).
 *
 * An issue naming a tag makes a claim about those goods - they stay here, or they could not be
 * counted. One naming none speaks of the order alone: the goods are ones the game would not have
 * carried anyway, so "they stay with this unit" would imply a move that was never on offer.
 */
export function transportTargetSentence(issue: TransportTargetIssue): string {
  const goods = issue.tag === "" ? null : `${issue.amount} ${issue.tag}`;
  switch (issue.reason) {
    case "notQuartermaster":
      return goods === null
        ? `Unit ${issue.to} is not a quartermaster, so this TRANSPORT moves nothing.`
        : `Unit ${issue.to} is not a quartermaster, so ${goods} stay with this unit.`;
    case "notCaravanseraiOwner":
      return goods === null
        ? `Unit ${issue.to} does not own a Caravanserai, so this TRANSPORT moves nothing.`
        : `Unit ${issue.to} does not own a Caravanserai, so ${goods} stay with this unit.`;
    case "eligibilityUnknown":
      return `Could not count ${goods ?? "this TRANSPORT"} for unit ${issue.to} because your report does not show whether it is an eligible transport target.`;
    case "acceptanceUnknown":
      return `Could not count ${goods ?? "this TRANSPORT"} for unit ${issue.to} because your report does not show whether its faction accepts transports from yours.`;
  }
}

/**
 * The hover text for a changed cell. An original the report never had - no structure, no flags -
 * reads as absence rather than as a blank the eye would miss.
 */
export function originalTooltip(change: FieldChange | undefined): string | undefined {
  if (!change) {
    return undefined;
  }
  return `was: ${change.original === "" ? "—" : change.original}`;
}
