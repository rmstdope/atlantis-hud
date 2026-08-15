import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RAIL_LEFT_DEFAULT_REM, RAIL_MAX_REM, RAIL_MIN_REM } from "./panelLayout";
import { RailSplitter, type RailSplitterProps } from "./RailSplitter";

/**
 * The drag handle hanging off a rail's inner edge.
 *
 * Modelled on `PanelSplitter.test.tsx`: `RailSplitter` carries no hook state of its own either, so
 * it can be called directly to reach the handlers its elements were built with. Its pointer
 * choreography is not exercised here - that path is the smoke suite's business
 * (`tests/smoke/workspace.spec.ts`).
 */

const NO_RAIL: RailSplitterProps["rail"] = { current: null };

function markup(props: Partial<RailSplitterProps> = {}): string {
  return renderToStaticMarkup(
    <RailSplitter
      side="left"
      rail={NO_RAIL}
      widthRem={null}
      defaultRem={RAIL_LEFT_DEFAULT_REM}
      label="Resize region panel"
      onCommit={() => {}}
      {...props}
    />
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

/** Presses a key on the rendered separator and answers with what it asked the width to become. */
function press(
  props: Partial<RailSplitterProps>,
  key: string
): number | null | "unasked" {
  let asked: number | null | "unasked" = "unasked";
  const merged: RailSplitterProps = {
    side: "left",
    rail: NO_RAIL,
    widthRem: null,
    defaultRem: RAIL_LEFT_DEFAULT_REM,
    label: "Resize region panel",
    onCommit: (next) => (asked = next),
    ...props
  };
  const tree = RailSplitter(merged);
  const onKeyDown = find(tree, `rail-splitter-${merged.side}`).props.onKeyDown as (
    event: unknown
  ) => void;
  onKeyDown({ key, preventDefault: () => {} });
  return asked;
}

describe("RailSplitter markup", () => {
  it("is a keyboard-reachable separator named for what it resizes", () => {
    const el = tag(markup(), "rail-splitter-left");
    expect(el).toContain('role="separator"');
    expect(el).toContain('aria-orientation="vertical"');
    expect(el).toContain('aria-label="Resize region panel"');
    expect(el).toContain('tabindex="0"');
  });

  it("names the right rail's handle by its own testid and label", () => {
    const el = tag(
      markup({ side: "right", label: "Resize unit and orders panels" }),
      "rail-splitter-right"
    );
    expect(el).toContain('aria-label="Resize unit and orders panels"');
  });

  it("reports its current width as an accessible value", () => {
    expect(tag(markup(), "rail-splitter-left")).toContain(
      `aria-valuenow="${RAIL_LEFT_DEFAULT_REM}"`
    );
    expect(tag(markup({ widthRem: 24 }), "rail-splitter-left")).toContain('aria-valuenow="24"');
    expect(tag(markup(), "rail-splitter-left")).toContain(`aria-valuemin="${RAIL_MIN_REM}"`);
    expect(tag(markup(), "rail-splitter-left")).toContain(`aria-valuemax="${RAIL_MAX_REM}"`);
  });
});

describe("RailSplitter keyboard handling", () => {
  it("arrows move the edge: right grows the left rail", () => {
    expect(press({ side: "left", widthRem: 19 }, "ArrowRight")).toBe(20);
    expect(press({ side: "left", widthRem: 19 }, "ArrowLeft")).toBe(18);
  });

  it("arrows move the edge: right shrinks the right rail", () => {
    expect(press({ side: "right", widthRem: 21 }, "ArrowRight")).toBe(20);
    expect(press({ side: "right", widthRem: 21 }, "ArrowLeft")).toBe(22);
  });

  it("steps from the default while nothing is stored", () => {
    expect(press({ side: "left", widthRem: null, defaultRem: RAIL_LEFT_DEFAULT_REM }, "ArrowRight")).toBe(
      RAIL_LEFT_DEFAULT_REM + 1
    );
  });

  it("resets on Enter", () => {
    expect(press({ widthRem: 30 }, "Enter")).toBeNull();
  });

  it("ignores keys it does not handle", () => {
    expect(press({ widthRem: 19 }, "Tab")).toBe("unasked");
  });
});

describe("RailSplitter double-click", () => {
  it("resets to the default width", () => {
    let asked: number | null | "unasked" = "unasked";
    const tree = RailSplitter({
      side: "left",
      rail: NO_RAIL,
      widthRem: 30,
      defaultRem: RAIL_LEFT_DEFAULT_REM,
      label: "Resize region panel",
      onCommit: (next) => (asked = next)
    });
    const onDoubleClick = find(tree, "rail-splitter-left").props.onDoubleClick as () => void;
    onDoubleClick();
    expect(asked).toBeNull();
  });
});
