import { diagnosticTargets } from "./diagnosticNav";
import {
  bareWords,
  keywordCaseChanges,
  keywordJustFinished,
  uppercaseKeywords,
  uppercaseLine
} from "./orderCase";
import { documentFor } from "./orderDraft";
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
import { diagnosticsForUnit } from "./orderEditor";
import { contentChanges, indentBlock, indentChanges, lineDepths, tidyInsertion } from "./orderIndent";
import { describeOrdersImport, unitIdForDiagnostic, unitLabelForDiagnostic } from "./ordersImport";
import { orderCommentSyntaxFor, type OrderCommentSyntax } from "./rulesets";
import { studyWritePlan } from "./studyOrdersWrite";
import { diffOrders } from "./turnDiff";
import { deliverOrdersExport } from "./workspace/exportActions";
import { ordersExportText } from "./workspace/ordersExport";
import { formedSelectionFor } from "./workspace/ordersLock";
import { lexOrderLine } from "./orderLine";

type WithoutSyntax<F> =
  F extends (...args: [...infer Args, OrderCommentSyntax]) => infer Result
    ? (...args: Args) => Result
    : never;

type WithoutSyntaxInput<F> =
  F extends (input: infer Input) => infer Result
    ? (input: Omit<Input, "syntax">) => Result
    : never;

export interface OrderProcessing {
  readonly lexOrderLine: WithoutSyntax<typeof lexOrderLine>;
  readonly findUnitBlocks: WithoutSyntax<typeof findUnitBlocks>;
  readonly findFormBlocks: WithoutSyntax<typeof findFormBlocks>;
  readonly repairFormedUnitBlocks: WithoutSyntax<typeof repairFormedUnitBlocks>;
  readonly regionUnitIdsAt: WithoutSyntax<typeof regionUnitIdsAt>;
  readonly formBlockFor: WithoutSyntax<typeof formBlockFor>;
  readonly blockFor: WithoutSyntax<typeof blockFor>;
  readonly readUnitOrders: WithoutSyntax<typeof readUnitOrders>;
  readonly writeUnitOrders: WithoutSyntax<typeof writeUnitOrders>;
  readonly ensureUnitBlock: WithoutSyntax<typeof ensureUnitBlock>;
  readonly applyUnitOrders: WithoutSyntax<typeof applyUnitOrders>;
  readonly stripUnitComments: WithoutSyntax<typeof stripUnitComments>;
  readonly withUnitComments: WithoutSyntax<typeof withUnitComments>;
  readonly stripMovementOrderLines: WithoutSyntax<typeof stripMovementOrderLines>;
  readonly stripLongOrderLines: WithoutSyntax<typeof stripLongOrderLines>;
  readonly longOrderOf: WithoutSyntax<typeof longOrderOf>;
  readonly reportedLongOrders: WithoutSyntax<typeof reportedLongOrders>;
  readonly bareWords: WithoutSyntax<typeof bareWords>;
  readonly uppercaseLine: WithoutSyntax<typeof uppercaseLine>;
  readonly keywordCaseChanges: WithoutSyntax<typeof keywordCaseChanges>;
  readonly uppercaseKeywords: WithoutSyntax<typeof uppercaseKeywords>;
  readonly keywordJustFinished: WithoutSyntax<typeof keywordJustFinished>;
  readonly lineDepths: WithoutSyntax<typeof lineDepths>;
  readonly indentChanges: WithoutSyntax<typeof indentChanges>;
  readonly indentBlock: WithoutSyntax<typeof indentBlock>;
  readonly contentChanges: WithoutSyntax<typeof contentChanges>;
  readonly tidyInsertion: WithoutSyntax<typeof tidyInsertion>;
  readonly diagnosticTargets: WithoutSyntax<typeof diagnosticTargets>;
  readonly diagnosticsForUnit: WithoutSyntax<typeof diagnosticsForUnit>;
  readonly describeOrdersImport: WithoutSyntax<typeof describeOrdersImport>;
  readonly unitIdForDiagnostic: WithoutSyntax<typeof unitIdForDiagnostic>;
  readonly unitLabelForDiagnostic: WithoutSyntax<typeof unitLabelForDiagnostic>;
  readonly diffOrders: WithoutSyntax<typeof diffOrders>;
  readonly documentFor: WithoutSyntax<typeof documentFor>;
  readonly deliverOrdersExport: WithoutSyntax<typeof deliverOrdersExport>;
  readonly formedSelectionFor: WithoutSyntax<typeof formedSelectionFor>;
  readonly ordersExportText: WithoutSyntax<typeof ordersExportText>;
  readonly writeRouteOrder: WithoutSyntaxInput<typeof writeRouteOrder>;
  readonly studyWritePlan: WithoutSyntaxInput<typeof studyWritePlan>;
}

