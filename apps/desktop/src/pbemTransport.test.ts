import { describe, expect, it, vi } from "vitest";
import type { HttpRequest } from "@atlantis/shared";
import type { DesktopPlugins } from "./desktopPlugins";
import { desktopPbemTransport } from "./pbemTransport";

function pluginsWith(httpRequest: DesktopPlugins["httpRequest"]): DesktopPlugins {
  return {
    save: vi.fn().mockResolvedValue(null),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    httpRequest
  };
}

describe("desktopPbemTransport", () => {
  it("passes the request through the shell's http plugin", async () => {
    const httpRequest = vi.fn().mockResolvedValue({ status: 200, body: "a report" });
    const signal = new AbortController().signal;
    const request: HttpRequest = {
      method: "POST",
      url: "https://atlantis-pbem.com/game/download-report",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "factionId=27&password=hunter2"
    };

    const reply = await desktopPbemTransport(pluginsWith(httpRequest))(request, signal);

    expect(httpRequest).toHaveBeenCalledWith(request, signal);
    expect(reply).toEqual({ status: 200, body: "a report" });
  });

  it("rejects when there is no desktop runtime", async () => {
    await expect(
      desktopPbemTransport(undefined)(
        { method: "POST", url: "https://atlantis-pbem.com/game/download-report", headers: {} },
        new AbortController().signal
      )
    ).rejects.toThrow();
  });
});
