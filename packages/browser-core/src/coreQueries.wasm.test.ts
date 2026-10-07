import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORE_QUERIES } from "@atlantis/core-client";
import { readRuleset } from "@atlantis/fixtures";
import type { CoreWasmModule } from "./webCoreAdapter";

/**
 * The browser half of the query lockstep (ah-w83n), against the real WebAssembly core rather than
 * a stand-in: every query the core declares is answered by the module's one `query` export. The
 * desktop half is `tauri_adapter_answers_every_declared_query` in core-tauri, and over real IPC the
 * native binding spec; both read the same declaration this file reads through `CORE_QUERIES`.
 */
async function realCore(): Promise<CoreWasmModule> {
  const wasm = await import("./wasm/atlantis_core.js");
  // The `--target web` glue fetches the payload relative to its own URL, which Node cannot do, so
  // the bytes are handed over directly.
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as CoreWasmModule;
}

/** What the module throws, as text: wasm-bindgen rejects with the Rust error string itself. */
function refusal(ask: () => unknown): string | null {
  try {
    ask();
    return null;
  } catch (error) {
    return String(error);
  }
}

describe("the core's declared queries, across the WebAssembly boundary", () => {
  it("answers every declared query through the one query export", async () => {
    const wasm = await realCore();

    for (const name of Object.values(CORE_QUERIES)) {
      // An empty argument list is answered by a query that takes none and refused *as arguments* by
      // every other - both mean the name reached the core and was found there. Anything else (an
      // unknown name, a missing export) is the web lacking a query the core declares.
      const refused = refusal(() => wasm.query(name, []));
      if (refused !== null) {
        expect(refused, name).toMatch(/^arguments could not be read: /u);
      }
    }
  });

  it("refuses a query nobody declared, by name", async () => {
    const wasm = await realCore();

    expect(refusal(() => wasm.query("no_such_query", []))).toBe(
      'unknown core query "no_such_query"'
    );
  });

  /** The desktop refuses a stray argument too, so neither shell answers a call the other refuses. */
  it("refuses more arguments than a query declares, as the desktop does", async () => {
    const wasm = await realCore();

    expect(refusal(() => wasm.query("shelter_seats", ["Foo (1) Report\n", readRuleset(), "extra"])))
      .toMatch(/^arguments could not be read: /u);
  });

  it("delivers a declared query's answer with its field names intact", async () => {
    const wasm = await realCore();
    const report = [
      "Foo (1) Report",
      "",
      "plain (1,1) in Coast, 10 peasants (orcs), $5.",
      "",
      "Exits:",
      "  North : plain (1,-1) in Coast.",
      "",
      "+ Keep [1] : Citadel.",
      "+ Ark [2] : Galleon.",
      ""
    ].join("\n");

    const seats = wasm.query("shelter_seats", [report, readRuleset()]) as Array<{
      structureId: string;
      seats: number | null;
    }>;

    expect(seats.map(({ structureId, seats: count }) => [structureId, count])).toEqual([
      ["1", 3],
      ["2", 1]
    ]);
  });
});
