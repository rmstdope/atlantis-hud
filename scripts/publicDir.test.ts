import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Top-level names the web host's Apache maps to its own content, measured against the live host. */
const RESERVED_BY_HOST = ["icons", "cgi-bin"] as const;

const publicDir = fileURLToPath(new URL("../config/public", import.meta.url));
const viteConfig = fileURLToPath(new URL("../apps/web/vite.config.ts", import.meta.url));

function isReserved(name: string): boolean {
  return (RESERVED_BY_HOST as readonly string[]).includes(name);
}

describe("what the web build publishes", () => {
  it("publishes nothing under a path the web host reserves", () => {
    const reserved = readdirSync(publicDir).filter(isReserved);
    expect(reserved).toEqual([]);
  });

  it("every icon the web manifest names is a committed file outside a reserved path", () => {
    const text = readFileSync(viteConfig, "utf8");
    const sources = [...text.matchAll(/src: "([^"]+)"/g)].map((match) => match[1] as string);
    expect(sources).toHaveLength(3);
    for (const src of sources) {
      expect(existsSync(join(publicDir, src)), src).toBe(true);
      expect(isReserved(src.split("/")[0] as string), src).toBe(false);
    }
  });
});
