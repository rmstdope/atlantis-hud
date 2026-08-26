/**
 * The decision logic behind `.github/workflows/atlantis-rules-refresh.yml` (ah-97ij.2) — kept here
 * rather than in the workflow's YAML so it can be tested. Every function below is pure: it takes an
 * outcome, or a list of what `gh` reports open, and returns text or a decision. Nothing here
 * fetches, pushes or calls `gh` itself.
 *
 * `scripts/atlantis.ts`'s `refresh --json` command is what produces a `RefreshOutcome`; the workflow
 * reads that JSON and uses the renderers and `decideFiling` below to act on it.
 */

/** What one run of `atlantis refresh` found, structured for a workflow to branch on. */
export type RefreshOutcome =
  | { kind: "unchanged" }
  | { kind: "refreshed"; changedPages: string[]; rulesetChanges: string[] }
  | { kind: "scrape-failed"; message: string };

/** The branch every refresh pushes to, reused rather than accumulating one branch per week. */
export const REFRESH_BRANCH = "atlantis-rules-refresh";

/** The label every issue this workflow files carries, and searches on to avoid filing twice. */
export const REFRESH_ISSUE_LABEL = "atlantis-refresh";

/** Title of the issue filed when the scraper refuses the new page. */
export const REFRESH_ISSUE_TITLE =
  "Atlantis rules page reworded — the scraper cannot regenerate the ruleset";

type Refreshed = Extract<RefreshOutcome, { kind: "refreshed" }>;

/** The pull request's title, given what moved. */
export function refreshPullRequestTitle(outcome: Refreshed): string {
  const pages = outcome.changedPages.join(" and ");
  const plural = outcome.changedPages.length > 1 ? "s" : "";
  return `Atlantis rules refresh: the ${pages} page${plural} changed`;
}

/** The pull request's body: what moved, what it changed in the ruleset, and what to check. */
export function refreshPullRequestBody(outcome: Refreshed): string {
  const pages = outcome.changedPages.join(" and ");
  const plural = outcome.changedPages.length > 1 ? "s" : "";
  const lines = [
    `The ${pages} page${plural} on atlantis-pbem.com moved since the last refresh. This PR carries`,
    "the refreshed pages and the ruleset regenerated from them, together, so the repository stays",
    "green at every commit.",
    ""
  ];

  if (outcome.rulesetChanges.length > 0) {
    lines.push("Ruleset changes:", "");
    for (const change of outcome.rulesetChanges) {
      lines.push(`- ${change}`);
    }
    lines.push(
      "",
      "These are numbers the route planner uses — read the diff before merging."
    );
  } else {
    lines.push("No ruleset field changed — only the page text moved.");
  }

  return lines.join("\n");
}

/** The issue's body: the scraper's own message, and what a person has to decide. */
export function refreshIssueBody(message: string): string {
  return [
    "The scheduled Atlantis rules refresh could not regenerate config/public/ruleset.json:",
    "one of the pages was reworded in a way the scraper does not recognise.",
    "",
    "The scraper's own message:",
    "",
    message,
    "",
    "Nothing on disk was changed. Read the live page, decide what changed, and update the scraper",
    "(or, if the wording is merely cosmetic, the scraper's expectations) by hand."
  ].join("\n");
}

/** One pull request or issue as `gh` reports it, the parts `decideFiling` needs. */
export type OpenItem = {
  number: number;
  title: string;
  labels: string[];
  headRefName?: string;
};

/** Whether to open something new or add to what is already there. */
export type FilingDecision = { action: "create" } | { action: "update"; number: number };

/**
 * Whether to open something new or add to what is already there, given what `gh` reports open.
 * Weekly means this runs again while last week's pull request may still be unmerged, and while the
 * website may still be carrying the sentence the scraper cannot read.
 *
 * Matches a pull request on `headRefName === REFRESH_BRANCH` and an issue on `labels` containing
 * `REFRESH_ISSUE_LABEL` — never on the title, which a person may reasonably edit or which may
 * coincidentally read the same as one this workflow would file.
 */
export function decideFiling(
  open: ReadonlyArray<OpenItem>,
  kind: "pull-request" | "issue"
): FilingDecision {
  const match =
    kind === "pull-request"
      ? open.find((item) => item.headRefName === REFRESH_BRANCH)
      : open.find((item) => item.labels.includes(REFRESH_ISSUE_LABEL));

  return match ? { action: "update", number: match.number } : { action: "create" };
}
