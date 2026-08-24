import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { findByTestId, queryByTestId } from "./elementTree";

const wanted = "the-target";

describe("queryByTestId", () => {
  it("finds_an_element_by_its_test_id_without_a_dom", () => {
    const tree = createElement(
      "div",
      null,
      createElement("span", { "data-testid": wanted, onClick: () => "clicked" })
    );

    const found = queryByTestId(tree, wanted);

    expect(found).not.toBeNull();
    expect((found?.props.onClick as () => string)()).toBe("clicked");
  });

  it("returns_null_for_an_id_that_is_not_in_the_tree", () => {
    const tree = createElement("div", null, createElement("span", { "data-testid": "other" }));

    expect(queryByTestId(tree, wanted)).toBeNull();
  });

  it("enters_a_function_component_that_uses_no_hooks", () => {
    function Plain() {
      return createElement("b", { "data-testid": wanted });
    }

    expect(queryByTestId(createElement("div", null, createElement(Plain)), wanted)).not.toBeNull();
  });
});

describe("findByTestId", () => {
  // A component that cannot be called outside a renderer, which is what a hook does in this
  // package - reproduced with a plain throw rather than by importing React's hook machinery.
  function Hooked(): ReactElement {
    throw new Error("Invalid hook call");
  }

  it("names_the_component_it_could_not_enter", () => {
    const tree = createElement("div", null, createElement(Hooked, null, createElement("span")));

    let message = "";
    try {
      findByTestId(tree, wanted);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain(`data-testid="${wanted}"`);
    expect(message).toContain("Hooked");
    expect(message).toContain("packages/shared/src/testing/README.md");
  });

  it("says_when_an_id_is_simply_absent", () => {
    const tree = createElement("div", null, createElement("span", { "data-testid": "other" }));

    let message = "";
    try {
      findByTestId(tree, wanted);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("genuinely absent");
    expect(message).not.toContain("could not enter");
  });

  it("returns_the_element_when_it_is_there", () => {
    const tree = createElement("span", { "data-testid": wanted });

    expect(findByTestId(tree, wanted).props["data-testid"]).toBe(wanted);
  });
});
