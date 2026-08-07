import type { OrderDiagnostic, OrderValidationResult } from "@atlantis/core-client";

export const ORDER_COMMAND_VOCABULARY = ["MOVE", "HOLD"] as const;

export type OrderValidationSummary = {
  errorCount: number;
  warningCount: number;
  blocking: boolean;
  diagnostics: OrderDiagnostic[];
};

export function suggestOrderCommands(prefix: string): string[] {
  const normalizedPrefix = prefix.trim().toUpperCase();
  return ORDER_COMMAND_VOCABULARY.filter((command) => command.startsWith(normalizedPrefix));
}

export function summarizeOrderValidation(result: OrderValidationResult): OrderValidationSummary {
  const errorCount = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  return {
    errorCount,
    warningCount,
    blocking: errorCount > 0,
    diagnostics: result.diagnostics
  };
}

export function canExportOrders(result: OrderValidationResult): boolean {
  return summarizeOrderValidation(result).blocking === false;
}

export function shouldTriggerAutosave(
  lastEditAt: number,
  now: number,
  intervalMs = 5_000
): boolean {
  return now - lastEditAt >= intervalMs;
}

export function shouldSaveOnBlur(hasUnsavedChanges: boolean): boolean {
  return hasUnsavedChanges;
}
