/**
 * The check a report gets the first time it is opened (ah-fdmb): does the game's ruleset define
 * everything it names? And the words of the dialog that says so when it does not.
 *
 * Pure on purpose: the shell hands in parsed reports and parsed rulesets, and the dialog renders
 * what comes back. Which names a ruleset lacks is `rulesetGaps`' answer, shared with Settings'
 * ruleset change (ah-gicw).
 */
import type { ParsedReport } from "@atlantis/core-client";
import type { GameDataIndex } from "./gameData";
import { ISSUES_URL } from "./projectLinks";
import { GAP_KIND_LABELS, rulesetGaps, type RulesetGaps } from "./rulesetGaps";

/** A report just taken into the game, with the file name the player knows it by. */
export type OpenedReport = { fileName: string; report: ParsedReport };

/** One check: of `total` reports, `affected` name the `gaps` that `rulesetId` does not define. */
export type ReportCheck = {
  rulesetId: string;
  total: number;
  affected: OpenedReport[];
  gaps: RulesetGaps;
};

/** A run of text, bold or not: how the agreed sentences set a file or ruleset name in bold. */
export type Words = { text: string; bold?: boolean }[];

/** What makes two openings the same report: its faction and turn. */
export function openedReportKey(report: ParsedReport): string {
  return `${report.header.factionId ?? "?"}:${report.header.turnNumber ?? "?"}`;
}

const asTurn = (opened: OpenedReport) => ({
  turnNumber: opened.report.header.turnNumber ?? 0,
  report: opened.report
});

/**
 * Checks `reports` against `rulesetId`. `indexes` holds every shipped ruleset, which settles a
 * tag's kind and name; `null` when the target is not among them, so nothing can be said.
 */
export function checkOpenedReports(
  reports: readonly OpenedReport[],
  rulesetId: string,
  indexes: ReadonlyMap<string, GameDataIndex>
): ReportCheck | null {
  const target = indexes.get(rulesetId);
  if (!target) {
    return null;
  }
  const known = [target, ...[...indexes].filter(([id]) => id !== rulesetId).map(([, index]) => index)];
  const affected = reports.filter((opened) => rulesetGaps([asTurn(opened)], target, known, rulesetId).count > 0);
  return {
    rulesetId,
    total: reports.length,
    affected,
    gaps: rulesetGaps(affected.map(asTurn), target, known, rulesetId)
  };
}

/** How many of `before`'s names `after` no longer lists. */
export function nowDefined(before: RulesetGaps, after: RulesetGaps): number {
  const still = new Set(after.groups.flatMap((group) => group.names.map((name) => `${group.kind}:${name}`)));
  return before.groups.reduce(
    (sum, group) => sum + group.names.filter((name) => !still.has(`${group.kind}:${name}`)).length,
    0
  );
}

const WRONG_RULESET = " ruleset doesn’t define. This usually means the game was set up with the wrong ruleset.";

export type ReportCheckWords = {
  title: string;
  intro: Words;
  heading: string;
  /** The affected reports, comma-separated, in a batch with more than one; `null` otherwise. */
  files: string | null;
  groups: { heading: string; names: string }[];
};

/** Screen 1's words, verbatim from the agreed acceptance. One affected report reads as a single one. */
export function reportCheckWords(check: ReportCheck, rulesetLabel: string): ReportCheckWords {
  const n = check.gaps.count;
  const single = check.affected.length === 1;
  const intro: Words = single
    ? [
        { text: "The report " },
        { text: check.affected[0].fileName, bold: true },
        { text: ` names ${n} things the ` },
        { text: rulesetLabel, bold: true },
        { text: WRONG_RULESET }
      ]
    : [
        { text: `${check.affected.length} of the ${check.total} reports you imported name ${n} things the ` },
        { text: rulesetLabel, bold: true },
        { text: WRONG_RULESET }
      ];
  return {
    title: "⚠ Check this game’s ruleset",
    intro,
    heading: `Not defined in ${rulesetLabel}`,
    files: single ? null : check.affected.map((opened) => opened.fileName).join(", "),
    groups: check.gaps.groups.map((group) => ({
      heading: `${GAP_KIND_LABELS[group.kind]} (${group.names.length})`,
      names: group.names.join(", ")
    }))
  };
}

/** `✓ Changed to <ruleset>. Everything in <file> is now defined.`; `files` are the reports the dialog opened on. */
export function confirmedWords(rulesetLabel: string, files: readonly string[]): Words {
  return [
    { text: "✓ Changed to " },
    { text: rulesetLabel, bold: true },
    { text: ". Everything in " },
    { text: files.length === 1 ? files[0] : "the imported reports", bold: true },
    { text: " is now defined." }
  ];
}

/** `Changed to <ruleset> — <d> of the <m> names are now defined.` */
export function stillMissingWords(rulesetLabel: string, defined: number, of: number): string {
  return `Changed to ${rulesetLabel} — ${defined} of the ${of} names are now defined.`;
}

/** Screen 2's intro. */
export function reportStepIntro(rulesetLabel: string, count: number): string {
  return `If ${rulesetLabel} really is this game’s ruleset, the app is missing these ${count} names. Please tell us so they can be added.`;
}

/** The GitHub issue's title. */
export function issueTitle(rulesetLabel: string): string {
  return `Names missing from the ${rulesetLabel} ruleset`;
}

/** The GitHub issue's body, which is also what `Copy the list` copies. */
export function issueBody(check: ReportCheck, rulesetLabel: string, appVersion: string): string {
  const turns = [
    ...new Set(
      check.affected.flatMap((opened) => (opened.report.header.turnNumber === null ? [] : [opened.report.header.turnNumber]))
    )
  ].sort((a, b) => a - b);
  return [
    `A report names things the ${rulesetLabel} ruleset does not define. I have checked that ${rulesetLabel} is the right ruleset for this game.`,
    "",
    `Ruleset: ${rulesetLabel}`,
    `Report turn: ${turns.join(", ")}`,
    `App version: ${appVersion}`,
    "",
    ...check.gaps.groups.map(
      (group) => `${GAP_KIND_LABELS[group.kind]} (${group.names.length}): ${group.names.join(", ")}`
    )
  ].join("\n");
}

/** A new issue on the project's GitHub, prefilled. */
export function issueUrl(title: string, body: string): string {
  return `${ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

const NEW_ORIGINS_DISCORD = "https://discord.gg/2MkXpUTAj";
const NEW_AGE_DISCORD = "https://discord.gg/Nd835Zj54";

/** The Discord of the world a ruleset belongs to, both New Age worlds sharing one; `null` for none. */
export function discordFor(rulesetId: string): { label: string; url: string } | null {
  if (rulesetId === "neworigins") {
    return { label: "Open the New Origins Discord", url: NEW_ORIGINS_DISCORD };
  }
  if (rulesetId.startsWith("newage-")) {
    return { label: "Open the New Age Discord", url: NEW_AGE_DISCORD };
  }
  return null;
}
