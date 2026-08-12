import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UNIT_LIST_LIMIT_MAX, UNIT_LIST_LIMIT_MIN } from "../settingsStore";
import { UnitListLimitStepper } from "./UnitListLimitStepper";

/**
 * The + and - the units pane carries for how many rows it stands.
 *
 * The count is the preference itself rather than what the hex happens to hold, so it is spelled
 * "max": it reads as a ceiling that a smaller hex simply does not reach. What is asserted here is
 * the reading, the two ends, and which way each button steps; that the pane actually resizes is
 * the smoke suite's business.
 */

function markup(value: number): string {
  return renderToStaticMarkup(<UnitListLimitStepper value={value} onChange={() => {}} />);
}

/** The markup of one testid's tag, so an assertion about it cannot match a sibling's attribute. */
function tag(html: string, testid: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`));
  if (!match) {
    throw new Error(`no element carries data-testid="${testid}"`);
  }
  return match[0];
}

/**
 * The element carrying a testid, found in the tree the component returns.
 *
 * There is no jsdom here and no clicking, so the press is made by calling the handler the element
 * was built with - which is the part of the contract markup cannot show. Without it, swapping the
 * two buttons' handlers would leave every assertion below green.
 */
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

/** Presses a button in a rendered stepper and answers with what it asked the limit to become. */
function press(value: number, testid: string): number | null {
  let asked: number | null = null;
  const tree = UnitListLimitStepper({ value, onChange: (next) => (asked = next) });
  const click = find(tree, testid).props.onClick as () => void;
  click();
  return asked;
}

describe("UnitListLimitStepper", () => {
  it("says what the current maximum is", () => {
    expect(markup(12)).toContain("max 12");
    expect(markup(4)).toContain("max 4");
  });

  it("steps a single row, in the direction the button is marked with", () => {
    expect(press(12, "unit-list-limit-less")).toBe(11);
    expect(press(12, "unit-list-limit-more")).toBe(13);
  });

  // The attribute, not the word: the buttons carry an `aria-disabled:opacity-40` class either way,
  // so a bare substring check would read as spent at every value and assert nothing.
  const SPENT = /\saria-disabled="true"/;

  it("marks the way down as spent at the floor", () => {
    expect(tag(markup(UNIT_LIST_LIMIT_MIN), "unit-list-limit-less")).toMatch(SPENT);
    expect(tag(markup(UNIT_LIST_LIMIT_MIN + 1), "unit-list-limit-less")).not.toMatch(SPENT);
  });

  it("marks the way up as spent at the ceiling", () => {
    expect(tag(markup(UNIT_LIST_LIMIT_MAX), "unit-list-limit-more")).toMatch(SPENT);
    expect(tag(markup(UNIT_LIST_LIMIT_MAX - 1), "unit-list-limit-more")).not.toMatch(SPENT);
  });

  it("keeps a spent button pressable, so the focus on it is not lost", () => {
    // The store clamps, so the press is a no-op there rather than here. A `disabled` button would
    // leave the tab order under the user's own finger the moment they reached the end.
    expect(tag(markup(UNIT_LIST_LIMIT_MIN), "unit-list-limit-less")).not.toMatch(/\sdisabled=""/);
    expect(press(UNIT_LIST_LIMIT_MIN, "unit-list-limit-less")).toBe(UNIT_LIST_LIMIT_MIN - 1);
  });

  it("names both buttons, since a bare + and - say nothing when read aloud", () => {
    const html = markup(12);
    // Rows, not units: nothing here takes a unit out of the list, and a name that said so would
    // describe the very thing the pane refuses to do.
    expect(tag(html, "unit-list-limit-less")).toContain('aria-label="Show fewer rows"');
    expect(tag(html, "unit-list-limit-more")).toContain('aria-label="Show more rows"');
  });
});
