import { describe, expect, it, vi } from "vitest";
import type { HttpRequest } from "@atlantis/shared";
import type { DesktopPlugins } from "./desktopPlugins";
import { desktopNewAgeTransport } from "./newAgeTransport";

function pluginsWith(httpRequest: DesktopPlugins["httpRequest"]): DesktopPlugins {
  return {
    save: vi.fn().mockResolvedValue(null),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    httpRequest
  };
}

describe("desktopNewAgeTransport", () => {
  it("passes the request through the shell's http plugin", async () => {
    const httpRequest = vi.fn().mockResolvedValue({ status: 200, body: "{}" });
    const signal = new AbortController().signal;
    const request: HttpRequest = {
      method: "GET",
      url: "https://atlantis-newage.com/api/worlds/arcanum/game/status",
      headers: {}
    };

    const reply = await desktopNewAgeTransport(pluginsWith(httpRequest))(request, signal);

    expect(httpRequest).toHaveBeenCalledWith(request, signal);
    expect(reply).toEqual({ status: 200, body: "{}" });
  });

  it("rejects when there is no desktop runtime to reach the world through", async () => {
    await expect(
      desktopNewAgeTransport(undefined)(
        { method: "GET", url: "https://atlantis-newage.com/api", headers: {} },
        new AbortController().signal
      )
    ).rejects.toThrow();
  });
});
