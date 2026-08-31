import type { PendingOrdersImport } from "../ordersImport";
import type { PendingMapExport, PendingReportLoad } from "../reportLoad";

export type FileQuestion =
  | { kind: "foreign-report"; pending: PendingReportLoad }
  | { kind: "map-export"; pending: PendingMapExport }
  | { kind: "orders-import"; pending: PendingOrdersImport };

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
