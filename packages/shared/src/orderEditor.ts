import type { OrderDiagnostic, OrderValidationResult } from "@atlantis/core-client";

/**
 * Order commands the NewOrigins ruleset accepts.
 *
 * Mirrors ORDER_COMMANDS in crates/core. The Rust core is the authority: it decides what validates,
 * and this list exists only so the editor can offer completions without a round trip.
 */
export const ORDER_COMMAND_VOCABULARY = [
  "ADDRESS",
  "ADVANCE",
  "ANNIHILATE",
  "ARMOR",
  "ASSASSINATE",
  "ATTACK",
  "AUTOTAX",
  "AVOID",
  "BEHIND",
  "BUILD",
  "BUY",
  "CAST",
  "CLAIM",
  "COMBAT",
  "CONSUME",
  "DECLARE",
  "DESCRIBE",
  "DESTROY",
  "ENDFORM",
  "ENDTURN",
  "ENTER",
  "ENTERTAIN",
  "EVICT",
  "EXCHANGE",
  "FACTION",
  "FIND",
  "FORGET",
  "FORM",
  "GIVE",
  "GUARD",
  "HOLD",
  "IDLE",
  "JOIN",
  "LEAVE",
  "MOVE",
  "NAME",
  "NOAID",
  "NOCROSS",
  "NOSPOILS",
  "OPTION",
  "PASSWORD",
  "PILLAGE",
  "PREPARE",
  "PRODUCE",
  "PROMOTE",
  "QUIT",
  "RESTART",
  "REVEAL",
  "SAIL",
  "SELL",
  "SHARE",
  "SHOW",
  "SPOILS",
  "STEAL",
  "STUDY",
  "SWEAR",
  "TAKE",
  "TAX",
  "TEACH",
  "TRANSPORT",
  "TURN",
  "WEAPON",
  "WISHDRAW",
  "WITHDRAW",
  "WORK"
] as const;

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
