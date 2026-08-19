import { describe, expect, it } from "vitest";

import { createReorderFeedback, dimColumn } from "./reorderFeedback";

/**
 * The repository has no jsdom, so these drive the module against a hand-rolled document that does
 * only what the module asks of it. That is enough: what is being pinned is which elements are put
 * in the overlay, where they are put, and that both go away again - not the browser's layout.
 */

type FakeElement = {
  tagName: string;
  style: Record<string, string>;
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  children: FakeElement[];
  appendChild(child: FakeElement): FakeElement;
  remove(): void;
  parent: FakeElement | null;
};

function element(tagName: string): FakeElement {
  const node: FakeElement = {
    tagName,
    style: {},
    textContent: "",
    className: "",
    dataset: {},
    children: [],
    parent: null,
    appendChild(child) {
      child.parent = node;
      node.children.push(child);
      return child;
    },
    remove() {
      const at = node.parent?.children.indexOf(node) ?? -1;
      if (node.parent && at !== -1) {
        node.parent.children.splice(at, 1);
      }
      node.parent = null;
    }
  };
  return node;
}

function overlayOf(width = 1000) {
  const overlay = element("div") as FakeElement & { ownerDocument: unknown };
  overlay.ownerDocument = { createElement: element };
  (overlay as unknown as { getBoundingClientRect: () => { width: number } }).getBoundingClientRect =
    () => ({ width });
  return overlay;
}

const asOverlay = (fake: unknown) => fake as unknown as HTMLElement;

describe("createReorderFeedback", () => {
  it("draws a drop line and a chip while the drag is happening, and removes both when it ends", () => {
    const overlay = overlayOf();
    const feedback = createReorderFeedback(asOverlay(overlay), "Long order");

    // Nothing is drawn before the pointer has moved.
    expect(overlay.children).toHaveLength(0);

    feedback.showAt(124, 300);
    expect(overlay.children).toHaveLength(2);
    const [line, chip] = overlay.children;
    expect(line.style.left).toBe("124px");
    expect(chip.style.left).toBe("300px");
    expect(chip.textContent).toBe("Long order");

    feedback.showAt(424, 500);
    expect(overlay.children).toHaveLength(2);
    expect(overlay.children[0].style.left).toBe("424px");
    expect(overlay.children[1].style.left).toBe("500px");

    feedback.remove();
    expect(overlay.children).toHaveLength(0);
  });

  it("keeps the chip within the table's own edges", () => {
    const overlay = overlayOf(400);
    const feedback = createReorderFeedback(asOverlay(overlay), "Men");
    feedback.showAt(0, -80);
    expect(overlay.children[1].style.left).toBe("0px");
    feedback.showAt(0, 900);
    expect(overlay.children[1].style.left).toBe("400px");
  });

  it("keeps the whole chip inside the table, not merely its centre", () => {
    const overlay = overlayOf(400);
    const feedback = createReorderFeedback(asOverlay(overlay), "Men");
    feedback.showAt(0, 0);
    // The chip is centred on the coordinate, so its own half-width is the inset.
    (overlay.children[1] as unknown as { offsetWidth: number }).offsetWidth = 60;
    feedback.showAt(0, -80);
    expect(overlay.children[1].style.left).toBe("30px");
    feedback.showAt(0, 900);
    expect(overlay.children[1].style.left).toBe("370px");
  });

  it("removing twice is harmless, so pointerup and pointercancel may both arrive", () => {
    const overlay = overlayOf();
    const feedback = createReorderFeedback(asOverlay(overlay), "Men");
    feedback.showAt(10, 10);
    feedback.remove();
    expect(() => feedback.remove()).not.toThrow();
    expect(overlay.children).toHaveLength(0);
  });
});

describe("dimColumn", () => {
  it("dims the header and the cells of one column, and puts them back", () => {
    const cells = [element("th"), element("td"), element("td")];
    const table = {
      querySelectorAll: (selector: string) => {
        expect(selector).toContain(":nth-child(3)");
        return cells;
      }
    } as unknown as HTMLTableElement;

    const restore = dimColumn(table, 2);
    expect(cells.map((cell) => cell.style.opacity)).toEqual(["0.4", "0.4", "0.4"]);
    restore();
    expect(cells.map((cell) => cell.style.opacity)).toEqual(["", "", ""]);
  });
});
