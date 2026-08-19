import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COLUMN_MIN_PX, DEFAULT_COLUMN_SHARES, type ColumnShares } from "../unitTable";
import { ColumnSplitter, type ColumnSplitterProps } from "./ColumnSplitter";

/**
 * The handle sitting between two column headers. Modelled directly on `RailSplitter.test.tsx`:
 * the component carries no hook state, so it can be called as a plain function to reach the
 * handlers its elements were built with. Pointer choreography is the smoke suite's business.
 */

const NO_COLUMNS: ColumnSplitterProps["columns"] = { current: {} };
const NO_TABLE: ColumnSplitterProps["table"] = { current: null };

function props(overrides: Partial<ColumnSplitterProps> = {}): ColumnSplitterProps {
  return {
    left: "name",
    right: "faction",
    columns: NO_COLUMNS,
    table: NO_TABLE,
    shares: null,
    onCommit: () => {},
    ...overrides
  };
}

function markup(overrides: Partial<ColumnSplitterProps> = {}): string {
  return renderToStaticMarkup(<ColumnSplitter {...props(overrides)} />);
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
    const elementProps = node.props as Record<string, unknown>;
    if (elementProps["data-testid"] === testid) {
      return node as ReactElement<Record<string, unknown>>;
    }
    return find(elementProps.children as ReactNode, testid);
  }
  throw new Error(`no element carries data-testid="${testid}"`);
}

/** A table element wide enough to convert a pixel floor into a share. */
function tableOf(width: number): ColumnSplitterProps["table"] {
  return { current: { getBoundingClientRect: () => ({ width }) } as unknown as HTMLTableElement };
}

/** Presses a key on the rendered separator and answers with the shares it asked for. */
function press(
  overrides: Partial<ColumnSplitterProps>,
  key: string
): ColumnShares | "unasked" {
  let asked: ColumnShares | "unasked" = "unasked";
  const merged = props({ onCommit: (next) => (asked = next), ...overrides });
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
    expect(el).toContain('tabindex="0"');
  });

  it("names the column the way the header does, not by its internal key", () => {
    expect(tag(markup({ left: "longOrder", right: "own" }), "column-splitter-longOrder-own")).toContain(
      'aria-label="Resize the Long order column"'
    );
  });

  it("carries a complete set of accessible values, the maximum included", () => {
    const el = tag(markup({ shares: { name: 0.3 } }), "column-splitter-name-faction");
    expect(el).toContain('aria-valuenow="30"');
    expect(el).toContain('aria-valuemax="100"');
    expect(el).toMatch(/aria-valuemin="\d+"/);
  });
});

describe("ColumnSplitter keyboard handling", () => {
  it("ArrowRight grows the left column and shrinks the right one by the same amount", () => {
    const asked = press({ shares: { name: 0.3, faction: 0.3 }, table: tableOf(800) }, "ArrowRight");
    expect(asked).not.toBe("unasked");
    const shares = asked as ColumnShares;
    expect(shares.name).toBeCloseTo(0.3 + 8 / 800, 12);
    expect(shares.faction).toBeCloseTo(0.3 - 8 / 800, 12);
  });

  it("ArrowLeft shrinks the left column and grows the right one", () => {
    const shares = press(
      { shares: { name: 0.3, faction: 0.3 }, table: tableOf(800) },
      "ArrowLeft"
    ) as ColumnShares;
    expect(shares.name).toBeCloseTo(0.3 - 8 / 800, 12);
    expect(shares.faction).toBeCloseTo(0.3 + 8 / 800, 12);
  });

  it("steps from the shipped shares while nothing is stored", () => {
    const shares = press(
      { left: "men", right: "skills", shares: null, table: tableOf(800) },
      "ArrowRight"
    ) as ColumnShares;
    expect(shares.men).toBeCloseTo(DEFAULT_COLUMN_SHARES.men + 8 / 800, 12);
    expect(shares.skills).toBeCloseTo(DEFAULT_COLUMN_SHARES.skills - 8 / 800, 12);
  });

  it("cannot step a column below its minimum", () => {
    const floor = COLUMN_MIN_PX / 800;
    const shares = press(
      { shares: { name: floor, faction: 0.3 }, table: tableOf(800) },
      "ArrowLeft"
    ) as ColumnShares;
    expect(shares.name).toBeCloseTo(floor, 12);
    expect((shares.name ?? 0) + (shares.faction ?? 0)).toBeCloseTo(floor + 0.3, 12);
  });

  it("asks for nothing when the table cannot be measured", () => {
    expect(press({ shares: { name: 0.3, faction: 0.3 } }, "ArrowRight")).toBe("unasked");
  });

  it("resets both columns to their defaults on Enter", () => {
    expect(press({ shares: { name: 0.4, faction: 0.02 } }, "Enter")).toEqual({
      name: DEFAULT_COLUMN_SHARES.name,
      faction: DEFAULT_COLUMN_SHARES.faction
    });
  });

  it("ignores keys it does not handle", () => {
    expect(press({}, "Tab")).toBe("unasked");
  });
});

describe("ColumnSplitter double-click", () => {
  it("resets only the pair it sits between", () => {
    let asked: ColumnShares | "unasked" = "unasked";
    const tree = ColumnSplitter(
      props({ shares: { name: 0.4, faction: 0.02 }, onCommit: (next) => (asked = next) })
    );
    const onDoubleClick = find(tree, "column-splitter-name-faction").props
      .onDoubleClick as () => void;
    onDoubleClick();
    expect(asked).toEqual({
      name: DEFAULT_COLUMN_SHARES.name,
      faction: DEFAULT_COLUMN_SHARES.faction
    });
  });
});

describe("ColumnSplitter accessible range", () => {
  it("never reports a minimum above the value, however narrow the table", () => {
    // The floor is in pixels, so a narrow table can render a column below it legitimately; a
    // minimum above the current value would break the ARIA range rather than describe anything.
    const el = tag(
      markup({ shares: { name: 0.02 }, table: tableOf(200) }),
      "column-splitter-name-faction"
    );
    const min = Number(/aria-valuemin="(\d+)"/.exec(el)?.[1]);
    const now = Number(/aria-valuenow="(\d+)"/.exec(el)?.[1]);

    expect(min).toBeLessThanOrEqual(now);
    expect(now).toBeLessThanOrEqual(100);
  });
});
