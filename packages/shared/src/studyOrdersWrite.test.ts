import { describe, expect, it } from "vitest";
import type { OrdersCast, OrdersEntry } from "./studyOrders";
import { WRITE_COMMENT_COLUMN, studyWritePlan } from "./studyOrdersWrite";

const BANNER = ";*** plain (7,53) in Foo ***";

const anEntry = (over: Partial<OrdersEntry> = {}): OrdersEntry => ({
  key: "95/1234",
  unitId: "1234",
  name: "Ereb",
  regionId: "r1",
  order: "STUDY FORC 4",
  annotation: "force 3 -> 4",
  skipReason: null,
  cast: null,
  ...over
});

const aDocument = (...blockLines: string[]): string =>
  ["#atlantis 95", "", BANNER, "", "unit 1234", ...blockLines, "", "#end"].join("\n");

const plan = (document: string, entries: OrdersEntry[], banner: string | null = BANNER) =>
  studyWritePlan({
    document,
    entries,
    banner: () => banner,
    label: () => "plain (7,53)",
    syntax: "origins"
  });

describe("studyWritePlan", () => {
  it("a_mages_month_long_order_is_replaced_by_the_planned_study", () => {
    const result = plan(aDocument("@work"), [anEntry()]);
    expect(result.next.split("\n")).toEqual([
      "#atlantis 95",
      "",
      BANNER,
      "",
      "unit 1234",
      "STUDY FORC 4      ; force 3 -> 4",
      "",
      "#end"
    ]);
    expect(result.changed).toBe(1);
    expect(result.replaced).toBe(1);
    expect(result.rows[0].detail).toBe("STUDY FORC 4 replaces @work");
    expect(result.rows[0].who).toBe("Ereb (1234)");
    expect(result.rows[0].writes).toBe(true);
  });

  it("orders_that_are_not_month_long_are_left_exactly_where_they_are", () => {
    const result = plan(
      aDocument("  claim 200", "build Tower", "  give 1250 20 silv"),
      [anEntry({ annotation: null })]
    );
    expect(result.next.split("\n")).toEqual([
      "#atlantis 95",
      "",
      BANNER,
      "",
      "unit 1234",
      "  claim 200",
      "  give 1250 20 silv",
      "STUDY FORC 4",
      "",
      "#end"
    ]);
  });

  it("a_mage_with_no_block_gets_one_under_his_own_region_banner", () => {
    const document = ["#atlantis 95", "", "#end"].join("\n");
    const result = plan(document, [anEntry({ annotation: null })]);
    expect(result.next.split("\n")).toEqual([
      "#atlantis 95",
      "",
      BANNER,
      "",
      "unit 1234",
      "STUDY FORC 4",
      "",
      "#end"
    ]);
    expect(result.changed).toBe(1);
    expect(result.replaced).toBe(0);
    expect(result.rows[0].detail).toBe("STUDY FORC 4 — a new block, in plain (7,53)");
  });

  it("a_mage_with_no_block_and_no_banner_is_left_alone_and_named", () => {
    const document = ["#atlantis 95", "", "#end"].join("\n");
    const result = plan(document, [anEntry()], null);
    expect(result.next).toBe(document);
    expect(result.changed).toBe(0);
    expect(result.rows[0].writes).toBe(false);
    expect(result.rows[0].detail).toBe(
      "no block in your orders, and his hex is not in this turn's report — left alone"
    );
  });

  it("the_written_line_carries_the_tabs_annotation_in_a_column", () => {
    const result = plan(aDocument(), [anEntry({ order: "STUDY FORC" })]);
    const line = result.next.split("\n").find((one) => one.startsWith("STUDY"));
    expect(line).toBe(`${"STUDY FORC".padEnd(WRITE_COMMENT_COLUMN)}; force 3 -> 4`);
  });

  it("an_order_at_least_as_long_as_the_column_gets_one_space_before_its_comment", () => {
    const long = "TEACH 1234 1263 1288 1290";
    const result = plan(aDocument(), [anEntry({ order: long, annotation: "teaches four" })]);
    expect(result.next).toContain(`${long} ; teaches four`);
  });

  it("a_mage_with_nothing_planned_is_listed_as_left_alone", () => {
    const document = aDocument("@work");
    const result = plan(document, [
      anEntry({ order: null, annotation: null, skipReason: "nothing planned" })
    ]);
    expect(result.next).toBe(document);
    expect(result.changed).toBe(0);
    expect(result.rows[0]).toEqual({
      unitId: "1234",
      who: "Ereb (1234)",
      detail: "nothing planned — left alone",
      writes: false,
      cast: null
    });
  });

  it("a_replaced_study_or_teach_is_not_counted_as_another_order", () => {
    expect(plan(aDocument("study patt"), [anEntry()]).replaced).toBe(0);
    expect(plan(aDocument("@teach 1263"), [anEntry()]).replaced).toBe(0);
    expect(plan(aDocument("tax"), [anEntry()]).replaced).toBe(1);
  });

  it("the_lead_counts_the_units_that_change", () => {
    const document = ["#atlantis 95", "", BANNER, "", "unit 1234", "", "unit 881", "", "#end"].join(
      "\n"
    );
    const result = plan(document, [
      anEntry(),
      anEntry({ key: "95/881", unitId: "881", name: "Sable", order: "TEACH 1234", annotation: null })
    ]);
    expect(result.changed).toBe(2);
    expect(result.lead).toBe(
      "2 units change. Nothing else in the document is touched, and you can undo it afterwards."
    );
  });

  it("one_unit_reads_in_the_singular", () => {
    expect(plan(aDocument(), [anEntry()]).lead).toBe(
      "1 unit changes. Nothing else in the document is touched, and you can undo it afterwards."
    );
  });

  it("the_result_names_the_mages_and_the_replaced_orders", () => {
    expect(plan(aDocument("@work"), [anEntry()]).resultText).toBe(
      "Wrote study orders for 1 mage; 1 other order replaced."
    );
    expect(plan(aDocument(), [anEntry()]).resultText).toBe("Wrote study orders for 1 mage.");
  });

  it("nothing_writable_gives_a_plan_that_changes_the_document_not_at_all", () => {
    const document = aDocument("@work");
    const result = plan(document, [anEntry({ order: null, skipReason: "nothing planned" })]);
    expect(result.next).toBe(document);
    expect(result.lead).toBe("None of these mages can be written into your orders.");
  });

  it("a_very_long_previous_order_is_cut_with_an_ellipsis_in_the_row", () => {
    const previous = `build Tower ; ${"a".repeat(80)}`;
    const result = plan(aDocument(previous), [anEntry()]);
    expect(result.rows[0].detail).toBe(`STUDY FORC 4 replaces ${previous.slice(0, 47)}…`);
  });
});

