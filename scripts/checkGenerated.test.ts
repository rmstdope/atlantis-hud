import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  compareTrees,
  describeDivergence,
  describeUncommitted,
  EXPORT_DIR,
  exportCommand,
  GENERATED_DIRS,
  readTree,
  REGENERATE,
  uncommittedFiles
} from "./checkGenerated";

describe("uncommittedFiles", () => {
  it("names each path git reports as changed or new under the generated directory", () => {
    const porcelain =
      " M packages/core-client/src/generated/Battle.ts\n?? packages/core-client/src/generated/New.ts\n";

    expect(uncommittedFiles(porcelain)).toEqual([
      "packages/core-client/src/generated/Battle.ts",
      "packages/core-client/src/generated/New.ts"
    ]);
  });

  it("names nothing when git reports a clean tree", () => {
    expect(uncommittedFiles("")).toEqual([]);
  });
});

describe("GENERATED_DIRS", () => {
  it("covers both generated directories, so the ruleset schema is checked too", () => {
    expect(GENERATED_DIRS).toEqual([
      "packages/core-client/src/generated",
      "packages/ruleset/src/generated"
    ]);
  });
});

describe("compareTrees", () => {
  it("names a file whose contents differ from the fresh export", () => {
    expect(compareTrees(new Map([["a/X.ts", "fresh"]]), new Map([["a/X.ts", "old"]]))).toEqual([
      { path: "a/X.ts", reason: "differs" }
    ]);
  });

  it("names a file the fresh export produced and the working tree has not", () => {
    expect(compareTrees(new Map([["a/X.ts", "fresh"]]), new Map())).toEqual([
      { path: "a/X.ts", reason: "missing" }
    ]);
  });

  it("names a file the working tree has and the fresh export did not produce", () => {
    expect(compareTrees(new Map(), new Map([["a/X.ts", "old"]]))).toEqual([
      { path: "a/X.ts", reason: "unexpected" }
    ]);
  });

  it("names nothing when the two trees are identical", () => {
    const contents = new Map([
      ["a/X.ts", "same"],
      ["a/Y.ts", "also same"]
    ]);

    expect(compareTrees(contents, new Map(contents))).toEqual([]);
  });

  it("sorts divergences by path, so the failure text is stable", () => {
    const fresh = new Map([
      ["a/C.ts", "fresh"],
      ["a/A.ts", "fresh"],
      ["a/B.ts", "fresh"]
    ]);

    expect(compareTrees(fresh, new Map()).map((divergence) => divergence.path)).toEqual([
      "a/A.ts",
      "a/B.ts",
      "a/C.ts"
    ]);
  });
});

describe("readTree", () => {
  const fixtures: string[] = [];

  /** A tree with the two generated directories under it, each holding the files named. */
  function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "check-generated-"));
    fixtures.push(root);
    for (const [path, contents] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, contents);
    }
    return root;
  }

  afterAll(() => {
    for (const root of fixtures) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keys every .ts file by its repository-relative path", () => {
    const root = fixture({
      "packages/core-client/src/generated/X.ts": "export type X = string;\n",
      "packages/ruleset/src/generated/Y.ts": "export type Y = number;\n"
    });

    expect([...readTree(root, GENERATED_DIRS).entries()]).toEqual([
      ["packages/core-client/src/generated/X.ts", "export type X = string;\n"],
      ["packages/ruleset/src/generated/Y.ts", "export type Y = number;\n"]
    ]);
  });

  it("ignores anything that is not a .ts file", () => {
    const root = fixture({
      "packages/core-client/src/generated/X.ts": "export type X = string;\n",
      "packages/core-client/src/generated/tsconfig.json": "{}\n",
      "packages/core-client/src/generated/.DS_Store": "junk",
      "packages/ruleset/src/generated/Y.ts": "export type Y = number;\n"
    });

    expect([...readTree(root, GENERATED_DIRS).keys()]).toEqual([
      "packages/core-client/src/generated/X.ts",
      "packages/ruleset/src/generated/Y.ts"
    ]);
  });

  it("contributes nothing for a directory that is not there", () => {
    const root = fixture({
      "packages/core-client/src/generated/X.ts": "export type X = string;\n"
    });

    expect([...readTree(root, GENERATED_DIRS).keys()]).toEqual([
      "packages/core-client/src/generated/X.ts"
    ]);
  });
});

