import { describe, expect, it } from "vitest";
import type { PendingOrdersImport } from "../ordersImport";
import type { PendingMapExport, PendingReportLoad } from "../reportLoad";
import type { FileQuestion } from "./fileQuestionState";
import { reduce } from "./fileQuestionState";

const questions: FileQuestion[] = [
  { kind: "foreign-report", pending: {} as PendingReportLoad },
  { kind: "map-export", pending: {} as PendingMapExport },
  { kind: "orders-import", pending: {} as PendingOrdersImport }
];

describe("file question state", () => {
  it("opening a file question replaces the current question", () => {
    let state = null;
    for (const question of questions) {
      state = reduce(state, { type: "opened", question });
      expect(state).toEqual(question);
    }
  });

  it("closing a file question leaves none pending", () => {
    const state = reduce(null, { type: "opened", question: questions[0] });
    expect(reduce(state, { type: "closed" })).toBeNull();
  });
});
