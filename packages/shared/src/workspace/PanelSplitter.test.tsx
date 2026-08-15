import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  dragOrdersHeight,
  dragUnitsHeight,
  ORDERS_DEFAULT_REM,
  ORDERS_MAX_REM,
  ORDERS_MIN_REM,
  UNITS_DEFAULT_REM
} from "./panelLayout";
import { PanelSplitter, type PanelSplitterProps } from "./PanelSplitter";

/**
 * The drag handle above a slot in a column - the orders editor's, and the units-in-hex pane's.
 *
 * `PanelSplitter` carries no hook state of its own - see its header comment - so it can be called
 * directly to reach the handlers its elements were built with. Its pointer choreography is not
 * exercised here: without jsdom there is no real DOM to drag across, and that path is the smoke
 * suite's business (`tests/smoke/workspace.spec.ts`).
 */

const NO_SLOT: PanelSplitterProps["slot"] = { current: null };

const ORDERS_PROPS = {
  slot: NO_SLOT,
  defaultRem: ORDERS_DEFAULT_REM,
  minRem: ORDERS_MIN_REM,
  maxRem: ORDERS_MAX_REM,
  drag: dragOrdersHeight,
  label: "Resize orders panel",
  testId: "panel-splitter"
} as const;

function markup(heightRem: number | null = null): string {
  return renderToStaticMarkup(
    <PanelSplitter {...ORDERS_PROPS} heightRem={heightRem} onCommit={() => {}} />
  );
}

/** The markup of one testid's tag, so an assertion about it cannot match a sibling's attribute. */
function tag(html: string, testid: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`));
  if (!match) {
    throw new Error(`no element carries data-testid="${testid}"`);
  }
  return match[0];
}

/** The element carrying a testid, found in the tree the component returns; see the Stepper test. */
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

/** Presses a key on the rendered separator and answers with what it asked the height to become. */
function press(heightRem: number | null, key: string): number | null | "unasked" {
  let asked: number | null | "unasked" = "unasked";
  const tree = PanelSplitter({
    ...ORDERS_PROPS,
    heightRem,
    onCommit: (next) => (asked = next)
  });
  const onKeyDown = find(tree, "panel-splitter").props.onKeyDown as (event: unknown) => void;
  onKeyDown({ key, preventDefault: () => {} });
  return asked;
}

describe("PanelSplitter markup", () => {
  it("is a keyboard-reachable separator named for what it resizes", () => {
    const html = markup();
    const el = tag(html, "panel-splitter");
    expect(el).toContain('role="separator"');
    expect(el).toContain('aria-label="Resize orders panel"');
    expect(el).toContain('tabindex="0"');
  });

  it("reports its current height as an accessible value", () => {
    expect(tag(markup(null), "panel-splitter")).toContain(`aria-valuenow="${ORDERS_DEFAULT_REM}"`);
    expect(tag(markup(24), "panel-splitter")).toContain('aria-valuenow="24"');
  });
});

describe("PanelSplitter keyboard handling", () => {
  it("steps the height up and down by one rem", () => {
    const up = press(19, "ArrowUp");
    const down = press(19, "ArrowDown");
    expect(up).toBe(20);
    expect(down).toBe(18);
  });

  it("steps from the default pin when nothing is stored yet", () => {
    expect(press(null, "ArrowUp")).toBe(ORDERS_DEFAULT_REM + 1);
  });

  it("resets to the default pin on Enter", () => {
    expect(press(30, "Enter")).toBeNull();
  });

  it("does nothing for a key it does not handle", () => {
    expect(press(19, "Tab")).toBe("unasked");
  });
});

describe("PanelSplitter double-click", () => {
  it("resets to the default pin", () => {
    let asked: number | null | "unasked" = "unasked";
    const tree = PanelSplitter({
      ...ORDERS_PROPS,
      heightRem: 30,
      onCommit: (next) => (asked = next)
    });
    const onDoubleClick = find(tree, "panel-splitter").props.onDoubleClick as () => void;
    onDoubleClick();
    expect(asked).toBeNull();
  });
});

describe("a units splitter, named for the units pane", () => {
  it("carries the units label, testid and steps from its own default", () => {
    const html = renderToStaticMarkup(
      <PanelSplitter
        slot={NO_SLOT}
        heightRem={null}
        defaultRem={UNITS_DEFAULT_REM}
        minRem={5.5}
        maxRem={60}
        drag={dragUnitsHeight}
        label="Resize units pane"
        testId="units-splitter"
        onCommit={() => {}}
      />
    );
    const el = tag(html, "units-splitter");
    expect(el).toContain('aria-label="Resize units pane"');
    expect(el).toContain(`aria-valuenow="${UNITS_DEFAULT_REM}"`);

    let asked: number | null | "unasked" = "unasked";
    const tree = PanelSplitter({
      slot: NO_SLOT,
      heightRem: null,
      defaultRem: UNITS_DEFAULT_REM,
      minRem: 5.5,
      maxRem: 60,
      drag: dragUnitsHeight,
      label: "Resize units pane",
      testId: "units-splitter",
      onCommit: (next) => (asked = next)
    });
    const onKeyDown = find(tree, "units-splitter").props.onKeyDown as (event: unknown) => void;
    onKeyDown({ key: "ArrowUp", preventDefault: () => {} });
    expect(asked).toBe(UNITS_DEFAULT_REM + 1);
  });
});
