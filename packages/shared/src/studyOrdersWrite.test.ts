import { describe, expect, it } from "vitest";
import type { OrdersEntry } from "./studyOrders";
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
  ...over
});

const aDocument = (...blockLines: string[]): string =>
  ["#atlantis 95", "", BANNER, "", "unit 1234", ...blockLines, "", "#end"].join("\n");

const plan = (document: string, entries: OrdersEntry[], banner: string | null = BANNER) =>
  studyWritePlan({
    document,
    entries,
    banner: () => banner,
    label: () => "plain (7,53)"
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
      writes: false
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
