import type { PendingOrdersImport } from "../ordersImport";
import type { PendingMapExport, PendingReportLoad } from "../reportLoad";
import type { PendingMissingMages } from "../mageSheetImport";

export type FileQuestion =
  | { kind: "foreign-report"; pending: PendingReportLoad }
  | { kind: "map-export"; pending: PendingMapExport }
  | { kind: "orders-import"; pending: PendingOrdersImport }
  | { kind: "missing-mages"; pending: PendingMissingMages };

export type FileQuestionState = FileQuestion | null;

export type FileQuestionEvent =
  | { type: "opened"; question: FileQuestion }
  | { type: "closed" };

export function reduce(state: FileQuestionState, event: FileQuestionEvent): FileQuestionState {
  switch (event.type) {
    case "opened":
      return event.question;
    case "closed":
      return null;
    default:
      return state;
  }
}