describe("describeDivergence", () => {
  it("lists each divergence with its reason and names the regenerate command", () => {
    expect(
      describeDivergence([
        { path: "packages/core-client/src/generated/UnitSilver.ts", reason: "differs" },
        { path: "packages/ruleset/src/generated/Gap.ts", reason: "missing" }
      ])
    ).toBe(
      "generated TypeScript bindings differ from the Rust types:\n" +
        "  packages/core-client/src/generated/UnitSilver.ts (differs)\n" +
        "  packages/ruleset/src/generated/Gap.ts (missing)\n" +
        "regenerate them with:\n" +
        "  cargo test -p atlantis-hud-core --lib export_bindings_\n"
    );
  });
});

describe("describeUncommitted", () => {
  it("says nothing when nothing is uncommitted", () => {
    expect(describeUncommitted([])).toBe("");
  });

  it("uses the singular for one uncommitted binding", () => {
    expect(describeUncommitted(["packages/core-client/src/generated/UnitSilver.ts"])).toBe(
      "generated bindings match the Rust types.\n" +
        "\n" +
        "1 is not committed yet:\n" +
        "  packages/core-client/src/generated/UnitSilver.ts\n" +
        "commit it before opening the PR - CI checks the committed files, and will fail if you do not.\n"
    );
  });

  it("uses the plural for more than one", () => {
    expect(
      describeUncommitted([
        "packages/core-client/src/generated/UnitSilver.ts",
        "packages/ruleset/src/generated/Gap.ts"
      ])
    ).toBe(
      "generated bindings match the Rust types.\n" +
        "\n" +
        "2 are not committed yet:\n" +
        "  packages/core-client/src/generated/UnitSilver.ts\n" +
        "  packages/ruleset/src/generated/Gap.ts\n" +
        "commit them before opening the PR - CI checks the committed files, and will fail if you do not.\n"
    );
  });
});

describe("exportCommand", () => {
  it("points TS_RS_EXPORT_DIR at the temporary tree, mirroring the real export directory", () => {
    // The one fact the whole design rests on. Get the depth wrong and the ruleset types, whose
    // `export_to` climbs three levels out of it, land outside the temporary tree and read as
    // `missing` for ever.
    expect(exportCommand("/tmp/x").env.TS_RS_EXPORT_DIR).toBe(join("/tmp/x", EXPORT_DIR));
  });

  it("runs only the ts-rs export tests", () => {
    const { command, args } = exportCommand("/tmp/x");

    expect(command).toBe("cargo");
    expect(args).toEqual(["test", "-p", "atlantis-hud-core", "--lib", "export_bindings_"]);
  });

  it("tells the reader to run exactly what it runs itself", () => {
    const { command, args } = exportCommand("/tmp/x");

    expect(REGENERATE).toBe([command, ...args].join(" "));
  });
});

/**
 * `EXPORT_DIR` cannot drift from `.cargo/config.toml`, and that entry cannot gain `force`.
 *
 * A drift guard over a file that is already right, so it is green the moment it is written - the
 * same kind of test as `scripts/generatedBindingsGate.test.ts`. It was proved able to fail rather
 * than started from red: with `EXPORT_DIR` temporarily set to `packages/core-client/src/wrong` the
 * first case failed naming both values, and with `force = true` temporarily added to the config
 * line the second failed; both were then put back.
 *
 * The root is computed from this file rather than through `repositoryRoot()`, which answers the
 * *main checkout's* root from inside a worktree (see its doc comment, and ah-gdp) - that would ask
 * this question of the wrong tree.
 */
describe("EXPORT_DIR", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const config = readFileSync(join(root, ".cargo", "config.toml"), "utf8");
  const entry = config.match(/^\s*TS_RS_EXPORT_DIR\s*=\s*\{([^}]*)\}/mu);

  it("is the directory .cargo/config.toml points TS_RS_EXPORT_DIR at", () => {
    // Thrown rather than expected: `not.toBeNull()` does not stop the test, so a null would reach
    // the match below and fail there instead, with a message about the wrong thing.
    if (entry === null) {
      throw new Error("the cargo config sets no TS_RS_EXPORT_DIR table at all");
    }
    const value = entry[1].match(/value\s*=\s*"([^"]*)"/u);
    if (value === null) {
      throw new Error(`the TS_RS_EXPORT_DIR table names no value: {${entry[1]}}`);
    }

    expect(value[1]).toBe(EXPORT_DIR);
  });

  it("refuses a forced TS_RS_EXPORT_DIR, which would stop the gate ever failing", () => {
    if (entry === null) {
      throw new Error("the cargo config sets no TS_RS_EXPORT_DIR table at all");
    }

    // With `force`, cargo would override the value this gate passes in, ts-rs would write into the
    // real directories, and the comparison would be the working tree against itself - passing for
    // ever, silently.
    expect(entry[1]).not.toContain("force");
  });
});
