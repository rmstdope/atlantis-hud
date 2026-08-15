import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingToggle } from "./SettingToggle";

/** The markup of one testid's tag, so an assertion about it cannot match a sibling's attribute. */
function tag(html: string, testid: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`));
  if (!match) {
    throw new Error(`no element carries data-testid="${testid}"`);
  }
  return match[0];
}

/** The element carrying a testid, found in the tree the component returns. */
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

describe("SettingToggle", () => {
  it("shows the title, the description underneath, and the checkbox's state", () => {
    const html = renderToStaticMarkup(
      <SettingToggle
        title="Biome textures"
        description="Uses image tiles for known biomes."
        testId="settings-biome-textures"
        checked
        onChange={() => {}}
      />
    );

    expect(html).toContain("Biome textures");
    expect(html).toContain("Uses image tiles for known biomes.");
    expect(tag(html, "settings-biome-textures")).toContain('aria-label="Biome textures"');
    expect(tag(html, "settings-biome-textures")).toContain('checked=""');
  });

  it("renders unchecked when asked to", () => {
    const html = renderToStaticMarkup(
      <SettingToggle
        title="Movement planner"
        description="Shows the experimental Movement pane."
        testId="settings-movement-planner"
        checked={false}
        onChange={() => {}}
      />
    );

    expect(tag(html, "settings-movement-planner")).not.toContain('checked=""');
  });

  it("fires onChange with the flipped value when pressed", () => {
    let asked: boolean | null = null;
    const tree = SettingToggle({
      title: "Fixed pane size",
      description: "Always reserve this many rows.",
      testId: "settings-unit-list-fixed",
      checked: false,
      onChange: (next) => (asked = next)
    });
    const onChange = find(tree, "settings-unit-list-fixed").props.onChange as (event: {
      target: { checked: boolean };
    }) => void;

    onChange({ target: { checked: true } });

    expect(asked).toBe(true);
  });
});
