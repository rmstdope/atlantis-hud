import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMN_WIDTH_PX, type ColumnWidths } from "../unitTable";
import { ColumnSplitter, type ColumnSplitterProps } from "./ColumnSplitter";

/**
 * The handle sitting between two column headers. Modelled directly on `RailSplitter.test.tsx`:
 * the component carries no hook state, so it can be called as a plain function to reach the
 * handlers its elements were built with. Pointer choreography is the smoke suite's business, the
 * same as `RailSplitter`'s.
 */

const NO_COLUMNS: ColumnSplitterProps["columns"] = { current: {} };

function markup(props: Partial<ColumnSplitterProps> = {}): string {
  return renderToStaticMarkup(
    <ColumnSplitter
      left="name"
      right="faction"
      columns={NO_COLUMNS}
      widths={null}
      onCommit={() => {}}
      {...props}
    />
  );
}

function tag(html: string, testid: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`));
  if (!match) {
    throw new Error(`no element carries data-testid="${testid}"`);
  }
  return match[0];
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

/** Presses a key on the rendered separator and answers with the widths it asked for. */
function press(props: Partial<ColumnSplitterProps>, key: string): ColumnWidths | "unasked" {
  let asked: ColumnWidths | "unasked" = "unasked";
  const merged: ColumnSplitterProps = {
    left: "name",
    right: "faction",
    columns: NO_COLUMNS,
    widths: null,
    onCommit: (next) => (asked = next),
    ...props
  };
  const tree = ColumnSplitter(merged);
  const onKeyDown = find(tree, `column-splitter-${merged.left}-${merged.right}`).props
    .onKeyDown as (event: unknown) => void;
  onKeyDown({ key, preventDefault: () => {} });
  return asked;
}

describe("ColumnSplitter markup", () => {
  it("is a keyboard-reachable separator named for the column it grows", () => {
    const el = tag(markup(), "column-splitter-name-faction");
    expect(el).toContain('role="separator"');
    expect(el).toContain('aria-orientation="vertical"');
    expect(el).toContain('aria-label="Resize the name column"');
    expect(el).toContain('tabindex="0"');
  });

  it("names its testid from the pair it sits between", () => {
    expect(() => tag(markup({ left: "men", right: "skills" }), "column-splitter-men-skills")).not
      .toThrow();
  });

  it("reports the left column's current width as an accessible value", () => {
    expect(tag(markup(), "column-splitter-name-faction")).toContain(
      `aria-valuenow="${DEFAULT_COLUMN_WIDTH_PX.name}"`
    );
    expect(tag(markup({ widths: { name: 300 } }), "column-splitter-name-faction")).toContain(
      'aria-valuenow="300"'
    );
  });
});

describe("ColumnSplitter keyboard handling", () => {
  it("ArrowRight grows the left column and shrinks the right one by the same amount", () => {
    const asked = press({ widths: { name: 200, faction: 200 } }, "ArrowRight");
    expect(asked).toEqual({ name: 208, faction: 192 });
  });

  it("ArrowLeft shrinks the left column and grows the right one", () => {
    const asked = press({ widths: { name: 200, faction: 200 } }, "ArrowLeft");
    expect(asked).toEqual({ name: 192, faction: 208 });
  });

  it("steps from the shipped defaults while nothing is stored", () => {
    const asked = press({ left: "men", right: "structure", widths: null }, "ArrowRight");
    expect(asked).toEqual({
      men: DEFAULT_COLUMN_WIDTH_PX.men + 8,
      structure: DEFAULT_COLUMN_WIDTH_PX.structure - 8
    });
  });

  it("resets both columns to their defaults on Enter", () => {
    const asked = press({ widths: { name: 400, faction: 40 } }, "Enter");
    expect(asked).toEqual({
      name: DEFAULT_COLUMN_WIDTH_PX.name,
      faction: DEFAULT_COLUMN_WIDTH_PX.faction
    });
  });

  it("ignores keys it does not handle", () => {
    expect(press({}, "Tab")).toBe("unasked");
  });
});

describe("ColumnSplitter double-click", () => {
  it("resets both columns to their defaults", () => {
    let asked: ColumnWidths | "unasked" = "unasked";
    const tree = ColumnSplitter({
      left: "name",
      right: "faction",
      columns: NO_COLUMNS,
      widths: { name: 400, faction: 40 },
      onCommit: (next) => (asked = next)
    });
    const onDoubleClick = find(tree, "column-splitter-name-faction").props
      .onDoubleClick as () => void;
    onDoubleClick();
    expect(asked).toEqual({
      name: DEFAULT_COLUMN_WIDTH_PX.name,
      faction: DEFAULT_COLUMN_WIDTH_PX.faction
    });
  });
});
