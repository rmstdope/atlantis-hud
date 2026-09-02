import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DATA_URL, RULES_URL, run, type Io } from "./atlantis";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");

const RULES_HTML = read("tests/fixtures/ruleset/neworigins-rules.html");
const DATA_HTML = read("tests/fixtures/ruleset/neworigins-data.html");
const RULESET_JSON = read("config/public/ruleset.json");

const RULES_FIXTURE = "tests/fixtures/ruleset/neworigins-rules.html";
const DATA_FIXTURE = "tests/fixtures/ruleset/neworigins-data.html";
const RULESET_PATH = "config/public/ruleset.json";

/**
 * A fake `Io` backed by an in-memory file map, so a test can see exactly what was and was not
 * written without touching the real filesystem. `readFile` throws like `node:fs` would for a path
 * that was never seeded, so a test that expects a read to fail can tell that apart from an empty
 * file.
 */
function fakeIo(overrides: Partial<Io> = {}): {
  io: Io;
  out: string[];
  err: string[];
  files: Map<string, string>;
} {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>([
    [RULES_FIXTURE, RULES_HTML],
    [DATA_FIXTURE, DATA_HTML],
    [RULESET_PATH, RULESET_JSON]
  ]);

  const io: Io = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    readFile: (path) => {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return content;
    },
    writeFile: (path, contents) => {
      files.set(path, contents);
    },
    fetchText: async () => {
      throw new Error("fetchText not stubbed for this test");
    },
    scrape: () => {
      throw new Error("scrape not stubbed for this test");
    },
    ...overrides
  };

  return { io, out, err, files };
}

describe("run — rules", () => {
  it("prints the section under a provenance header", async () => {
    const { io, out } = fakeIo();

    const code = await run(["rules", "give"], io);

    expect(code).toBe(0);
    expect(out[0]).toBe(`# rules/give — ${RULES_URL}`);
    expect(out[1]).toContain("NewOrigins v8.0.0");
    expect(out[1]).toContain("committed snapshot");
    expect(out.join("\n")).toContain("GIVE");
  });

  it("exits 1 and suggests a name for an unknown anchor", async () => {
    const { io, err } = fakeIo();

    const code = await run(["rules", "giv"], io);

    expect(code).toBe(1);
    expect(err.join("\n")).toBe(
      [
        "no anchor named 'giv' on the rules page.",
        "",
        "Closest matches:  give",
        "All 129 names:    pnpm run atlantis rules --list",
        'Search the text:  pnpm run atlantis rules --search "giv"'
      ].join("\n")
    );
  });

  it("strips a single leading -- from argv, so a habit picked up elsewhere still works", async () => {
    const { io, out } = fakeIo();

    const code = await run(["--", "rules", "--list"], io);

    expect(code).toBe(0);
    expect(out).toHaveLength(129);
  });
});

describe("run — data", () => {
  it("exits 1 and says the game has no such thing", async () => {
    // Not 'catapult' - the plan's own illustrative example, but the data page has a real
    // catapult item (tag CATP, priced in the carpenter's recipes per committed.test.ts). Using a
    // name that is actually on the page would make this test assert the wrong outcome, so it uses
    // a name that is genuinely absent instead; the message format is what is under test.
    const { io, err } = fakeIo();

    const code = await run(["data", "gryphonrider9000"], io);

    expect(code).toBe(1);
    expect(err.join("\n")).toBe(
      [
        "nothing on the data page matches 'gryphonrider9000'.",
        "",
        "The data page has 480 skill levels, 171 items and 60 objects.",
        "List them:  pnpm run atlantis data --list items",
        "",
        "This is an answer: the game has no such thing. Do not assume it exists",
        "because you remember one."
      ].join("\n")
    );
  });

  it("prints the full entry under a provenance header when the term names one skill", async () => {
    const { io, out } = fakeIo();

    const code = await run(["data", "MINI"], io);

    expect(code).toBe(0);
    expect(out[0]).toBe(`# data/skills — mining [MINI] — ${DATA_URL}`);
    expect(out.join("\n")).toContain("levels 2, 4: no skill report");
  });

  it("indexes rather than dumps when the term spans several names", async () => {
    const { io, out } = fakeIo();

    const code = await run(["data", "sword"], io);

    expect(code).toBe(0);
    // one header line, one provenance line, then one line per distinct name
    expect(out.length).toBeGreaterThan(3);
  });
});

