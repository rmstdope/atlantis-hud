/**
 * The assistant asking the HUD to send the orders (ah-9vmbx.2), decided apart from how it is drawn
 * and wired.
 *
 * The HUD's own Send dialog opens by itself with one extra line and the reminders; the player's
 * password is the go-ahead and never leaves the dialog. Everything here is a rule over plain values
 * - what the reminders say, which phase ends the request, what the assistant is told - because this
 * package has no jsdom and an effect cannot be tested in it (`.cerebro/traps.md`). The person-facing
 * strings are the ones agreed on the bead's acceptance and are quoted, not paraphrased.
 */

import { withoutFactionPassword } from "../ordersDocument";
import type { NewAgeOrderVerdict } from "../workspace/newAgeApi";
import { NEW_AGE_HOST } from "../workspace/newAgeSignInView";
import {
  newAgeSendErrors,
  newAgeSendOutcome,
  newAgeSendSettles,
  newAgeSendWarnings,
  newAgeSendWorldMessage,
  type NewAgeSendPhase
} from "../workspace/newAgeSendView";
import { outcomeMessage, showsServerReport, type SendOrdersPhase } from "../workspace/sendOrdersView";

/** How long the prompt waits for the password. */
export const ASSISTANT_SEND_WAIT_MS = 5 * 60_000;

/** The line under the meta line, marked by a brass left edge. */
export const ASSISTANT_ASKS_LINE =
  "Your assistant asks to send these orders. Type the faction password to send them, or Cancel to refuse.";

/** Instead of the reminders, when nothing is outstanding. */
export const ASSISTANT_ALL_CLEAR_LINE =
  "Every change by the assistant has been kept or reverted. No problems found in these orders.";

/** What the prompt says once the assistant is no longer waiting. */
export const ASSISTANT_STOPPED_LINE =
  "The assistant stopped waiting for an answer, so nothing was sent. Ask it again, or press Send in the top bar.";

/** One reminder line, and how it reads: amber for something outstanding, soft for the all-clear. */
export type SendReminder = { readonly text: string; readonly tone: "warn" | "soft" };

/**
 * What the dialog adds when the assistant asked for it. `asking` while the player can answer;
 * `stopped` once the assistant no longer waits, which leaves only the sentence and a Close.
 */
export type AssistantPrompt =
  | { readonly kind: "asking"; readonly reminders: readonly SendReminder[] }
  | { readonly kind: "stopped" };

/** How a request ended, for the one answer the assistant gets. */
export type AssistantSendOutcome =
  | { kind: "accepted"; turnNumber: number | null; serverReport: string | null }
  | { kind: "saved"; turnNumber: number | null; verdict: NewAgeOrderVerdict }
  /** `host` is named for a New Age world; null is the New Origins server. */
  | { kind: "unreachable"; host: string | null }
  | { kind: "declined" }
  | { kind: "notAnswered" }
  | { kind: "gameChanged" }
  /** Refused before anything was shown; `reason` is the whole sentence. */
  | { kind: "refused"; reason: string };

/**
 * The reminders above the password field: each count only when it is not zero, in amber, and the
 * one soft all-clear line when both are.
 */
export function sendReminders(pendingChanges: number, problems: number): readonly SendReminder[] {
  const lines: SendReminder[] = [];
  if (pendingChanges > 0) {
    lines.push({
      text: `${pendingChanges} ${pendingChanges === 1 ? "change" : "changes"} by the assistant you have not kept or reverted yet`,
      tone: "warn"
    });
  }
  if (problems > 0) {
    lines.push({ text: `${problems} ${problems === 1 ? "problem" : "problems"} found in these orders`, tone: "warn" });
  }
  return lines.length > 0 ? lines : [{ text: ASSISTANT_ALL_CLEAR_LINE, tone: "soft" }];
}

/**
 * Why the HUD refuses to show a prompt at all, or null when it may. In this order, so the
 * assistant hears the reason it can act on first: open a game, fix the orders, then wait.
 */
