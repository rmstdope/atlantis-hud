import { describe, expect, it, vi } from "vitest";
import { desktopOrdersUploader } from "./uploadOrders";
import type { DesktopHttpPlugins } from "./desktopPlugins";

function pluginsWith(httpRequest: DesktopHttpPlugins["httpRequest"]): DesktopHttpPlugins {
  return { httpRequest };
}

describe("desktopOrdersUploader", () => {
  it("posts through the shell's http plugin and returns what it answered", async () => {
    const httpRequest = vi.fn().mockResolvedValue({ status: 200, body: "<pre>ok</pre>" });
    const signal = new AbortController().signal;

    const reply = await desktopOrdersUploader(pluginsWith(httpRequest))(
      {
        url: "https://atlantis-pbem.com/game/upload-orders",
        contentType: "multipart/form-data; boundary=BOUND",
        body: "--BOUND--\r\n"
      },
      signal
    );

    expect(httpRequest).toHaveBeenCalledWith(
      {
        method: "POST",
        url: "https://atlantis-pbem.com/game/upload-orders",
        headers: { "Content-Type": "multipart/form-data; boundary=BOUND" },
        body: "--BOUND--\r\n"
      },
      signal
    );
    expect(reply).toEqual({ status: 200, body: "<pre>ok</pre>" });
  });

  it("rejects when there is no desktop runtime to post through", async () => {
    const upload = {
      url: "https://atlantis-pbem.com/game/upload-orders",
      contentType: "multipart/form-data; boundary=BOUND",
      body: "--BOUND--\r\n"
    };

    await expect(
      desktopOrdersUploader(undefined)(upload, new AbortController().signal)
    ).rejects.toThrow();
  });
});