describe("run — verify", () => {
  it("agrees with the committed ruleset today", async () => {
    const { io, out } = fakeIo();

    const code = await run(["verify"], io);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("items:");
    expect(out.join("\n")).toContain("skills:");
    expect(out.join("\n")).toContain("buildings:");
    expect(out.join("\n")).toContain("itemClasses:");
    expect(out.join("\n")).toContain("ungiveableItems:");
  });

  it("names the field when the ruleset disagrees", async () => {
    const committed = JSON.parse(RULESET_JSON);
    committed.items.SWOR.weight = 999;
    const { io, out } = fakeIo();
    io.writeFile(RULESET_PATH, JSON.stringify(committed));

    const code = await run(["verify"], io);

    expect(code).toBe(1);
    const printed = out.join("\n");
    expect(printed).toContain("items.SWOR");
    expect(printed).toContain("999");
    expect(printed).toContain("pnpm run atlantis refresh");
  });

  it("distinguishes a stale overridden maintenance value", async () => {
    const committed = JSON.parse(RULESET_JSON);
    committed.items.GRAI.maintenanceValue = 30;
    const { io, out } = fakeIo();
    io.writeFile(RULESET_PATH, JSON.stringify(committed));

    const code = await run(["verify"], io);

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("items.GRAI");
    expect(out.join("\n")).toContain('"maintenanceValue":30');
    expect(out.join("\n")).toContain('"maintenanceValue":50');
  });

  it("names race skill limit drift", async () => {
    const committed = JSON.parse(RULESET_JSON);
    committed.items.HUMN.skillLimits.defaultLevel = 999;
    const { io, out } = fakeIo();
    io.writeFile(RULESET_PATH, JSON.stringify(committed));

    const code = await run(["verify"], io);

    expect(code).toBe(1);
    const printed = out.join("\n");
    expect(printed).toContain("items.HUMN");
    expect(printed).toContain("999");
    expect(printed).toContain("2");
  });

  it("names the class when itemClasses disagrees", async () => {
    const committed = JSON.parse(RULESET_JSON);
    committed.itemClasses.ARMOR = ["NOTREAL"];
    const { io, out } = fakeIo();
    io.writeFile(RULESET_PATH, JSON.stringify(committed));

    const code = await run(["verify"], io);

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("itemClasses.ARMOR");
  });
});

describe("run — check", () => {
  it("reports both pages as unchanged when the fetched bytes match the committed ones", async () => {
    const { io, out } = fakeIo({
      fetchText: async (url) => (url === RULES_URL ? RULES_HTML : DATA_HTML)
    });

    const code = await run(["check"], io);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("unchanged");
  });

  it("exits 2 when the site cannot be reached", async () => {
    const { io, err } = fakeIo({
      fetchText: async () => {
        throw new Error("getaddrinfo ENOTFOUND atlantis-pbem.com");
      }
    });

    const code = await run(["check"], io);

    expect(code).toBe(2);
    expect(err.join("\n")).toContain("ENOTFOUND");
  });
});

describe("run — refresh", () => {
  it("reports the changed fields after a successful refresh", async () => {
    // The real scraper writes config/public/ruleset.json itself; this stub reproduces that on the
    // canonical (second, --out-less) call, so the diff-reporting path - the one branch the rest of
    // this suite's refresh tests never exercise - runs against a real before/after pair.
    const { io, out, files } = fakeIo({
      fetchText: async (url) => (url === RULES_URL ? RULES_HTML : DATA_HTML),
      scrape: (args) => {
        if (!args.includes("--out")) {
          const modified = JSON.parse(RULESET_JSON);
          modified.items.SWOR.weight = 2;
          files.set(RULESET_PATH, JSON.stringify(modified));
        }
      }
    });

    const code = await run(["refresh"], io);

    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("items.SWOR.weight: 1 → 2");
    expect(printed).toContain("1 changes. Review them before committing");
    expect(files.get(RULES_FIXTURE)).toBe(RULES_HTML);
    expect(files.get(DATA_FIXTURE)).toBe(DATA_HTML);
  });

  it("changes nothing on disk when the scrape throws", async () => {
    const { io, files } = fakeIo({
      fetchText: async (url) => (url === RULES_URL ? RULES_HTML : DATA_HTML),
      scrape: () => {
        throw new Error("ruleset scrape failed: the SAIL section no longer says what we need");
      }
    });

    const code = await run(["refresh"], io);

    expect(code).toBe(3);
    expect(files.get(RULES_FIXTURE)).toBe(RULES_HTML);
    expect(files.get(DATA_FIXTURE)).toBe(DATA_HTML);
    expect(files.get(RULESET_PATH)).toBe(RULESET_JSON);
  });

  it("exits 2 when the site cannot be reached", async () => {
    const { io, err } = fakeIo({
      fetchText: async () => {
        throw new Error("getaddrinfo ENOTFOUND atlantis-pbem.com");
      }
    });

    const code = await run(["refresh"], io);

    expect(code).toBe(2);
    expect(err.join("\n")).toContain("ENOTFOUND");
  });
});

