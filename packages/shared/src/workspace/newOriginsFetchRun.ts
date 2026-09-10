/**
 * One press of Fetch on a New Origins game, up to the point a person is asked.
 *
 * A pure async function over injected effects, the shape `newAgeFetchRun.ts` has and for the same
 * reason: this package has no jsdom (ah-nass), so the order of the steps and the failure rules are
 * pinned by unit tests rather than by reading a component.
 *
 * **The run stops at the question rather than awaiting an answer.** It returns `arrived` carrying
 * the parsed report and its text, and the shell holds those while the dialog asks. An `ask()`
 * effect returning a promise was rejected: it makes this control flow depend on a component's
 * lifetime, and a dialog torn down by a game switch would leave that promise unsettled for ever.
 */

import type { ParsedReport } from "@atlantis/core-client";

import { judgeReportUsable, type LoadedReportIdentity } from "../reportLoadDecision";
import type { NewOriginsDownloadResult } from "./newOriginsApi";
import {
  decideArrival,
  REFUSED_WITHOUT_A_SENTENCE,
  type NewOriginsArrival,
  type NewOriginsFetchPhase
} from "./newOriginsFetchView";

export type NewOriginsFetchOutcome =
  /** The site said no. `message` is its own sentence, or `REFUSED_WITHOUT_A_SENTENCE`. */
  | { kind: "refused"; message: string }
  /** The transport could not reach it. Both fields keep what was typed. */
  | { kind: "unreachable" }
  /** Something came back that is not a report: it would not parse, or it is not importable. */
  | { kind: "unreadable" }
  /** A report arrived. `arrival` says what to do with it; the shell holds `report` and `text`. */
  | { kind: "arrived"; arrival: NewOriginsArrival; report: ParsedReport; text: string }
  /** Cancel or Escape, at a boundary. Nothing was loaded. */
  | { kind: "abandoned" };

export type NewOriginsFetchEffects = {
  /** `downloadNewOriginsReport` bound to this shell's transport and this run's signal. */
  download: (factionId: string, password: string) => Promise<NewOriginsDownloadResult>;
  /** `parseReport`. Rejects for a body that is not a report at all. */
  parse: (text: string) => Promise<ParsedReport>;
  /** What is on screen, read from `viewerRef` and never from a render. */
  current: () => LoadedReportIdentity | null;
  onPhase: (phase: NewOriginsFetchPhase) => void;
  abandoned: () => boolean;
};

const ABANDONED = { kind: "abandoned" } as const;
const UNREADABLE_OUTCOME = { kind: "unreadable" } as const;

export async function runNewOriginsFetch(
  credentials: { factionNumber: string; password: string },
  effects: NewOriginsFetchEffects
): Promise<NewOriginsFetchOutcome> {
  if (effects.abandoned()) {
    return ABANDONED;
  }

  effects.onPhase({ kind: "fetching" });
  const downloaded = await effects.download(credentials.factionNumber, credentials.password);
  if (downloaded.kind === "unreachable") {
    return { kind: "unreachable" };
  }
  if (downloaded.kind === "refused") {
    return { kind: "refused", message: downloaded.reason ?? REFUSED_WITHOUT_A_SENTENCE };
  }

  if (effects.abandoned()) {
    return ABANDONED;
  }

  let report: ParsedReport;
  try {
    report = await effects.parse(downloaded.text);
  } catch {
    // Discarded unexamined: a parse failure's message could quote the body, and the body could be
    // an orders echo carrying the faction password in cleartext.
    return UNREADABLE_OUTCOME;
  }
  if (!judgeReportUsable(report).ok) {
    // A truncated or faction-less reply is the same failure to a player as a page that would not
    // parse, and the agreed design has one sentence for both.
    return UNREADABLE_OUTCOME;
  }

  const arrival = decideArrival(effects.current(), {
    factionId: report.header.factionId,
    turnNumber: report.header.turnNumber
  });
  return { kind: "arrived", arrival, report, text: downloaded.text };
}
