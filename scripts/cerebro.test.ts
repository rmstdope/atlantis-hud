import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CEREBRO_MOUNT, cerebroScript } from "./cerebro";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The path `.gitmodules` gives the submodule whose url is cerebro's. `.gitmodules` is tracked, so
 * this holds in CI's checkout too, where the submodule itself is not fetched.
 */
function cerebroSubmodulePath(): string | undefined {
  const sections = readFileSync(join(REPO, ".gitmodules"), "utf8").split(/^\[submodule /m);
  for (const section of sections) {
    const url = /^\s*url\s*=\s*(\S+)/m.exec(section)?.[1];
    if (url !== undefined && /\/cerebro(\.git)?$/.test(url)) {
      return /^\s*path\s*=\s*(\S+)/m.exec(section)?.[1];
    }
  }
  return undefined;
}

describe("the cerebro mount (ah-r5hr)", () => {
  it("is the path .gitmodules gives cerebro's submodule - moving it is one change, and this catches the other", () => {
    expect(CEREBRO_MOUNT).toBe(cerebroSubmodulePath());
  });

  it("resolves a cerebro script under the repository root", () => {
    expect(cerebroScript("disk-preflight")).toBe(join(REPO, CEREBRO_MOUNT, "scripts", "disk-preflight"));
  });

  it("is spelled nowhere else in the consumer's scripts, package.json files or settings hooks", () => {
    // git grep exits 1 when nothing matches, which is the passing case.
    const run = spawnSync(
      "git",
      [
        "grep",
        "-lE",
        'cerebro/scripts|"cerebro",[[:space:]]*"scripts"',
        "--",
        "scripts/**",
        "**/package.json",
        ".claude/settings.json",
        ":!scripts/cerebro.ts",
        ":!scripts/cerebro.test.ts"
      ],
      { cwd: REPO, encoding: "utf8" }
    );
    expect(run.status, run.stderr).toBe(1);
    expect(run.stdout.trim().split("\n").filter(Boolean), "reach cerebro through scripts/cerebro.ts instead").toEqual([]);
  });
});

describe("tsx scripts/cerebro.ts <script>", () => {
  it("says a script that cannot start could not start, and exits 127", () => {
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", join(REPO, "scripts", "cerebro.ts"), "no-such-script"],
      { cwd: REPO, encoding: "utf8" }
    );
    expect(run.status).toBe(127);
    expect(run.stderr).toContain("cerebro: no-such-script could not start");
    expect(run.stderr).toContain("git submodule update --init --recursive");
  });
});
