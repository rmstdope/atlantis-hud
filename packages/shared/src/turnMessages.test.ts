import { describe, expect, it } from "vitest";
import { describeTurnMessages, splitTurnMessage, splitTurnMessages } from "./turnMessages";

/**
 * Every line below is copied out of `tests/fixtures/reports`, so what is asserted here is what the
 * engine actually prints rather than what a rule would like it to.
 */
describe("splitTurnMessage", () => {
  it("splits a unit, a verb and a message", () => {
    expect(
      splitTurnMessage("Unit (1387): BUY: Unit attempted to buy more than it could afford.")
    ).toEqual({
      unitId: "1387",
      unitName: "Unit",
      verb: "BUY",
      text: "Unit attempted to buy more than it could afford.",
      raw: "Unit (1387): BUY: Unit attempted to buy more than it could afford."
    });
  });

  it("reads a verb on a line that names no unit", () => {
    const message = splitTurnMessage("DECLARE: Can't declare towards your own faction.");

    expect(message.unitId).toBeNull();
    expect(message.unitName).toBeNull();
    expect(message.verb).toBe("DECLARE");
    expect(message.text).toBe("Can't declare towards your own faction.");
  });

  it("keeps a name of several words", () => {
    const message = splitTurnMessage("Seven of Eight (18642): Claims $50.");

    expect(message.unitName).toBe("Seven of Eight");
    expect(message.unitId).toBe("18642");
    // "Claims" is not an order. Mixed case is what tells it apart from one.
    expect(message.verb).toBeNull();
    expect(message.text).toBe("Claims $50.");
  });

  it("stops at the first bracketed id rather than a later one", () => {
    const message = splitTurnMessage("Three of Five (793): Teaches force to Unit (1382).");

    expect(message.unitId).toBe("793");
    expect(message.text).toBe("Teaches force to Unit (1382).");
  });

  it("leaves a line that names nobody alone", () => {
    expect(splitTurnMessage("Times reward of 200 silver.")).toEqual({
      unitId: null,
      unitName: null,
      verb: null,
      text: "Times reward of 200 silver.",
      raw: "Times reward of 200 silver."
    });
  });

  it("leaves a unit named mid-sentence alone", () => {
    // No colon after the bracket, so this is prose rather than a prefix. Taking one off would
    // leave a message beginning "is caught", and the acting unit would read as the victim.
    const line =
      "Cpt Stanley (13423) is caught attempting to steal from Cpt Stu (14677) in Nurplishglen.";
    const message = splitTurnMessage(line);

    expect(message.unitId).toBeNull();
    expect(message.verb).toBeNull();
    expect(message.text).toBe(line);
  });

  it("keeps the line as printed whatever it did with it", () => {
    const line = "  Unit (1387): STUDY: Not enough funds.  ";
    const message = splitTurnMessage(line);

    expect(message.text).toBe("Not enough funds.");
    expect(message.raw).toBe(line);
  });

  it("trims a line it recognised nothing in, and still keeps the original", () => {
    // The report wraps long lines and the unwrapper joins them with the indent still attached, so
    // an unrecognised line arrives padded. `text` is for reading; `raw` is what was printed.
    const line = "  Times reward of 200 silver.  ";
    const message = splitTurnMessage(line);

    expect(message.text).toBe("Times reward of 200 silver.");
    expect(message.raw).toBe(line);
  });
});

describe("splitTurnMessages", () => {
  it("keeps the order the report printed", () => {
    const messages = splitTurnMessages([
      "Unit (1387): BUY: Unit attempted to buy more than it could afford.",
      "Unit (1387): STUDY: Not enough funds."
    ]);

    expect(messages.map((message) => message.verb)).toEqual(["BUY", "STUDY"]);
  });
});

describe("describeTurnMessages", () => {
  it("names both counts", () => {
    expect(describeTurnMessages(3, 12)).toBe("3 errors · 12 events");
  });

  it("leaves out a count of nothing", () => {
    expect(describeTurnMessages(0, 12)).toBe("12 events");
    expect(describeTurnMessages(1, 0)).toBe("1 error");
  });

  it("has nothing to say about a turn with neither", () => {
    expect(describeTurnMessages(0, 0)).toBeNull();
  });
});