export function assistantSendRefusal(facts: {
  gameOpen: boolean;
  /** Whether this game's world can be sent to from the app at all. */
  sendRoad: boolean;
  /** Whether these orders can be sent as they stand. */
  canSend: boolean;
  /** The HUD's own sentence for why Send is off. */
  offReason: string;
  /** Whether an assistant's send prompt is already waiting. */
  promptOpen: boolean;
  /** Whether a Send dialog, or any other window, is open in the HUD. */
  dialogOpen: boolean;
}): string | null {
  if (!facts.gameOpen) {
    return "No game is open in Atlantis HUD. Nothing was sent.";
  }
  if (!facts.sendRoad) {
    return "Atlantis HUD cannot send orders for this world; the player has to export them and upload them. Nothing was sent.";
  }
  if (!facts.canSend) {
    return `These orders cannot be sent from Atlantis HUD: ${facts.offReason} Nothing was sent.`;
  }
  if (facts.promptOpen) {
    return "A send request is already waiting for the player in Atlantis HUD. Nothing was sent.";
  }
  if (facts.dialogOpen) {
    return "The player has another window open in Atlantis HUD; ask again once they have closed it. Nothing was sent.";
  }
  return null;
}

/** Whether this New Origins phase ends the request, and how; null while the player may still act. */
export function settledOriginsSend(phase: SendOrdersPhase, turnNumber: number | null): AssistantSendOutcome | null {
  switch (phase.kind) {
    case "sent":
      return { kind: "accepted", turnNumber, serverReport: phase.serverReport };
    case "unreachable":
      return { kind: "unreachable", host: null };
    default:
      // A refused password is retyped in the same prompt; the assistant hears only how it ends.
      return null;
  }
}

/** Whether this New Age phase ends the request, and how; null while the player may still act. */
export function settledNewAgeSend(phase: NewAgeSendPhase, turnNumber: number | null): AssistantSendOutcome | null {
  if (!newAgeSendSettles(phase)) {
    return null;
  }
  return phase.kind === "verdict"
    ? { kind: "saved", turnNumber, verdict: phase.verdict }
    : { kind: "unreachable", host: NEW_AGE_HOST };
}

/**
 * Whether a send is on its way. The five minutes never cut one short: it may already have reached
 * the server, and "nothing was sent" would then be a guess.
 */
export function sendInFlight(phase: SendOrdersPhase | NewAgeSendPhase): boolean {
  return phase.kind === "sending" || phase.kind === "signingIn";
}

/** The one answer the assistant gets: whether anything was sent, and every line the server returned. */
export function assistantSendAnswer(outcome: AssistantSendOutcome): { text: string; isError: boolean } {
  switch (outcome.kind) {
    case "accepted": {
      const sentence = outcomeMessage({ kind: "sent", serverReport: outcome.serverReport }, outcome.turnNumber) ?? "";
      const report = showsServerReport(outcome.serverReport)
        ? `The server reported:\n${(outcome.serverReport ?? "").trim()}`
        : "The server reported no errors.";
      return { text: withoutFactionPassword(`${sentence}\n${report}`), isError: false };
    }
    case "saved": {
      const phase: NewAgeSendPhase = { kind: "verdict", verdict: outcome.verdict };
      const parts = [newAgeSendOutcome(phase, outcome.turnNumber)?.text ?? ""];
      const errors = newAgeSendErrors(phase);
      const warnings = newAgeSendWarnings(phase);
      if (errors.length > 0) {
        parts.push(`Errors:\n${errors.map((line) => `- ${line}`).join("\n")}`);
      }
      if (warnings.length > 0) {
        parts.push(`Warnings:\n${warnings.map((line) => `- ${line}`).join("\n")}`);
      }
      const message = newAgeSendWorldMessage(phase);
      if (message !== null) {
        parts.push(`The world reported: ${message}`);
      }
      return { text: withoutFactionPassword(parts.join("\n")), isError: false };
    }
    case "unreachable":
      return {
        text: `${outcome.host ?? "The server"} could not be reached, so the orders were not sent. The player was shown the same.`,
        isError: true
      };
    case "declined":
      return { text: "The player declined to send the orders. Nothing was sent.", isError: true };
    case "notAnswered":
      return { text: "Nobody typed the faction password within 5 minutes. Nothing was sent.", isError: true };
    case "gameChanged":
      return { text: "The player opened another game, so nothing was sent.", isError: true };
    case "refused":
      return { text: outcome.reason, isError: true };
  }
}
