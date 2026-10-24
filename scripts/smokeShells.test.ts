import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../playwright.config";
import { DESKTOP_SHELL_TAG } from "../tests/smoke/shells";

/**
 * Which shell walks which smoke test (ah-r7kot).
 *
 * In Chromium the desktop bundle runs the same core, storage and AppShell as the web one, so a walk
 * that needs nothing the desktop App.tsx wires differently is walked once, on `web`. The
 * `desktop-shell` project walks only the tests tagged `DESKTOP_SHELL_TAG`, and `web` walks none of
 * them. Project selection is the one mechanism: a test that skipped itself unless the project was
 * `desktop-shell` would also need the tag, and a skip without the tag is a test nobody walks.
 */
const SMOKE_DIR = "tests/smoke";

function project(name: string) {
  const found = config.projects?.find((p) => p.name === name);
  if (!found) throw new Error(`playwright.config.ts has no ${name} project`);
  return found;
}

function asPatterns(value: RegExp | RegExp[] | undefined): RegExp[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

describe("the smoke suite's shells", () => {
  it("selects the desktop shell's tests by tag, never by skipping on the project name", () => {
    const offenders = readdirSync(SMOKE_DIR)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) =>
        /project\.name\s*!==\s*["']desktop-shell["']/.test(readFileSync(join(SMOKE_DIR, file), "utf8"))
      );
    expect(offenders).toEqual([]);
  });

  it("walks only tagged tests on desktop-shell, and none of them on web", () => {
    const [selects] = asPatterns(project("desktop-shell").grep);
    expect(selects, "desktop-shell has no grep").toBeDefined();
    expect(selects.test(DESKTOP_SHELL_TAG)).toBe(true);
    expect(selects.test("@web")).toBe(false);
    expect(selects.test("a walk with no tag")).toBe(false);
    expect(project("desktop-shell").grepInvert).toBeUndefined();

    expect(project("web").grep).toBeUndefined();
    const [excludes] = asPatterns(project("web").grepInvert);
    expect(excludes, "web has no grepInvert").toBeDefined();
    expect(excludes.source).toBe(selects.source);
  });
});
