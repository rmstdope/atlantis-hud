import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UNIT_COLUMNS, type ColumnOrder, type UnitColumn } from "../unitTable";
import { ColumnReorderHandle, isReorderable, type ColumnReorderHandleProps } from "./ColumnReorderHandle";

/**
 * Modelled on `ColumnSplitter.test.tsx`: no hook state, so the component can be called as a plain
 * function to reach the handlers its element was built with.
 *
 * The drag cases stub `window` and a table, because the repository has no jsdom and the whole
 * point of this bead is what the gesture *draws* - a test that only asserted the resulting order
 * would pass against the very defect (PR #421) this bead exists to not repeat.
 */

const ORDER: ColumnOrder = [...UNIT_COLUMNS];

type FakeElement = {
  style: Record<string, string>;
  className: string;
  textContent: string;
  dataset: Record<string, string>;
  children: FakeElement[];
  parent: FakeElement | null;
  appendChild(child: FakeElement): FakeElement;
  remove(): void;
};

function element(): FakeElement {
  const node: FakeElement = {
    style: {},
    className: "",
    textContent: "",
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

function overlayRef() {
  const overlay = element() as FakeElement & Record<string, unknown>;
  overlay.ownerDocument = { createElement: () => element() };
  overlay.getBoundingClientRect = () => ({ width: 1000 });
  return { current: overlay as unknown as HTMLElement };
}

function tableRef() {
  const cells: FakeElement[] = [element(), element()];
  const table = {
    getBoundingClientRect: () => ({ width: 1000 }),
    querySelectorAll: () => cells
  };
  return { ref: { current: table as unknown as HTMLTableElement }, cells };
}

/** A window and document that only record the listeners the handle registers. */
function stubEnvironment() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const add = (type: string, fn: (event: unknown) => void) => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  };
  const remove = (type: string, fn: (event: unknown) => void) => {
    listeners.set(type, (listeners.get(type) ?? []).filter((each) => each !== fn));
  };
  vi.stubGlobal("window", { addEventListener: add, removeEventListener: remove });
  vi.stubGlobal("document", {
    addEventListener: add,
    removeEventListener: remove,
    // `guardSelection` turns selection off on the body for the length of the gesture.
    body: { style: {} as Record<string, string> }
  });
  const fire = (type: string, event: unknown) => {
    for (const fn of [...(listeners.get(type) ?? [])]) {
      fn(event);
    }
  };
  return { fire, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

type Drag = {
  committed: ColumnOrder | "unasked";
  overlay: { current: HTMLElement };
  cells: FakeElement[];
  fire: (type: string, event: unknown) => void;
  listeners: Map<string, Array<(event: unknown) => void>>;
};

function startDrag(column: UnitColumn = "name"): Drag {
  const environment = stubEnvironment();
  const overlay = overlayRef();
  const { ref: table, cells } = tableRef();
  const drag: Drag = {
    committed: "unasked",
    overlay,
    cells,
    fire: environment.fire,
    listeners: environment.listeners
  };
  const props: ColumnReorderHandleProps = {
    column,
    order: ORDER,
    shares: null,
    table,
    overlay,
    onCommit: (next) => {
      drag.committed = next;
    }
  };
  const onPointerDown = handler(ColumnReorderHandle(props), column, "onPointerDown");
  onPointerDown({ button: 0, clientX: 500, preventDefault: () => {} });
  return drag;
}

function find(node: ReactNode, testid: string): ReactElement<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return find(child, testid);
      } catch {
        // Not down this branch; keep looking along the rest.
      }
    }
  }
  if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    if (props["data-testid"] === testid) {
      return node as ReactElement<Record<string, unknown>>;
    }
    return find(props.children as ReactNode, testid);
  }
  throw new Error(`no element carries data-testid="${testid}"`);
}

function handler(tree: ReactNode, column: UnitColumn, name: string) {
  return find(tree, `column-reorder-${column}`).props[name] as (event: unknown) => void;
}

function press(column: UnitColumn, key: string): ColumnOrder | "unasked" {
  let asked: ColumnOrder | "unasked" = "unasked";
  const tree = ColumnReorderHandle({
    column,
    order: ORDER,
    shares: null,
    table: { current: null },
    overlay: { current: null },
    onCommit: (next) => {
      asked = next;
    }
  });
  handler(tree, column, "onKeyDown")({ key, preventDefault: () => {} });
  return asked;
}

