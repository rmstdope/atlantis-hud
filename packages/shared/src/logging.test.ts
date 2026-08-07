import { describe, expect, it } from "vitest";
import { RingBufferLogger, toJsonLines } from "./logging";

describe("RingBufferLogger", () => {
  it("keeps entries in insertion order", () => {
    const logger = new RingBufferLogger("test-app");
    logger.write("info", "first");
    logger.write("error", "second");

    const entries = logger.snapshot();
    expect(entries.map((entry) => entry.message)).toEqual(["first", "second"]);
  });

  it("exports jsonl", () => {
    const logger = new RingBufferLogger("test-app");
    logger.write("warn", "warning");

    const jsonl = toJsonLines(logger.snapshot());
    expect(jsonl).toContain("\"message\":\"warning\"");
  });
});
