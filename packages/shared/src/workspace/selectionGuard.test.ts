import { afterEach, describe, expect, it } from "vitest";
import { guardSelection } from "./selectionGuard";

/**
 * These tests run under Node, where no `document` exists. The guard only ever touches
 * `document.body.style` and the island element's `style`, so a stub carrying those is enough -
 * the same approach settingsStore.test.ts takes for the theme stamp.
 */
type StyleStub = { userSelect: string; webkitUserSelect: string };

function style(): StyleStub {
  return { userSelect: "", webkitUserSelect: "" };
}

function installBodyStub(): StyleStub {
  const body = style();
  (globalThis as { document?: unknown }).document = { body: { style: body } };
  return body;
}

function removeBodyStub() {
  delete (globalThis as { document?: unknown }).document;
}

describe("guarding selection during a drag", () => {
  afterEach(removeBodyStub);

  it("turns selection off everywhere for the duration", () => {
    const body = installBodyStub();

    const release = guardSelection();
    expect(body.userSelect).toBe("none");
    expect(body.webkitUserSelect).toBe("none");

    release();
    expect(body.userSelect).toBe("");
    expect(body.webkitUserSelect).toBe("");
  });

  it("leaves the island selectable while everything else is not", () => {
    const body = installBodyStub();
    const island = style();

    const release = guardSelection({ style: island } as unknown as HTMLElement);
    expect(body.userSelect).toBe("none");
    expect(island.userSelect).toBe("text");
    expect(island.webkitUserSelect).toBe("text");

    release();
    expect(island.userSelect).toBe("");
    expect(island.webkitUserSelect).toBe("");
    expect(body.userSelect).toBe("");
  });

  it("releasing twice is harmless, because pointerup and pointercancel can both fire", () => {
    const body = installBodyStub();

    const release = guardSelection();
    release();
    release();

    expect(body.userSelect).toBe("");
  });

  it("survives without a document, as under Node and in tests", () => {
    expect(() => guardSelection()()).not.toThrow();
  });
});
