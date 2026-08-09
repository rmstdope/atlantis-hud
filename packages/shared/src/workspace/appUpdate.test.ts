import { describe, expect, it } from "vitest";
import { UPDATE_STATES, updatePresentationFor } from "./appUpdate";

describe("updatePresentationFor", () => {
  it("offers no control at all where updates cannot happen", () => {
    const presentation = updatePresentationFor("unsupported");

    expect(presentation.action).toBeNull();
    expect(presentation.message).not.toBeNull();
  });

  it("says nothing before a check has been asked for", () => {
    // The panel is opened to read the version far more often than to check for an update, so the
    // resting state is a button and no prose.
    expect(updatePresentationFor("idle")).toEqual({
      message: null,
      action: { label: "Check for updates", kind: "check" }
    });
  });

  it("keeps the button pressable while a check is running", () => {
    const presentation = updatePresentationFor("checking");

    expect(presentation.message).toBe("Checking…");
    expect(presentation.action?.kind).toBe("check");
  });

  it("reports that nothing is waiting", () => {
    expect(updatePresentationFor("current").message).toBe("You are on the latest version.");
    expect(updatePresentationFor("current").action?.kind).toBe("check");
  });

  it("switches the button from checking to applying once a version is waiting", () => {
    expect(updatePresentationFor("available")).toEqual({
      message: "A new version is ready.",
      action: { label: "Reload to update", kind: "apply" }
    });
  });

  it("confirms the desktop handoff to the browser", () => {
    // The desktop check cannot compare versions: this repository is private, so its releases are
    // invisible to an unauthenticated request. What it can do is hand the question to a browser
    // that is already signed in, and say so rather than appear to have done nothing.
    const presentation = updatePresentationFor("opened");

    expect(presentation.message).toBe("Opened the releases page in your browser.");
    expect(presentation.action?.kind).toBe("check");
  });

  it("presents every state it declares", () => {
    for (const state of UPDATE_STATES) {
      expect(() => updatePresentationFor(state)).not.toThrow();
    }
  });
});