export function orderProcessingFor(rulesetId: string | null | undefined): OrderProcessing {
  const syntax = orderCommentSyntaxFor(rulesetId);

  return {
    lexOrderLine: (line) => lexOrderLine(line, syntax),
    findUnitBlocks: (document) => findUnitBlocks(document, syntax),
    findFormBlocks: (document) => findFormBlocks(document, syntax),
    repairFormedUnitBlocks: (document) => repairFormedUnitBlocks(document, syntax),
    regionUnitIdsAt: (document, region) => regionUnitIdsAt(document, region, syntax),
    formBlockFor: (document, alias, regionUnitIds) => formBlockFor(document, alias, regionUnitIds, syntax),
    blockFor: (document, unitId, regionUnitIds) => blockFor(document, unitId, regionUnitIds, syntax),
    readUnitOrders: (document, unitId, regionUnitIds) => readUnitOrders(document, unitId, regionUnitIds, syntax),
    writeUnitOrders: (document, unitId, orders, regionUnitIds) =>
      writeUnitOrders(document, unitId, orders, regionUnitIds, syntax),
    ensureUnitBlock: (document, unitId, banner) => ensureUnitBlock(document, unitId, banner, syntax),
    applyUnitOrders: (document, unitId, orders, regionUnitIds, banner) =>
      applyUnitOrders(document, unitId, orders, regionUnitIds, banner, syntax),
    stripUnitComments: (document) => stripUnitComments(document, syntax),
    withUnitComments: (document, template) => withUnitComments(document, template, syntax),
    stripMovementOrderLines: (orders) => stripMovementOrderLines(orders, syntax),
    stripLongOrderLines: (orders) => stripLongOrderLines(orders, syntax),
    longOrderOf: (orders) => longOrderOf(orders, syntax),
    reportedLongOrders: (template) => reportedLongOrders(template, syntax),
    bareWords: (line) => bareWords(line, syntax),
    uppercaseLine: (line, vocabulary) => uppercaseLine(line, vocabulary, syntax),
    keywordCaseChanges: (text, vocabulary, protect) => keywordCaseChanges(text, vocabulary, protect, syntax),
    uppercaseKeywords: (text, vocabulary) => uppercaseKeywords(text, vocabulary, syntax),
    keywordJustFinished: (line, at, vocabulary) => keywordJustFinished(line, at, vocabulary, syntax),
    lineDepths: (text) => lineDepths(text, syntax),
    indentChanges: (text) => indentChanges(text, syntax),
    indentBlock: (text) => indentBlock(text, syntax),
    contentChanges: (text, vocabulary, protect) => contentChanges(text, vocabulary, protect, syntax),
    tidyInsertion: (text, baseDepth, vocabulary) => tidyInsertion(text, baseDepth, vocabulary, syntax),
    diagnosticTargets: (text, diagnostics, unitIdsByRegion) =>
      diagnosticTargets(text, diagnostics, unitIdsByRegion, syntax),
    diagnosticsForUnit: (document, unitId, diagnostics, regionUnitIds) =>
      diagnosticsForUnit(document, unitId, diagnostics, regionUnitIds, syntax),
    describeOrdersImport: (fileText, currentDocument) =>
      describeOrdersImport(fileText, currentDocument, syntax),
    unitIdForDiagnostic: (document, diagnostic) => unitIdForDiagnostic(document, diagnostic, syntax),
    unitLabelForDiagnostic: (document, diagnostic) => unitLabelForDiagnostic(document, diagnostic, syntax),
    diffOrders: (older, newer) => diffOrders(older, newer, syntax),
    documentFor: (client, game, key, template) => documentFor(client, game, key, template, syntax),
    deliverOrdersExport: (saveTextFile, turnNumber, ordersDocument, ordersTemplateText, withDescriptions) =>
      deliverOrdersExport(
        saveTextFile,
        turnNumber,
        ordersDocument,
        ordersTemplateText,
        withDescriptions,
        syntax
      ),
    formedSelectionFor: (document, selectedUnitId, regionUnitIds) =>
      formedSelectionFor(document, selectedUnitId, regionUnitIds, syntax),
    ordersExportText: (document, templateText, withDescriptions) =>
      ordersExportText(document, templateText, withDescriptions, syntax),
    writeRouteOrder: (input) => writeRouteOrder({ ...input, syntax }),
    studyWritePlan: (input) => studyWritePlan({ ...input, syntax })
  };
}
