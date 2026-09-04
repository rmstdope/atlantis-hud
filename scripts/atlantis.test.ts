import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { newAgeDataPage, parseNewAgeDatabase, preformattedText } from "@atlantis/ruleset";
import { describe, expect, it } from "vitest";
import { DATA_URL, RULES_URL, run, type Io } from "./atlantis";
import { dataEntries } from "./atlantisLookup";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");

const RULES_HTML = read("tests/fixtures/ruleset/neworigins-rules.html");
const DATA_HTML = read("tests/fixtures/ruleset/neworigins-data.html");
const RULESET_JSON = read("config/public/ruleset.json");

const RULES_FIXTURE = "tests/fixtures/ruleset/neworigins-rules.html";
const DATA_FIXTURE = "tests/fixtures/ruleset/neworigins-data.html";
const RULESET_PATH = "config/public/ruleset.json";

/** Every committed world's three files, so a lookup naming a world reads a real fixture. */
const ARCANUM_RULES_FIXTURE = "tests/fixtures/ruleset/newage-arcanum-rules.html";
const ARCANUM_DB_FIXTURE = "tests/fixtures/ruleset/newage-arcanum-database.json";
const ARCANUM_RULESET_PATH = "config/public/ruleset-newage-arcanum.json";
const TRIDENT_RULES_FIXTURE = "tests/fixtures/ruleset/newage-trident-rules.html";
const TRIDENT_DB_FIXTURE = "tests/fixtures/ruleset/newage-trident-database.json";
const TRIDENT_RULESET_PATH = "config/public/ruleset-newage-trident.json";

const ARCANUM_RULES_HTML = read(ARCANUM_RULES_FIXTURE);
const ARCANUM_DB = read(ARCANUM_DB_FIXTURE);
const ARCANUM_RULESET_JSON = read(ARCANUM_RULESET_PATH);
const TRIDENT_RULES_HTML = read(TRIDENT_RULES_FIXTURE);
const TRIDENT_DB = read(TRIDENT_DB_FIXTURE);
const TRIDENT_RULESET_JSON = read(TRIDENT_RULESET_PATH);

const ARCANUM_RULES_URL = "https://atlantis-newage.com/api/worlds/arcanum/game/rules";
const ARCANUM_DATA_URL = "https://atlantis-newage.com/api/worlds/arcanum/game/database";
const TRIDENT_RULES_URL = "https://atlantis-newage.com/api/worlds/trident/game/rules";
const TRIDENT_DATA_URL = "https://atlantis-newage.com/api/worlds/trident/game/database";

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
    [RULESET_PATH, RULESET_JSON],
    [ARCANUM_RULES_FIXTURE, ARCANUM_RULES_HTML],
    [ARCANUM_DB_FIXTURE, ARCANUM_DB],
    [ARCANUM_RULESET_PATH, ARCANUM_RULESET_JSON],
    [TRIDENT_RULES_FIXTURE, TRIDENT_RULES_HTML],
    [TRIDENT_DB_FIXTURE, TRIDENT_DB],
    [TRIDENT_RULESET_PATH, TRIDENT_RULESET_JSON]
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
    expect(out[0]).toBe(`# rules/give — New Origins — ${RULES_URL}`);
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

describe("run — a New Age world named on the command line", () => {
  it("answers a rules lookup from the New Age world named on the command line", async () => {
    const { io, out } = fakeIo();

    const code = await run(["newage", "arcanum", "rules", "movement"], io);

    expect(code).toBe(0);
    expect(out[0]).toBe(`# rules/movement — New Age: Arcanum — ${ARCANUM_RULES_URL}`);
  });

  it("refuses newage without a world, naming the worlds that are committed", async () => {
    const { io, err } = fakeIo();

    const code = await run(["newage", "rules", "movement"], io);

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("'rules' is not a New Age world");
    expect(err.join("\n")).toContain("arcanum, trident");
  });

  it("refuses a world before a command that covers every world", async () => {
    // fetchText is left unstubbed, so a run that reached the network would throw rather than pass.
    const { io, err } = fakeIo();

    const code = await run(["newage", "arcanum", "check"], io);

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("pnpm run atlantis check");
  });

  it("prints the command table rather than 'unknown command undefined' for a bare world", async () => {
    const { io, err } = fakeIo();

    const code = await run(["newage", "arcanum"], io);

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("atlantis newage <world> rules <anchor>");
    expect(err.join("\n")).not.toContain("undefined");
  });

  it("answers a data lookup from the named world's database", async () => {
    const entries = dataEntries(preformattedText(newAgeDataPage(parseNewAgeDatabase(ARCANUM_DB))));
    const item = entries.find((entry) => entry.section === "items");
    expect(item).toBeDefined();
    const { io, out } = fakeIo();

    const code = await run(["newage", "arcanum", "data", item!.name], io);

    expect(code).toBe(0);
    expect(out[0].startsWith(`# data/items — ${item!.name}`)).toBe(true);
    expect(out[0].endsWith(`— New Age: Arcanum — ${ARCANUM_DATA_URL}`)).toBe(true);
  });

  it("lists a different number of skills for each New Age world", async () => {
    const arcanum = fakeIo();
    const trident = fakeIo();

    expect(await run(["newage", "arcanum", "data", "--list", "skills"], arcanum.io)).toBe(0);
    expect(await run(["newage", "trident", "data", "--list", "skills"], trident.io)).toBe(0);

    expect(arcanum.out.length).toBeGreaterThan(0);
    expect(arcanum.out.length).not.toBe(trident.out.length);
  });
});