describe("studyWritePlan and nesting", () => {
  it("a_block_that_was_only_a_long_order_gains_no_leading_blank_line", () => {
    const document = ["#atlantis 95", "", BANNER, "", "unit 1234", "", "@work", "", "#end"].join(
      "\n"
    );
    const result = plan(document, [anEntry({ annotation: null })]);
    expect(result.next.split("\n")).toEqual([
      "#atlantis 95",
      "",
      BANNER,
      "",
      "unit 1234",
      "STUDY FORC 4",
      "",
      "#end"
    ]);
  });

  it("a_form_block_inside_the_mages_orders_is_left_alone", () => {
    const result = plan(
      aDocument("FORM 1", "  BUY 5 Plainsmen", "  STUDY COMBAT", "END", "@work"),
      [anEntry({ annotation: null })]
    );
    expect(result.next.split("\n")).toEqual([
      "#atlantis 95",
      "",
      BANNER,
      "",
      "unit 1234",
      "FORM 1",
      "  BUY 5 Plainsmen",
      "  STUDY COMBAT",
      "END",
      "STUDY FORC 4",
      "",
      "#end"
    ]);
    expect(result.rows[0].detail).toBe("STUDY FORC 4 replaces @work");
    expect(result.replaced).toBe(1);
  });
});

