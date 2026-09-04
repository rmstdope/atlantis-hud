import { describe, expect, it } from "vitest";
import {
  decideFiling,
  REFRESH_BRANCH,
  REFRESH_ISSUE_LABEL,
  refreshIssueBody,
  refreshPullRequestBody,
  refreshPullRequestTitle
} from "./atlantisRefresh";

describe("refreshPullRequestTitle", () => {
  it("titles one world's refresh with the sources that moved", () => {
    const title = refreshPullRequestTitle({
      kind: "refreshed",
      worlds: [{ world: "neworigins", changedSources: ["rules", "data"], rulesetChanges: [] }]
    });

    expect(title).toBe("Atlantis rules refresh: neworigins's rules page and data page changed");
  });

  it("titles a multi-world refresh by the count", () => {
    const title = refreshPullRequestTitle({
      kind: "refreshed",
      worlds: [
        { world: "newage-arcanum", changedSources: ["database"], rulesetChanges: [] },
        { world: "newage-trident", changedSources: ["rules"], rulesetChanges: [] }
      ]
    });

    expect(title).toBe("Atlantis rules refresh: 2 worlds changed");
  });
});

describe("refreshIssueBody", () => {
  it("names the world in the issue body", () => {
    const body = refreshIssueBody("newage-trident", "cannot find the sentence …");

    expect(body).toContain("newage-trident's ruleset");
    expect(body).toContain("cannot find the sentence …");
    expect(body).toContain("Nothing on disk was changed.");
  });
});

describe("refreshPullRequestBody", () => {
  it("gives every changed world its own block in the body", () => {
    const body = refreshPullRequestBody({
      kind: "refreshed",
      worlds: [
        {
          world: "neworigins",
          changedSources: ["rules", "data"],
          rulesetChanges: ["items.MSWO.weight 2 → 3", "skills.MINI.cost 10 → 12"]
        },
        { world: "newage-arcanum", changedSources: ["database"], rulesetChanges: [] }
      ]
    });

    expect(body).toContain("neworigins");
    expect(body).toContain("items.MSWO.weight 2 → 3");
    expect(body).toContain("skills.MINI.cost 10 → 12");
    expect(body).toContain("newage-arcanum");
    expect(body).toContain("No ruleset field changed — only the page text moved.");
    expect(body).toContain("These are numbers the route planner uses — read the diff before merging.");
  });
});

describe("decideFiling", () => {
  it("reuses the open pull request rather than opening a second", () => {
    const decision = decideFiling(
      [{ number: 42, title: "Atlantis rules refresh", labels: [], headRefName: REFRESH_BRANCH }],
      "pull-request"
    );

    expect(decision).toEqual({ action: "update", number: 42 });
  });

  it("does not file a second issue while one is open", () => {
    const decision = decideFiling(
      [{ number: 7, title: "some title", labels: [REFRESH_ISSUE_LABEL] }],
      "issue"
    );

    expect(decision).toEqual({ action: "update", number: 7 });
  });

  it("ignores a renamed pull request", () => {
    const decision = decideFiling(
      [{ number: 42, title: "Atlantis rules refresh", labels: [], headRefName: "someone-elses-branch" }],
      "pull-request"
    );

    expect(decision).toEqual({ action: "create" });
  });

  it("does not match on title alone", () => {
    const decision = decideFiling(
      [{ number: 9, title: "Atlantis rules page reworded — the scraper cannot regenerate the ruleset", labels: [] }],
      "issue"
    );

    expect(decision).toEqual({ action: "create" });
  });

  it("creates when nothing open matches", () => {
    expect(decideFiling([], "pull-request")).toEqual({ action: "create" });
    expect(decideFiling([], "issue")).toEqual({ action: "create" });
  });
});
