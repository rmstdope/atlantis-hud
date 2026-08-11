import { describe, expect, it } from "vitest";
import { copyText } from "./copyText";

describe("copying to the clipboard", () => {
  it("reports success when the clipboard takes the text", async () => {
    const written: string[] = [];
    const clipboard = {
      writeText: async (text: string) => {
        written.push(text);
      }
    };

    await expect(copyText("/tmp/map.txt", clipboard)).resolves.toBe(true);
    expect(written).toEqual(["/tmp/map.txt"]);
  });

  /**
   * There is no clipboard at all over plain http, in some webviews, and wherever the browser has
   * refused permission. `navigator.clipboard?.writeText(...)` is undefined there, and calling
   * `.then` on that throws a TypeError out of the click handler - which is how a copy button that
   * could do nothing became a copy button that breaks the dialog.
   */
  it("reports failure rather than throwing when there is no clipboard", async () => {
    await expect(copyText("/tmp/map.txt", undefined)).resolves.toBe(false);
  });

  it("reports failure when the clipboard refuses", async () => {
    const clipboard = {
      writeText: async () => {
        throw new Error("write permission denied");
      }
    };

    await expect(copyText("/tmp/map.txt", clipboard)).resolves.toBe(false);
  });

  // A clipboard object without the method is the shape an old webview presents.
  it("reports failure when the clipboard cannot write text", async () => {
    await expect(copyText("/tmp/map.txt", {} as never)).resolves.toBe(false);
  });
});