describe("run — refresh --json", () => {
  it("prints the outcome as one JSON object and nothing else", async () => {
    const { io, out, files } = fakeIo({
      fetchText: async (url) => (url === RULES_URL ? RULES_HTML : DATA_HTML),
      scrape: (args) => {
        if (!args.includes("--out")) {
          const modified = JSON.parse(RULESET_JSON);
          modified.items.SWOR.weight = 2;
          files.set(RULESET_PATH, JSON.stringify(modified));
        }
      }
    });

    const code = await run(["refresh", "--json"], io);

    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(() => JSON.parse(out[0])).not.toThrow();
  });

  it("reports an unchanged outcome when neither page's bytes moved", async () => {
    const { io, out } = fakeIo({
      fetchText: async (url) => (url === RULES_URL ? RULES_HTML : DATA_HTML),
      scrape: () => {
        // The canonical scrape writes nothing here; the fake Io's ruleset file therefore stays
        // byte-identical, which is what a real, unchanged page would also produce.
      }
    });

    const code = await run(["refresh", "--json"], io);

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toEqual({ kind: "unchanged" });
  });

  it("reports a refreshed outcome naming the page that moved and the ruleset diff", async () => {
    const CHANGED_RULES_HTML = RULES_HTML.replace("Last Change: Jun 20, 2025", "Last Change: Jul 1, 2026");
    const { io, out, files } = fakeIo({
      fetchText: async (url) => (url === RULES_URL ? CHANGED_RULES_HTML : DATA_HTML),
      scrape: (args) => {
        if (!args.includes("--out")) {
          const modified = JSON.parse(RULESET_JSON);
          modified.items.SWOR.weight = 2;
          files.set(RULESET_PATH, JSON.stringify(modified));
        }
      }
    });

    const code = await run(["refresh", "--json"], io);

    expect(code).toBe(0);
    const outcome = JSON.parse(out[0]);
    expect(outcome.kind).toBe("refreshed");
    expect(outcome.changedPages).toEqual(["rules"]);
    expect(outcome.rulesetChanges.join("\n")).toContain("items.SWOR.weight");
  });

  it("keeps the same exit code as the prose form when the scrape refuses", async () => {
    const { io, out } = fakeIo({
      fetchText: async (url) => (url === RULES_URL ? RULES_HTML : DATA_HTML),
      scrape: () => {
        throw new Error("ruleset scrape failed: the SAIL section no longer says what we need");
      }
    });

    const code = await run(["refresh", "--json"], io);

    expect(code).toBe(3);
    expect(JSON.parse(out[0])).toEqual({
      kind: "scrape-failed",
      message: "ruleset scrape failed: the SAIL section no longer says what we need"
    });
  });

  it("keeps the same exit code as the prose form when the site cannot be reached", async () => {
    const { io, err, out } = fakeIo({
      fetchText: async () => {
        throw new Error("getaddrinfo ENOTFOUND atlantis-pbem.com");
      }
    });

    const code = await run(["refresh", "--json"], io);

    expect(code).toBe(2);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("ENOTFOUND");
  });
});

describe("run — help", () => {
  it("prints the command table with no args", async () => {
    const { io, out } = fakeIo();

    const code = await run([], io);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("atlantis rules");
    expect(out.join("\n")).toContain("atlantis data");
    expect(out.join("\n")).toContain("atlantis verify");
  });
});
