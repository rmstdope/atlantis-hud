import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { aTradeRoute, aTradedGood } from "@atlantis/core-client";
import { TradePanel } from "./TradePanel";

const labelFor = (regionId: string) => `hex ${regionId}`;

/**
 * Finds the first element in an already-created (unrendered) React element tree carrying the
 * given `data-testid`, without a DOM - this package has no `@testing-library/react` or jsdom, so
 * a click is exercised by calling the button's own `onClick` prop directly rather than dispatching
 * a real event.
 */
function findByTestId(node: unknown, testId: string): { props: Record<string, unknown> } | null {
  if (node === null || typeof node !== "object") {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child, testId);
      if (found) {
        return found;
      }
    }
    return null;
  }
  const element = node as {
    type?: unknown;
    props?: Record<string, unknown>;
  };
  if (element.props?.["data-testid"] === testId) {
    return element as { props: Record<string, unknown> };
  }
  // A function component (like `TradePanel` itself) has to be called to see what it renders; a
  // host element's children are already fully-formed React elements, needing no such call.
  if (typeof element.type === "function") {
    const rendered = (element.type as (props: unknown) => unknown)(element.props);
    return findByTestId(rendered, testId);
  }
  return findByTestId(element.props?.children, testId);
}

describe("TradePanel", () => {
  it("lists a route with its goods and its journey", () => {
    const markup = renderToStaticMarkup(
      <TradePanel
        routes={[aTradeRoute()]}
        labelFor={labelFor}
        onSelectHex={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(markup).toContain("49,3");
    expect(markup).toContain("→");
    expect(markup).toContain("0,48");
    expect(markup).toContain("$10,209");
    expect(markup).toContain("chocolate");
    expect(markup).toContain("CHOC");
    expect(markup).toContain("41");
    expect(markup).toContain("+$249");
    expect(markup).toContain("14/7/4 turns on foot/riding/flying");
  });

  it("a circuit reads both ways", () => {
    const circuit = aTradeRoute({
      from: { x: 36, y: 4, z: 1 },
      to: { x: 0, y: 48, z: 1 },
      outbound: [aTradedGood({ name: "chocolate", tag: "CHOC", quantity: 41, margin: 218 })],
      inbound: [aTradedGood({ name: "perfume", tag: "PERF", quantity: 36, margin: 185 })],
      worth: 15_598
    });
    const markup = renderToStaticMarkup(
      <TradePanel routes={[circuit]} labelFor={labelFor} onSelectHex={() => {}} onDismiss={() => {}} />
    );
    expect(markup).toContain("⇄");
    expect(markup).not.toContain("36,4 →");
    const outIndex = markup.indexOf("out:");
    const backIndex = markup.indexOf("back:");
    expect(outIndex).toBeGreaterThan(-1);
    expect(backIndex).toBeGreaterThan(outIndex);
  });

  it("a mode that cannot make it shows a dash", () => {
    const route = aTradeRoute({ turns: { walk: null, ride: null, fly: 9 } });
    const markup = renderToStaticMarkup(
      <TradePanel routes={[route]} labelFor={labelFor} onSelectHex={() => {}} onDismiss={() => {}} />
    );
    expect(markup).toContain("—/—/9 turns on foot/riding/flying");
  });

  it("a route nothing can reach says so", () => {
    const route = aTradeRoute({ turns: { walk: null, ride: null, fly: null } });
    const markup = renderToStaticMarkup(
      <TradePanel routes={[route]} labelFor={labelFor} onSelectHex={() => {}} onDismiss={() => {}} />
    );
    expect(markup).toContain("no known way");
    expect(markup).not.toContain("turns on foot");
  });

  it("a stale half says when it was seen", () => {
    const route = aTradeRoute({
      outbound: [aTradedGood({ buySeenTurn: 42, sellSeenTurn: 82 })]
    });
    const markup = renderToStaticMarkup(
      <TradePanel routes={[route]} labelFor={labelFor} onSelectHex={() => {}} onDismiss={() => {}} />
    );
    expect(markup).toContain("buy price seen turn 42");
  });

  it("nothing to trade", () => {
    const markup = renderToStaticMarkup(
      <TradePanel routes={[]} labelFor={labelFor} onSelectHex={() => {}} onDismiss={() => {}} />
    );
    expect(markup).toContain(
      "Nothing to trade yet. No hex you have seen sells a good that another will pay more for."
    );
    expect(markup).not.toContain("data-testid=\"trade-route-0\"");
  });

  it("selecting a route selects the hex it starts from", () => {
    const onSelectHex = vi.fn();
    const onDismiss = vi.fn();
    const element = (
      <TradePanel
        routes={[aTradeRoute()]}
        labelFor={labelFor}
        onSelectHex={onSelectHex}
        onDismiss={onDismiss}
      />
    );
    const row = findByTestId(element, "trade-route-0");
    expect(row).not.toBeNull();
    (row!.props.onClick as () => void)();
    expect(onSelectHex).toHaveBeenCalledWith("1:49,3");
    expect(onDismiss).toHaveBeenCalled();
  });

  it("the footer says what the list assumes", () => {
    const markup = renderToStaticMarkup(
      <TradePanel routes={[aTradeRoute()]} labelFor={labelFor} onSelectHex={() => {}} onDismiss={() => {}} />
    );
    expect(markup).toContain(
      "Prices are as last seen, and the journeys assume an unladen unit through hexes you have explored."
    );
  });

  it("hexes on different levels are written in full", () => {
    const route = aTradeRoute({
      from: { x: 7, y: 53, z: 2 },
      to: { x: 0, y: 48, z: 1 }
    });
    const markup = renderToStaticMarkup(
      <TradePanel routes={[route]} labelFor={labelFor} onSelectHex={() => {}} onDismiss={() => {}} />
    );
    expect(markup).toContain("2:7,53");
    expect(markup).toContain("1:0,48");
  });
});