describe("run — the other committed worlds", () => {
  const FOOTER = "# other committed worlds: newage arcanum, newage trident";

  it("tells a plain rules answer which other worlds are committed", async () => {
    const { io, out } = fakeIo();

    await run(["rules", "give"], io);

    expect(out[out.length - 1]).toBe(FOOTER);
  });

  it("tells a plain data answer the same", async () => {
    const { io, out } = fakeIo();

    await run(["data", "mining"], io);

    expect(out[out.length - 1]).toBe(FOOTER);
  });

  it("adds no footer to a New Age answer or to a name list", async () => {
    const newage = fakeIo();
    const rulesList = fakeIo();
    const dataList = fakeIo();

    await run(["newage", "arcanum", "rules", "movement"], newage.io);
    await run(["rules", "--list"], rulesList.io);
    await run(["data", "--list", "items"], dataList.io);

    for (const { out } of [newage, rulesList, dataList]) {
      expect(out.some((line) => line.startsWith("# other committed worlds"))).toBe(false);
    }
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
    expect(out[0]).toBe(`# data/skills — mining [MINI] — New Origins — ${DATA_URL}`);
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
  it("compares every committed world to its own sources", async () => {
    const { io, out } = fakeIo();

    const code = await run(["verify"], io);

    expect(code).toBe(0);
    const printed = out.join("\n");
    for (const world of ["neworigins", "newage-arcanum", "newage-trident"]) {
      expect(printed).toContain(`${world}:`);
    }
    expect(printed.match(/items: \d+ \/ \d+ agree/g)).toHaveLength(3);
    expect(printed).toContain("skills:");
    expect(printed).toContain("buildings:");
    expect(printed).toContain("itemClasses:");
    expect(printed).toContain("ungiveableItems:");
    expect(printed).toContain("terrainResources:");
  });

  it("fails naming the world whose ruleset disagrees", async () => {
    const committed = JSON.parse(TRIDENT_RULESET_JSON);
    const [tag] = Object.keys(committed.items);
    committed.items[tag].weight = 999;
    const { io, out } = fakeIo();
    io.writeFile(TRIDENT_RULESET_PATH, JSON.stringify(committed));

    const code = await run(["verify"], io);

    expect(code).toBe(1);
    const printed = out.join("\n");
    expect(printed).toContain(`items.${tag}`);
    const disagreement = printed.indexOf(`items.${tag}`);
    expect(disagreement).toBeGreaterThan(printed.indexOf("newage-trident:"));
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

/** The committed bytes behind every URL a sweep fetches. */
const COMMITTED_BY_URL = new Map<string, string>([
  [RULES_URL, RULES_HTML],
  [DATA_URL, DATA_HTML],
  [ARCANUM_RULES_URL, ARCANUM_RULES_HTML],
  [ARCANUM_DATA_URL, ARCANUM_DB],
  [TRIDENT_RULES_URL, TRIDENT_RULES_HTML],
  [TRIDENT_DATA_URL, TRIDENT_DB]
]);

const servingCommitted = async (url: string): Promise<string> => {
  const committed = COMMITTED_BY_URL.get(url);
  if (committed === undefined) {
    throw new Error(`no fixture for ${url}`);
  }
  return committed;
};

describe("run — check", () => {
  it("reports every committed world's two sources as unchanged", async () => {
    const { io, out } = fakeIo({ fetchText: servingCommitted });

    const code = await run(["check"], io);

    expect(code).toBe(0);
    expect(out).toEqual([
      "neworigins: rules page unchanged, data page unchanged",
      "newage-arcanum: rules page unchanged, database unchanged",
      "newage-trident: rules page unchanged, database unchanged"
    ]);
  });

  it("names the world whose source moved", async () => {
    const { io, out } = fakeIo({
      fetchText: async (url) =>
        url === TRIDENT_RULES_URL ? `${TRIDENT_RULES_HTML}<!-- moved -->` : servingCommitted(url)
    });

    const code = await run(["check"], io);

    expect(code).toBe(1);
    expect(out).toEqual([
      "neworigins: rules page unchanged, data page unchanged",
      "newage-arcanum: rules page unchanged, database unchanged",
      "newage-trident: rules page changed, database unchanged"
    ]);
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
  it("rewrites nothing when one world's page no longer scrapes", async () => {
    const { io, err, files } = fakeIo({
      fetchText: servingCommitted,
      scrape: (args) => {
        if (args.some((arg) => arg.includes("newage-trident"))) {
          throw new Error("ruleset scrape failed: the SAIL section no longer says what we need");
        }
      }
    });

    const code = await run(["refresh"], io);

    expect(code).toBe(3);
    for (const [path, contents] of [
      [RULES_FIXTURE, RULES_HTML],
      [DATA_FIXTURE, DATA_HTML],
      [RULESET_PATH, RULESET_JSON],
      [ARCANUM_RULES_FIXTURE, ARCANUM_RULES_HTML],
      [ARCANUM_DB_FIXTURE, ARCANUM_DB],
      [ARCANUM_RULESET_PATH, ARCANUM_RULESET_JSON],
      [TRIDENT_RULES_FIXTURE, TRIDENT_RULES_HTML],
      [TRIDENT_DB_FIXTURE, TRIDENT_DB],
      [TRIDENT_RULESET_PATH, TRIDENT_RULESET_JSON]
    ] as const) {
      expect(files.get(path)).toBe(contents);
    }
    expect(err.join("\n")).toContain("newage-trident");
  });

  it("rewrites every world's sources once all three scrape", async () => {
    // Every source is served with a marker appended, so a fixture still holding the committed
    // bytes is a write that did not happen rather than a page that did not move.
    const moved = (text: string) => `${text}<!-- moved -->`;
    const { io, files } = fakeIo({
      fetchText: async (url) => moved(await servingCommitted(url)),
      scrape: () => {}
    });

    const code = await run(["refresh"], io);

    expect(code).toBe(0);
    for (const [path, committed] of [
      [RULES_FIXTURE, RULES_HTML],
      [DATA_FIXTURE, DATA_HTML],
      [ARCANUM_RULES_FIXTURE, ARCANUM_RULES_HTML],
      [ARCANUM_DB_FIXTURE, ARCANUM_DB],
      [TRIDENT_RULES_FIXTURE, TRIDENT_RULES_HTML],
      [TRIDENT_DB_FIXTURE, TRIDENT_DB]
    ] as const) {
      expect(files.get(path)).toBe(moved(committed));
    }
  });

  it("reports the changed fields after a successful refresh", async () => {
    const { io, out, files } = fakeIo({
      fetchText: servingCommitted,
      scrape: (args) => {
        if (args.includes(RULESET_PATH)) {
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
      fetchText: servingCommitted,
      scrape: (args) => {
        if (args.includes(RULESET_PATH)) {
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

  it("reports an unchanged outcome when no world's sources moved", async () => {
    const { io, out } = fakeIo({ fetchText: servingCommitted, scrape: () => {} });

    const code = await run(["refresh", "--json"], io);

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toEqual({ kind: "unchanged" });
  });

  it("reports the outcome per world as JSON", async () => {
    const CHANGED_RULES_HTML = RULES_HTML.replace(
      "Last Change: Jun 20, 2025",
      "Last Change: Jul 1, 2026"
    );
    const { io, out, files } = fakeIo({
      fetchText: async (url) => (url === RULES_URL ? CHANGED_RULES_HTML : servingCommitted(url)),
      scrape: (args) => {
        if (args.includes(RULESET_PATH)) {
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
    expect(outcome.worlds).toHaveLength(1);
    expect(outcome.worlds[0].world).toBe("neworigins");
    expect(outcome.worlds[0].changedSources).toEqual(["rules"]);
    expect(outcome.worlds[0].rulesetChanges.join("\n")).toContain("items.SWOR.weight");
  });

  it("names the world in the scrape-failed JSON", async () => {
    const { io, out } = fakeIo({
      fetchText: servingCommitted,
      scrape: (args) => {
        if (args.some((arg) => arg.includes("newage-arcanum"))) {
          throw new Error("ruleset scrape failed: the SAIL section no longer says what we need");
        }
      }
    });

    const code = await run(["refresh", "--json"], io);

    expect(code).toBe(3);
    expect(JSON.parse(out[0])).toEqual({
      kind: "scrape-failed",
      world: "newage-arcanum",
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