describe("ColumnReorderHandle markup", () => {
  it("is a keyboard-reachable handle named for the column it moves", () => {
    const markup = renderToStaticMarkup(
      <ColumnReorderHandle
        column="longOrder"
        order={ORDER}
        shares={null}
        table={{ current: null }}
        overlay={{ current: null }}
        onCommit={() => {}}
      />
    );
    expect(markup).toContain('data-testid="column-reorder-longOrder"');
    expect(markup).toContain('aria-label="Move the Long order column"');
    expect(markup).toContain('tabindex="0"');
  });
});

describe("ColumnReorderHandle drag feedback", () => {
  it("draws a drop line and a chip while the drag is happening, and removes both when it ends", () => {
    const drag = startDrag("name");
    // Nothing is drawn on the press alone.
    expect(drag.overlay.current.children).toHaveLength(0);

    drag.fire("pointermove", { clientX: 700 });
    const drawn = drag.overlay.current.children as unknown as FakeElement[];
    expect(drawn).toHaveLength(2);
    expect(drawn[1].textContent).toBe("Unit");
    expect(drawn[0].style.left).not.toBe("");
    // The chip follows the pointer, in the table's own coordinates.
    const firstLine = drawn[0].style.left;

    drag.fire("pointermove", { clientX: 900 });
    expect(drawn[0].style.left).not.toBe(firstLine);

    drag.fire("pointerup", {});
    expect(drag.overlay.current.children).toHaveLength(0);
  });

  it("fades the dragged column while it is in hand, and restores it at the end", () => {
    const drag = startDrag("name");
    drag.fire("pointermove", { clientX: 700 });
    expect(drag.cells.every((cell) => cell.style.opacity !== "")).toBe(true);
    drag.fire("pointerup", {});
    expect(drag.cells.every((cell) => cell.style.opacity === "")).toBe(true);
  });

  it("commits the order the drop line was showing", () => {
    const drag = startDrag("name");
    // name is third; faction is 192/1344 of a 1000px table, about 143px.
    drag.fire("pointermove", { clientX: 700 });
    drag.fire("pointerup", {});
    expect(drag.committed).not.toBe("unasked");
    const committed = drag.committed as ColumnOrder;
    expect(committed.indexOf("name")).toBeGreaterThan(ORDER.indexOf("name"));
    expect(committed[0]).toBe("own");
  });
});

describe("ColumnReorderHandle cancelling", () => {
  it("Escape leaves the order exactly as it was", () => {
    const drag = startDrag("name");
    drag.fire("pointermove", { clientX: 900 });
    drag.fire("keydown", { key: "Escape", stopPropagation: () => {} });
    expect(drag.committed).toBe("unasked");
    expect(drag.overlay.current.children).toHaveLength(0);
    expect(drag.cells.every((cell) => cell.style.opacity === "")).toBe(true);
  });

  it("a drag that never crossed a neighbour commits nothing either", () => {
    const drag = startDrag("name");
    // Well short of the neighbouring column's width, so the order resolves to the one it started
    // from - storing that would make the shipped order a stored preference.
    drag.fire("pointermove", { clientX: 505 });
    drag.fire("pointerup", {});
    expect(drag.committed).toBe("unasked");
  });

  it("a press that never moved commits nothing", () => {
    const drag = startDrag("name");
    drag.fire("pointerup", {});
    expect(drag.committed).toBe("unasked");
    expect(drag.overlay.current.children).toHaveLength(0);
  });

  it("lets go of every listener it took", () => {
    const drag = startDrag("name");
    drag.fire("pointermove", { clientX: 700 });
    drag.fire("pointerup", {});
    for (const [, fns] of drag.listeners) {
      expect(fns).toHaveLength(0);
    }
  });
});

describe("ColumnReorderHandle keyboard handling", () => {
  it("the arrow keys move a focused column one place, never past the marker", () => {
    expect(press("name", "ArrowRight")).toEqual([
      "own",
      "unitId",
      "faction",
      "name",
      "men",
      "skills",
      "items",
      "structure",
      "longOrder"
    ]);
    expect(press("name", "ArrowLeft")).toEqual([
      "own",
      "name",
      "unitId",
      "faction",
      "men",
      "skills",
      "items",
      "structure",
      "longOrder"
    ]);
    expect(press("unitId", "ArrowLeft")).toBe("unasked");
    expect(press("longOrder", "ArrowRight")).toBe("unasked");
    expect(press("name", "Tab")).toBe("unasked");
  });
});

describe("isReorderable", () => {
  it("is false only for own", () => {
    expect(isReorderable("own")).toBe(false);
    for (const column of UNIT_COLUMNS.filter((each) => each !== "own")) {
      expect(isReorderable(column)).toBe(true);
    }
  });
});