/**
 * ah-9qdz.4: a planned cast written beside the study. A CAST is not a month-long order
 * (`rules/magic_usingmagic`), so it replaces only a CAST line, and a COMBAT only a COMBAT line
 * (`rules/cast`, `rules/combat`).
 */
describe("studyWritePlan — casts", () => {
  const farsight: OrdersCast = {
    kind: "write",
    verb: "CAST",
    spell: "FARS",
    name: "farsight",
    order: "CAST FARS",
    annotation: "practises farsight"
  };
  const fire: OrdersCast = {
    kind: "write",
    verb: "COMBAT",
    spell: "FIRE",
    name: "fire",
    order: "COMBAT FIRE",
    annotation: "readies fire for battle"
  };
  const unknown: OrdersCast = {
    kind: "unknown",
    spell: "FARS",
    name: "farsight",
    order: "CAST FARS",
    text: "CAST FARS — he won't know farsight yet, left out"
  };
  const blockOf = (next: string) => {
    const lines = next.split("\n");
    return lines.slice(lines.indexOf("unit 1234") + 1, lines.indexOf("#end") - 1);
  };

  it("writes_the_cast_line_after_the_study_line", () => {
    const result = plan(aDocument("@work"), [anEntry({ annotation: null, cast: farsight })]);
    expect(blockOf(result.next)).toEqual(["STUDY FORC 4", `${"CAST FARS".padEnd(WRITE_COMMENT_COLUMN)}; practises farsight`]);
    expect(result.rows[0].cast).toEqual({ detail: "CAST FARS", writes: true });
    expect(result.casts).toBe(1);
  });

  it("writes_a_combat_line_for_a_combat_spell", () => {
    const result = plan(aDocument(), [anEntry({ annotation: null, cast: fire })]);
    expect(blockOf(result.next).at(-1)).toBe(`${"COMBAT FIRE".padEnd(WRITE_COMMENT_COLUMN)}; readies fire for battle`);
  });

  it("replaces_a_cast_of_another_spell_and_names_it", () => {
    const result = plan(aDocument('CAST "Clear Skies"', "COMBAT FIRE"), [
      anEntry({ annotation: null, cast: { ...farsight, annotation: "x" } })
    ]);
    const block = blockOf(result.next);
    expect(block.some((line) => line.startsWith('CAST "Clear Skies"'))).toBe(false);
    expect(block).toContain("COMBAT FIRE");
    expect(result.rows[0].cast).toEqual({ detail: 'CAST FARS replaces CAST "Clear Skies"', writes: true });
  });

  it("a_combat_replaces_only_a_combat_line", () => {
    const result = plan(aDocument('COMBAT "Clear Skies"', "CAST FARS"), [anEntry({ annotation: null, cast: fire })]);
    const block = blockOf(result.next);
    expect(block).toContain("CAST FARS");
    expect(block.filter((line) => /^COMBAT/i.test(line))).toEqual([
      `${"COMBAT FIRE".padEnd(WRITE_COMMENT_COLUMN)}; readies fire for battle`
    ]);
    expect(result.rows[0].cast?.detail).toBe('COMBAT FIRE replaces COMBAT "Clear Skies"');
  });

  it("keeps_a_cast_of_the_same_spell_untouched", () => {
    for (const existing of ["CAST Farsight REGION 12 40 1", "cast FARS", '@CAST "farsight" ; mine']) {
      const result = plan(aDocument(existing), [anEntry({ annotation: null, cast: farsight })]);
      expect(blockOf(result.next)).toEqual([existing, "STUDY FORC 4"]);
      expect(result.rows[0].cast).toEqual({ detail: "CAST FARS — already there, kept", writes: false });
      expect(result.casts).toBe(1);
    }
  });

  it("a_same_spell_cast_after_another_cast_is_still_kept", () => {
    const existing = ['CAST "Clear Skies"', "CAST Farsight REGION 12 40 1"];
    const result = plan(aDocument(...existing), [anEntry({ annotation: null, cast: farsight })]);
    expect(blockOf(result.next)).toEqual([...existing, "STUDY FORC 4"]);
    expect(result.rows[0].cast).toEqual({ detail: "CAST FARS — already there, kept", writes: false });
  });

  it("a_cast_spelled_with_underscores_is_the_same_spell", () => {
    const result = plan(aDocument("CAST Clear_Skies"), [
      anEntry({
        annotation: null,
        cast: { ...farsight, spell: "CLEA", name: "clear skies", order: "CAST CLEA" }
      })
    ]);
    expect(result.rows[0].cast?.detail).toBe("CAST CLEA — already there, kept");
  });

  it("a_cast_inside_a_form_block_is_not_his", () => {
    const result = plan(aDocument("FORM 1", "  CAST FARS", "END"), [anEntry({ annotation: null, cast: farsight })]);
    expect(blockOf(result.next)).toEqual(["FORM 1", "  CAST FARS", "END", "STUDY FORC 4", `${"CAST FARS".padEnd(WRITE_COMMENT_COLUMN)}; practises farsight`]);
  });

  it("a_mage_with_no_study_still_gets_his_cast_and_changes", () => {
    const result = plan(aDocument("@work"), [
      anEntry({ order: null, annotation: null, skipReason: "nothing planned", cast: fire })
    ]);
    expect(blockOf(result.next)).toEqual(["@work", `${"COMBAT FIRE".padEnd(WRITE_COMMENT_COLUMN)}; readies fire for battle`]);
    expect(result.rows[0].detail).toBe("nothing planned — left alone");
    expect(result.rows[0].writes).toBe(false);
    expect(result.rows[0].cast).toEqual({ detail: "COMBAT FIRE", writes: true });
    expect(result.changed).toBe(1);
  });

  it("a_cast_only_mage_with_no_block_gets_one", () => {
    const document = ["#atlantis 95", "", "#end"].join("\n");
    const result = plan(document, [anEntry({ order: null, annotation: null, skipReason: "nothing planned", cast: fire })]);
    expect(result.next).toContain("unit 1234");
    expect(result.changed).toBe(1);
  });

  it("a_spell_he_will_not_know_is_a_dim_row_and_writes_nothing", () => {
    const document = aDocument();
    const result = plan(document, [anEntry({ order: null, annotation: null, skipReason: "nothing planned", cast: unknown })]);
    expect(result.next).toBe(document);
    expect(result.rows[0].cast).toEqual({ detail: "CAST FARS — he won't know farsight yet, left out", writes: false });
    expect(result.casts).toBe(0);
    expect(result.warning).toBeNull();
  });

  it("warns_about_targets_only_when_a_cast_is_written", () => {
    expect(plan(aDocument(), [anEntry({ cast: farsight })]).warning).toBe(
      "Casts are written without a target. Add one by hand where the spell needs it."
    );
    expect(plan(aDocument("CAST FARS"), [anEntry({ cast: farsight })]).warning).toBeNull();
    expect(plan(aDocument(), [anEntry()]).warning).toBeNull();
  });

  it("the_result_names_the_casts", () => {
    const document = ["#atlantis 95", "", BANNER, "", "unit 1234", "@work", "", "unit 881", "", "#end"].join("\n");
    expect(
      plan(document, [
        anEntry({ cast: farsight }),
        anEntry({ key: "95/881", unitId: "881", name: "Sable", order: null, skipReason: "nothing planned", cast: fire })
      ]).resultText
    ).toBe("Wrote study orders and 2 casts for 2 mages; 1 other order replaced.");
    expect(plan(aDocument(), [anEntry({ cast: farsight })]).resultText).toBe(
      "Wrote study orders and 1 cast for 1 mage."
    );
  });

  it("no_casts_leaves_the_plan_as_it_was", () => {
    const result = plan(aDocument("@work"), [anEntry()]);
    expect(result.casts).toBe(0);
    expect(result.warning).toBeNull();
    expect(result.rows[0].cast).toBeNull();
  });
});
