import { describe, expect, it } from "vitest";
import { createUnitDragChip } from "./unitDragChip";

/**
 * The repository has no jsdom, so this drives the module against a hand-rolled body that does only
 * what the module asks of it - exactly as `reorderFeedback.test.ts` does. What is being pinned is
 * that the chip appears only once the pointer has moved, that it follows it, and that it goes away
 * again however the drag ended; the browser's layout is the smoke suite's business.
 */
type FakeElement = {
  tagName: string;
  style: Record<string, string>;
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  children: FakeElement[];
  parent: FakeElement | null;
  appendChild(child: FakeElement): FakeElement;
  remove(): void;
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

function bodyOf() {
  const body = element("body") as FakeElement & { ownerDocument: unknown };
  body.ownerDocument = { createElement: element };
  return body;
}

const asHost = (fake: unknown) => fake as unknown as HTMLElement;

describe("createUnitDragChip", () => {
  it("draws nothing until it is first moved", () => {
    const body = bodyOf();
    const chip = createUnitDragChip("3 units", asHost(body));

    // A press that never moved must leave nothing behind on screen.
    expect(body.children).toHaveLength(0);

    chip.moveTo(120, 300);

    expect(body.children).toHaveLength(1);
    expect(body.children[0].textContent).toBe("3 units");
    expect(body.children[0].dataset.testid).toBe("unit-drag-chip");
    expect(body.children[0].style.left).toBe("120px");
    expect(body.children[0].style.top).toBe("300px");
  });

  it("follows the pointer without drawing a second chip", () => {
    const body = bodyOf();
    const chip = createUnitDragChip("Vanguard", asHost(body));

    chip.moveTo(10, 10);
    chip.moveTo(90, 40);

    expect(body.children).toHaveLength(1);
    expect(body.children[0].style.left).toBe("90px");
    expect(body.children[0].style.top).toBe("40px");
  });

  it("is fixed to the window rather than to whatever it was created in", () => {
    const body = bodyOf();
    createUnitDragChip("Vanguard", asHost(body)).moveTo(1, 1);

    // A blurred ancestor is what a fixed position resolves against, so a chip made inside the
    // units pane would be trapped in it and could never reach the rail (`UnitTooltip.tsx`).
    expect(body.children[0].className).toContain("fixed");
  });

  it("removes itself twice without complaining", () => {
    const body = bodyOf();
    const chip = createUnitDragChip("3 units", asHost(body));
    chip.moveTo(10, 10);

    chip.remove();
    expect(body.children).toHaveLength(0);
    // `pointerup` and `pointercancel` can both deliver the same ending.
    expect(() => chip.remove()).not.toThrow();
    expect(body.children).toHaveLength(0);
  });

  it("removing a chip that was never drawn is harmless", () => {
    expect(() => createUnitDragChip("3 units", asHost(bodyOf())).remove()).not.toThrow();
  });
});
