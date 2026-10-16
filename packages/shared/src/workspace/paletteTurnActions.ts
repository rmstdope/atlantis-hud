/**
 * The command palette's rows for the header's Import, Fetch and Send (ah-mlls.7): which exist, and
 * why one is greyed. Pure, so the rule is tested without the shell; `AppShell` attaches what each
 * row does.
 *
 * A row exists exactly where the header shows its button, and is greyed exactly where the header
 * greys it - with the reason written out, since the palette has no tooltip a keyboard user could
 * read.
 */

import type { StorageHeldScope } from "@atlantis/core-client";

export type TurnActionId = "import-reports" | "fetch-latest" | "fetch-all" | "send-orders";

export type TurnActionsInput = {
  /** The header is rendered only with a game open, so without one there are no rows at all. */
  gameOpen: boolean;
  /** The header's `busy`: its Import button is greyed and reads `importingLabel` meanwhile. */
  importBusy: boolean;
  importProgress: { done: number; total: number } | null;
  /** Whose saved data another tab holds, or null; the header greys Import for either. */
  held: StorageHeldScope | null;
  /**
   * Which Fetch window the header's button opens, or null when it has none. Only a New Age
   * window asks "Latest report / All reports not yet fetched/imported", so only it gets two rows.
   */
  fetch: "new-age" | "new-origins" | null;
  /** The header's Send, or null where it renders none (e.g. an upload-form game on the web). */
  send: { canSend: boolean; reason: string } | null;
};

export type TurnActionRow = { id: TurnActionId; label: string; unavailable?: string };

/**
 * What the header's Import button says while it is working.
 *
 * Counted only for a batch. One report is over before a count could be read, and "Importing 1/1…"
 * is a progress bar for a journey of one step.
 */
export function importingLabel(progress: { done: number; total: number } | null): string {
  return progress === null ? "Importing…" : `Importing ${progress.done}/${progress.total}…`;
}

/**
 * Why Import is greyed, or undefined when it is not. A running import is named first: the header's
 * button shows its progress label whenever it is busy, whatever else holds it.
 */
function importUnavailable(input: TurnActionsInput): string | undefined {
  if (input.importBusy) {
    return `${importingLabel(input.importProgress)} — wait for it to finish.`;
  }
  switch (input.held) {
    case "game":
      return "This game is open in another Atlantis HUD tab.";
    case "games-list":
      return "Your saved games are open in another Atlantis HUD tab.";
    default:
      return undefined;
  }
}

/** Import, Fetch and Send as palette rows, in the header's left-to-right order. */
export function paletteTurnActions(input: TurnActionsInput): TurnActionRow[] {
  if (!input.gameOpen) {
    return [];
  }
  const rows: TurnActionRow[] = [];
  const importReason = importUnavailable(input);
  rows.push(
    importReason === undefined
      ? { id: "import-reports", label: "Import reports" }
      : { id: "import-reports", label: "Import reports", unavailable: importReason }
  );
  if (input.fetch !== null) {
    rows.push({ id: "fetch-latest", label: "Fetch latest report" });
  }
  if (input.fetch === "new-age") {
    rows.push({ id: "fetch-all", label: "Fetch all reports not yet fetched/imported" });
  }
  if (input.send !== null) {
    rows.push(
      input.send.canSend
        ? { id: "send-orders", label: "Send orders" }
        : { id: "send-orders", label: "Send orders", unavailable: input.send.reason }
    );
  }
  return rows;
}
