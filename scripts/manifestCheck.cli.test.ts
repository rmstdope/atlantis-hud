import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { MANIFEST_PATH } from "./manifestCheck";

const run = promisify(execFile);
const script = fileURLToPath(new URL("./manifestCheck.ts", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * The entry point, run as the deploy workflow runs it.
 *
 * Every other test imports the module; none of them executes it, and a review found that the CLI
 * block could not run at all - `tsx` transforms `scripts/` as CJS, so a top-level `await` there is a
 * transform error and the deploy step would have failed on every release. This suite is what makes
 * that visible.
 */
async function runCli(site: string): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await run("pnpm", ["exec", "tsx", script, site], { cwd: root });
    return { code: 0, out: stdout };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

describe("the manifest check as the workflow runs it", () => {
  let server: Server;
  let base: string;

  async function start(throttled: number): Promise<void> {
    let seen = 0;
    server = createServer((request, response) => {
      if (request.url !== `/${MANIFEST_PATH}`) {
        response.writeHead(404);
        response.end("not the manifest");
        return;
      }
      seen += 1;
      if (seen <= throttled) {
        response.writeHead(429, { "retry-after": "5" });
        response.end("throttled");
        return;
      }
      response.writeHead(200, { "content-type": "application/manifest+json" });
      response.end("{}");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });

  it("exits 0 on a manifest that is served", async () => {
    await start(0);
    const { code, out } = await runCli(base);
    expect(code).toBe(0);
    expect(out).not.toContain("::error::");
  });

  it("exits 1 and names the status when the manifest is never served", async () => {
    await start(0);
    const { code, out } = await runCli(`${base}/elsewhere`);
    expect(code).toBe(1);
    expect(out).toContain("::error::The manifest returned 404.");
  });

  it("refuses to run without a site root", async () => {
    const { code, out } = await runCli("");
    expect(code).toBe(1);
    expect(out).toContain("::error::Usage:");
  }, 20_000);
}, 60_000);
