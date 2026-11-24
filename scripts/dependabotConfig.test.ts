/**
 * React and react-dom must reach the repository in one Dependabot pull request.
 *
 * Dependabot opens one pull request per dependency, so a React release used to arrive as several,
 * and react-dom moving ahead of react broke CI (#1978, fixed by hand in ah-h05yn). The npm entry
 * of `.github/dependabot.yml` therefore groups the four React packages (ah-6gn7c).
 *
 * The file is read as text: no YAML parser is a dependency, and one test does not earn one.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const CONFIG = readFileSync(join(REPO, ".github", "dependabot.yml"), "utf8");

const REACT_PACKAGES = ["react", "react-dom", "@types/react", "@types/react-dom"];

/** Each `- package-ecosystem:` entry under `updates:`, as its own block of text. */
function entries(): { ecosystem: string; text: string }[] {
  return CONFIG.split(/^(?= {2}- package-ecosystem:)/m)
    .slice(1)
    .map((text) => ({
      ecosystem: /package-ecosystem:\s*"?([\w-]+)"?/.exec(text)?.[1] ?? "",
      text,
    }));
}

/** The quoted or bare items of the `patterns:` list under the named group, in order. */
function groupPatterns(text: string, group: string): string[] | undefined {
  const block = new RegExp(`^ {6}${group}:\\n {8}patterns:\\n((?: {10}- .*\\n?)+)`, "m").exec(
    text
  );
  return block?.[1]
    .split("\n")
    .filter((line) => line.trim().startsWith("- "))
    .map((line) => line.trim().slice(2).trim().replace(/^"|"$/g, ""));
}

describe("Dependabot bumps the React packages together", () => {
  it("the npm entry groups the React packages into one pull request", () => {
    const npm = entries().filter((entry) => entry.ecosystem === "npm");
    expect(npm).toHaveLength(1);
    expect(npm[0].text).toMatch(/^ {4}groups:$/m);
    expect(groupPatterns(npm[0].text, "react")).toEqual(REACT_PACKAGES);
  });

  it("no other ecosystem entry carries the React group", () => {
    const others = entries().filter((entry) => entry.ecosystem !== "npm");
    expect(others.length).toBeGreaterThan(0);
    for (const entry of others) expect(groupPatterns(entry.text, "react")).toBeUndefined();
  });
});
