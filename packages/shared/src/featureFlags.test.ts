import { describe, expect, it } from "vitest";
import { resolveFeatureFlags } from "./featureFlags";

describe("resolveFeatureFlags", () => {
  it("uses file flags when no env overrides are present", () => {
    const flags = resolveFeatureFlags({ enableStructuredLoggingDemo: false }, {});
    expect(flags.enableStructuredLoggingDemo).toBe(false);
  });

  it("env overrides local file values when recognized", () => {
    const flags = resolveFeatureFlags(
      { enableStructuredLoggingDemo: false },
      { ATLANTIS_FLAG_ENABLE_STRUCTURED_LOGGING_DEMO: "true" }
    );
    expect(flags.enableStructuredLoggingDemo).toBe(true);
  });
});
