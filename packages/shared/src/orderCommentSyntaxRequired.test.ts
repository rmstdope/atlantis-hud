/**
 * Every order-text reader must be told which world's comment rule to read under.
 *
 * A defaulted syntax parameter cannot fail a call that forgets it, so a missed reader type-checks
 * and passes every test while a Trident document is read under New Origins rules. Each line below
 * fails `tsc` if its function, input or prop regains a default or becomes optional.
 */
import { describe, expect, it } from "vitest";
import { diagnosticTargets } from "./diagnosticNav";
import { diagnosticsForUnit } from "./orderEditor";
import {
  describeOrdersImport,
  unitIdForDiagnostic,
  unitLabelForDiagnostic
} from "./ordersImport";
import { diffOrders } from "./turnDiff";
import { documentFor } from "./orderDraft";
import { studyWritePlan } from "./studyOrdersWrite";
import { deliverOrdersExport } from "./workspace/exportActions";
import { ordersExportText } from "./workspace/ordersExport";
import { formedSelectionFor } from "./workspace/ordersLock";
import {
  bareWords,
  keywordCaseChanges,
  keywordJustFinished,
  uppercaseKeywords,
  uppercaseLine
} from "./orderCase";
import {
  contentChanges,
  indentBlock,
  indentChanges,
  lineDepths,
  tidyInsertion
} from "./orderIndent";
import {
  applyUnitOrders,
  blockFor,
  ensureUnitBlock,
  findFormBlocks,
  findUnitBlocks,
  formBlockFor,
  longOrderOf,
  readUnitOrders,
  regionUnitIdsAt,
  repairFormedUnitBlocks,
  reportedLongOrders,
  stripLongOrderLines,
  stripMovementOrderLines,
  stripUnitComments,
  withUnitComments,
  writeRouteOrder,
  writeUnitOrders
} from "./ordersDocument";
import type { OrderCommentSyntax } from "./rulesets";

/** The parameter tuple of `F`, with no constraint on `F` (so no `any` is needed). */
type Params<F> = F extends (...args: infer P) => unknown ? P : never;

/** True when no parameter of `F` may be omitted and its last parameter is exactly the comment syntax. */
type TakesTheSyntax<F> =
  Params<F> extends Required<Params<F>>
    ? Params<F> extends [...unknown[], infer Last]
      ? [Last] extends [OrderCommentSyntax]
        ? [OrderCommentSyntax] extends [Last]
          ? true
          : false
        : false
      : false
    : false;

/** True when `K` is a required key of `T`. */
type Requires<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;

const findUnitBlocksTakesTheSyntax: TakesTheSyntax<typeof findUnitBlocks> = true;
const findFormBlocksTakesTheSyntax: TakesTheSyntax<typeof findFormBlocks> = true;
const repairFormedUnitBlocksTakesTheSyntax: TakesTheSyntax<typeof repairFormedUnitBlocks> = true;
const regionUnitIdsAtTakesTheSyntax: TakesTheSyntax<typeof regionUnitIdsAt> = true;
const formBlockForTakesTheSyntax: TakesTheSyntax<typeof formBlockFor> = true;
const blockForTakesTheSyntax: TakesTheSyntax<typeof blockFor> = true;
const readUnitOrdersTakesTheSyntax: TakesTheSyntax<typeof readUnitOrders> = true;
const writeUnitOrdersTakesTheSyntax: TakesTheSyntax<typeof writeUnitOrders> = true;
const ensureUnitBlockTakesTheSyntax: TakesTheSyntax<typeof ensureUnitBlock> = true;
const applyUnitOrdersTakesTheSyntax: TakesTheSyntax<typeof applyUnitOrders> = true;
const stripUnitCommentsTakesTheSyntax: TakesTheSyntax<typeof stripUnitComments> = true;
const withUnitCommentsTakesTheSyntax: TakesTheSyntax<typeof withUnitComments> = true;
const stripMovementOrderLinesTakesTheSyntax: TakesTheSyntax<typeof stripMovementOrderLines> = true;
const stripLongOrderLinesTakesTheSyntax: TakesTheSyntax<typeof stripLongOrderLines> = true;
const longOrderOfTakesTheSyntax: TakesTheSyntax<typeof longOrderOf> = true;
const reportedLongOrdersTakesTheSyntax: TakesTheSyntax<typeof reportedLongOrders> = true;
const bareWordsTakesTheSyntax: TakesTheSyntax<typeof bareWords> = true;
const uppercaseLineTakesTheSyntax: TakesTheSyntax<typeof uppercaseLine> = true;
const keywordCaseChangesTakesTheSyntax: TakesTheSyntax<typeof keywordCaseChanges> = true;
const uppercaseKeywordsTakesTheSyntax: TakesTheSyntax<typeof uppercaseKeywords> = true;
const keywordJustFinishedTakesTheSyntax: TakesTheSyntax<typeof keywordJustFinished> = true;
const lineDepthsTakesTheSyntax: TakesTheSyntax<typeof lineDepths> = true;
const indentChangesTakesTheSyntax: TakesTheSyntax<typeof indentChanges> = true;
const indentBlockTakesTheSyntax: TakesTheSyntax<typeof indentBlock> = true;
const contentChangesTakesTheSyntax: TakesTheSyntax<typeof contentChanges> = true;
const tidyInsertionTakesTheSyntax: TakesTheSyntax<typeof tidyInsertion> = true;
const diagnosticTargetsTakesTheSyntax: TakesTheSyntax<typeof diagnosticTargets> = true;
const diagnosticsForUnitTakesTheSyntax: TakesTheSyntax<typeof diagnosticsForUnit> = true;
const describeOrdersImportTakesTheSyntax: TakesTheSyntax<typeof describeOrdersImport> = true;
const unitIdForDiagnosticTakesTheSyntax: TakesTheSyntax<typeof unitIdForDiagnostic> = true;
const unitLabelForDiagnosticTakesTheSyntax: TakesTheSyntax<typeof unitLabelForDiagnostic> = true;
const diffOrdersTakesTheSyntax: TakesTheSyntax<typeof diffOrders> = true;
const documentForTakesTheSyntax: TakesTheSyntax<typeof documentFor> = true;
const deliverOrdersExportTakesTheSyntax: TakesTheSyntax<typeof deliverOrdersExport> = true;
const formedSelectionForTakesTheSyntax: TakesTheSyntax<typeof formedSelectionFor> = true;
const ordersExportTextTakesTheSyntax: TakesTheSyntax<typeof ordersExportText> = true;

