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
  it("names both pages in the title when both moved", () => {
    const title = refreshPullRequestTitle({
      kind: "refreshed",
      changedPages: ["rules", "data"],
      rulesetChanges: []
    });

    expect(title).toContain("rules");
    expect(title).toContain("data");
  });
});

describe("refreshIssueBody", () => {
  it("puts the scraper's own message in the issue body", () => {
    const body = refreshIssueBody("cannot find the sentence …");

    expect(body).toContain("cannot find the sentence …");
  });
});

describe("refreshPullRequestBody", () => {
  it("lists every ruleset field that changed", () => {
    const body = refreshPullRequestBody({
      kind: "refreshed",
      changedPages: ["rules", "data"],
      rulesetChanges: ["items.MSWO.weight 2 → 3", "skills.MINI.cost 10 → 12"]
    });

    expect(body).toContain("items.MSWO.weight 2 → 3");
    expect(body).toContain("skills.MINI.cost 10 → 12");
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
