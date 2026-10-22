import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { moduleScripts, servesBuild } from "./servedBuild";

/** The head of a built index.html, as Vite writes it. */
function page(entry: string): string {
  return `<!doctype html><html><head>
    <script type="module" crossorigin src="/assets/${entry}.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/${entry}.css">
  <link rel="manifest" href="/manifest.webmanifest"></head><body><div id="root"></div></body></html>`;
}

describe("which build a page is", () => {
  it("lists the module scripts a page loads", () => {
    expect(moduleScripts(page("index-fArWhhC0"))).toEqual(["/assets/index-fArWhhC0.js"]);
  });

  it("ignores classic and inline scripts", () => {
    expect(moduleScripts('<script src="/a.js"></script><script type="module">x()</script>')).toEqual([]);
  });

  it("passes a page that loads this build's entry script", () => {
    expect(servesBuild(page("index-fArWhhC0"), page("index-fArWhhC0"))).toEqual({ ok: true });
  });

  it("fails a page from an older build and names the script it lacks", () => {
    expect(servesBuild(page("index-OLD00000"), page("index-fArWhhC0"))).toEqual({
      ok: false,
      message: "The page served is not this build - it does not load /assets/index-fArWhhC0.js."
    });
  });

  it("fails rather than passing vacuously when the build has no entry script", () => {
    expect(servesBuild(page("index-a"), "<html></html>").ok).toBe(false);
  });
});

describe("the build check as the workflow runs it", () => {
  const run = promisify(execFile);
  const script = fileURLToPath(new URL("./servedBuild.ts", import.meta.url));
  const root = fileURLToPath(new URL("..", import.meta.url));
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function runCli(served: string, built: string): Promise<{ code: number; out: string }> {
    dir = mkdtempSync(join(tmpdir(), "served-build-"));
    writeFileSync(join(dir, "page.html"), served);
    writeFileSync(join(dir, "index.html"), built);
    try {
      const { stdout } = await run("pnpm", ["exec", "tsx", script, join(dir, "page.html"), join(dir, "index.html")], {
        cwd: root
      });
      return { code: 0, out: stdout };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string };
      return { code: failure.code ?? 1, out: failure.stdout ?? "" };
    }
  }

  it("exits 0 on this build", async () => {
    expect(await runCli(page("index-x"), page("index-x"))).toEqual({ code: 0, out: "" });
  }, 20_000);

  it("exits 1 with an ::error:: line on another build", async () => {
    const { code, out } = await runCli(page("index-old"), page("index-new"));
    expect(code).toBe(1);
    expect(out).toContain("::error::The page served is not this build");
  }, 20_000);
});
