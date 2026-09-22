import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import type { OrderProcessing } from "./orderProcessing";
import { orderProcessingFor } from "./orderProcessing";
import { OrdersEditor } from "./workspace/OrdersEditor";
import { OrdersImportSummaryDialog } from "./workspace/OrdersImportSummaryDialog";
import { OrdersPanel } from "./workspace/OrdersPanel";
import { StudyPlannerDialog } from "./workspace/StudyPlannerDialog";

type Requires<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;

const OrdersEditorRequiresOrders: Requires<ComponentProps<typeof OrdersEditor>, "orders"> = true;
const OrdersPanelRequiresOrders: Requires<ComponentProps<typeof OrdersPanel>, "orders"> = true;
const StudyPlannerDialogRequiresOrders: Requires<
  ComponentProps<typeof StudyPlannerDialog>,
  "orders"
> = true;
const OrdersImportSummaryDialogRequiresOrders: Requires<
  ComponentProps<typeof OrdersImportSummaryDialog>,
  "orders"
> = true;

const POLICY_OPERATIONS = [
  "lexOrderLine",
  "findUnitBlocks",
  "findFormBlocks",
  "repairFormedUnitBlocks",
  "regionUnitIdsAt",
  "formBlockFor",
  "blockFor",
  "readUnitOrders",
  "writeUnitOrders",
  "ensureUnitBlock",
  "applyUnitOrders",
  "stripUnitComments",
  "withUnitComments",
  "stripMovementOrderLines",
  "stripLongOrderLines",
  "longOrderOf",
  "reportedLongOrders",
  "bareWords",
  "uppercaseLine",
  "keywordCaseChanges",
  "uppercaseKeywords",
  "keywordJustFinished",
  "lineDepths",
  "indentChanges",
  "indentBlock",
  "contentChanges",
  "tidyInsertion",
  "diagnosticTargets",
  "diagnosticsForUnit",
  "describeOrdersImport",
  "unitIdForDiagnostic",
  "unitLabelForDiagnostic",
  "diffOrders",
  "documentFor",
  "deliverOrdersExport",
  "formedSelectionFor",
  "ordersExportText",
  "writeRouteOrder",
  "studyWritePlan"
] as const satisfies readonly (keyof OrderProcessing)[];

describe("the order comment policy lives in one processing context", () => {
  it("constructs every policy operation at the ruleset boundary", () => {
    const orders = orderProcessingFor("neworigins");
    expect(POLICY_OPERATIONS).toHaveLength(39);
    for (const operation of POLICY_OPERATIONS) {
      expect(orders[operation]).toBeTypeOf("function");
    }
  });

  it("requires the context at each order-related component boundary", () => {
    expect([
      OrdersEditorRequiresOrders,
      OrdersPanelRequiresOrders,
      StudyPlannerDialogRequiresOrders,
      OrdersImportSummaryDialogRequiresOrders
    ]).toEqual([true, true, true, true]);
  });
});