const FUNCTIONS = {
  findUnitBlocks: findUnitBlocksTakesTheSyntax,
  findFormBlocks: findFormBlocksTakesTheSyntax,
  repairFormedUnitBlocks: repairFormedUnitBlocksTakesTheSyntax,
  regionUnitIdsAt: regionUnitIdsAtTakesTheSyntax,
  formBlockFor: formBlockForTakesTheSyntax,
  blockFor: blockForTakesTheSyntax,
  readUnitOrders: readUnitOrdersTakesTheSyntax,
  writeUnitOrders: writeUnitOrdersTakesTheSyntax,
  ensureUnitBlock: ensureUnitBlockTakesTheSyntax,
  applyUnitOrders: applyUnitOrdersTakesTheSyntax,
  stripUnitComments: stripUnitCommentsTakesTheSyntax,
  withUnitComments: withUnitCommentsTakesTheSyntax,
  stripMovementOrderLines: stripMovementOrderLinesTakesTheSyntax,
  stripLongOrderLines: stripLongOrderLinesTakesTheSyntax,
  longOrderOf: longOrderOfTakesTheSyntax,
  reportedLongOrders: reportedLongOrdersTakesTheSyntax,
  bareWords: bareWordsTakesTheSyntax,
  uppercaseLine: uppercaseLineTakesTheSyntax,
  keywordCaseChanges: keywordCaseChangesTakesTheSyntax,
  uppercaseKeywords: uppercaseKeywordsTakesTheSyntax,
  keywordJustFinished: keywordJustFinishedTakesTheSyntax,
  lineDepths: lineDepthsTakesTheSyntax,
  indentChanges: indentChangesTakesTheSyntax,
  indentBlock: indentBlockTakesTheSyntax,
  contentChanges: contentChangesTakesTheSyntax,
  tidyInsertion: tidyInsertionTakesTheSyntax,
  diagnosticTargets: diagnosticTargetsTakesTheSyntax,
  diagnosticsForUnit: diagnosticsForUnitTakesTheSyntax,
  describeOrdersImport: describeOrdersImportTakesTheSyntax,
  unitIdForDiagnostic: unitIdForDiagnosticTakesTheSyntax,
  unitLabelForDiagnostic: unitLabelForDiagnosticTakesTheSyntax,
  diffOrders: diffOrdersTakesTheSyntax,
  documentFor: documentForTakesTheSyntax,
  deliverOrdersExport: deliverOrdersExportTakesTheSyntax,
  formedSelectionFor: formedSelectionForTakesTheSyntax,
  ordersExportText: ordersExportTextTakesTheSyntax
};

const writeRouteOrderRequiresTheSyntax: Requires<Parameters<typeof writeRouteOrder>[0], "syntax"> =
  true;

const studyWritePlanRequiresTheSyntax: Requires<Parameters<typeof studyWritePlan>[0], "syntax"> =
  true;

const INPUTS = {
  writeRouteOrder: writeRouteOrderRequiresTheSyntax,
  studyWritePlan: studyWritePlanRequiresTheSyntax
};

describe("the order comment syntax is never defaulted", () => {
  it("every order-text function requires the comment syntax", () => {
    expect(Object.keys(FUNCTIONS)).toHaveLength(36);
  });

  it("every order-writing input requires the comment syntax", () => {
    expect(Object.keys(INPUTS)).toHaveLength(2);
  });
});
