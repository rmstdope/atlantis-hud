import { describe, expect, it } from "vitest";
import { messageSegments, plainMessage } from "./messageCode";

// `ah-41tqi`: a finding marks an order it suggests with backticks, shown in code style.
const SUGGESTION =
  "This unit holds no PIKE, so this TRANSPORT moves nothing. `TRANSPORT 5 35 PIKE` would draw on the 35 your sharing units hold.";

describe("messageSegments", () => {
  it("splits a backticked span out as code", () => {
    expect(messageSegments(SUGGESTION)).toEqual([
      { text: "This unit holds no PIKE, so this TRANSPORT moves nothing. ", code: false },
      { text: "TRANSPORT 5 35 PIKE", code: true },
      { text: " would draw on the 35 your sharing units hold.", code: false }
    ]);
  });

  it("leaves a message with no backticks as one text segment", () => {
    expect(messageSegments("unit 4021 is not building")).toEqual([
      { text: "unit 4021 is not building", code: false }
    ]);
  });

  it("keeps an unpaired backtick as text", () => {
    expect(messageSegments("a ` b")).toEqual([{ text: "a ` b", code: false }]);
    expect(messageSegments("`x` and ` y")).toEqual([
      { text: "x", code: true },
      { text: " and ` y", code: false }
    ]);
  });
});

describe("plainMessage", () => {
  it("drops the code markers and keeps the words", () => {
    expect(plainMessage(SUGGESTION)).toBe(
      "This unit holds no PIKE, so this TRANSPORT moves nothing. TRANSPORT 5 35 PIKE would draw on the 35 your sharing units hold."
    );
  });
});
