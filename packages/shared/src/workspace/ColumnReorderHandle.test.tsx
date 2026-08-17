import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ColumnOrder } from "../unitTable";
import { ColumnReorderHandle, isReorderable, type ColumnReorderHandleProps } from "./ColumnReorderHandle";

/**
 * Modelled directly on `ColumnSplitter.test.tsx`: no hook state, so the component can be called as
 * a plain function to reach the handlers its element was built with. Pointer choreography is the
 * smoke suite's business, the same as every other drag handle here.
 */

const ORDER: ColumnOrder = ["own", "unitId", "name", "faction", "men"];

function markup(props: Partial<ColumnReorderHandleProps> = {}): string {
  return renderToStaticMarkup(
    <ColumnReorderHandle column="name" order={ORDER} widths={null} onCommit={() => {}} {...props} />
  );
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

function press(props: Partial<ColumnReorderHandleProps>, key: string): ColumnOrder | "unasked" {
  let asked: ColumnOrder | "unasked" = "unasked";
  const merged: ColumnReorderHandleProps = {
    column: "name",
    order: ORDER,
    widths: null,
    onCommit: (next) => (asked = next),
    ...props
  };
  const tree = ColumnReorderHandle(merged);
  const onKeyDown = find(tree, `column-reorder-${merged.column}`).props.onKeyDown as (
    event: unknown
  ) => void;
  onKeyDown({ key, preventDefault: () => {} });
  return asked;
}

describe("ColumnReorderHandle markup", () => {
  it("is a keyboard-reachable handle named for the column it moves", () => {
    const el = markup();
    expect(el).toContain('data-testid="column-reorder-name"');
    expect(el).toContain('aria-label="Move the name column"');
    expect(el).toContain('tabindex="0"');
  });
});

describe("ColumnReorderHandle keyboard handling", () => {
  it("ArrowRight swaps the column with its right neighbour", () => {
    const asked = press({ column: "name" }, "ArrowRight");
    expect(asked).toEqual(["own", "unitId", "faction", "name", "men"]);
  });

  it("ArrowLeft swaps the column with its left neighbour", () => {
    const asked = press({ column: "name" }, "ArrowLeft");
    expect(asked).toEqual(["own", "name", "unitId", "faction", "men"]);
  });

  it("does not let a column swap past own", () => {
    expect(press({ column: "unitId" }, "ArrowLeft")).toBe("unasked");
  });

  it("does nothing at the right end of the order", () => {
    expect(press({ column: "men" }, "ArrowRight")).toBe("unasked");
  });

  it("ignores keys it does not handle", () => {
    expect(press({}, "Tab")).toBe("unasked");
  });
});

describe("isReorderable", () => {
  it("is false only for own", () => {
    expect(isReorderable("own")).toBe(false);
  });

  it("is true for every other column", () => {
    for (const column of ["unitId", "name", "faction", "men", "skills", "items", "structure", "longOrder"] as const) {
      expect(isReorderable(column)).toBe(true);
    }
  });
});
