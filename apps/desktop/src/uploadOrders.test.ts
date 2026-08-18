import { describe, expect, it, vi } from "vitest";
import { desktopOrdersUploader } from "./uploadOrders";
import type { DesktopPlugins } from "./desktopPlugins";

function pluginsWith(httpPost: DesktopPlugins["httpPost"]): DesktopPlugins {
  return {
    save: vi.fn().mockResolvedValue(null),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    httpPost
  };
}

describe("desktopOrdersUploader", () => {
  it("posts through the shell's http plugin and returns what it answered", async () => {
    const httpPost = vi.fn().mockResolvedValue({ status: 200, body: "<pre>ok</pre>" });
    const signal = new AbortController().signal;

    const reply = await desktopOrdersUploader(pluginsWith(httpPost))(
      {
        url: "https://atlantis-pbem.com/game/upload-orders",
        contentType: "multipart/form-data; boundary=BOUND",
        body: "--BOUND--\r\n"
      },
      signal
    );

    expect(httpPost).toHaveBeenCalledWith(
      "https://atlantis-pbem.com/game/upload-orders",
      "multipart/form-data; boundary=BOUND",
      "--BOUND--\r\n",
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
