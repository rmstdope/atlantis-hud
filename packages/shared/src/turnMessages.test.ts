import { describe, expect, it } from "vitest";
import {
  groupTurnMessages,
  splitTurnMessage,
  splitTurnMessages,
  turnMessagesForUnit
} from "./turnMessages";

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

/**
 * The sample turn, as ah-7rd quotes it: the same units recur, scattered, and one line belongs to the
 * faction rather than to any unit.
 */
const SAMPLE = [
  "Times reward of 200 silver.",
  "Taxers (8047): Gives 50 silver [SILV] to Lookout (12159).",
  "Woodsmen (9431): Gives 20 wood [WOOD] to Smiths (11933).",
  "Taxers (8047): Claims $878.",
  "Taxers (8909): Gives 50 silver [SILV] to Unit (12160).",
  "Taxers (8047): Studies Combat.",
  "Taxers (8909): Gives 100 silver [SILV] to Carpenters (12881)."
];

describe("groupTurnMessages", () => {
  const group = (id: string | null) =>
    groupTurnMessages(splitTurnMessages(SAMPLE)).find((candidate) => candidate.unitId === id);

  it("groups a unit's events together, in report order", () => {
    expect(group("8047")?.messages.map((message) => message.text)).toEqual([
      "Gives 50 silver [SILV] to Lookout (12159).",
      "Claims $878.",
      "Studies Combat."
    ]);
  });

  it("puts the faction's own lines under General", () => {
    const general = group(null);

    expect(general?.unitName).toBeNull();
    expect(general?.messages.map((message) => message.text)).toEqual(["Times reward of 200 silver."]);
  });

  it("puts General first, and the units in the order the report met them", () => {
    expect(groupTurnMessages(splitTurnMessages(SAMPLE)).map((one) => one.unitId)).toEqual([
      null,
      "8047",
      "9431",
      "8909"
    ]);
  });

  it("omits General entirely when every line names a unit", () => {
    const groups = groupTurnMessages(splitTurnMessages(SAMPLE.slice(1)));

    expect(groups.map((one) => one.unitId)).toEqual(["8047", "9431", "8909"]);
  });

  it("does not file an event under a unit it merely mentions", () => {
    const groups = groupTurnMessages(splitTurnMessages(SAMPLE));

    expect(groups.map((one) => one.unitId)).not.toContain("12159");
    expect(
      groups.flatMap((one) => one.messages).filter((message) => message.text.includes("Lookout"))
    ).toHaveLength(1);
  });

  it("names a group from the first line that named the unit", () => {
    const groups = groupTurnMessages(
      splitTurnMessages(["Taxers (8047): Claims $878.", "Scouts (8047): Studies Combat."])
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.unitName).toBe("Taxers");
  });

  it("is empty for no messages", () => {
    expect(groupTurnMessages([])).toEqual([]);
  });
});

describe("turnMessagesForUnit", () => {
  it("returns only the lines the unit is the subject of, in report order", () => {
    const messages = splitTurnMessages([
      "Two of One (4150): Gives 50 silver [SILV] to Two of Seven (2172).",
      "Seven of Eight (18642): Claims $50.",
      "Two of One (4150): Gives 100 silver [SILV] to Drones (3139).",
    ]);

    expect(turnMessagesForUnit(messages, "4150").map((one) => one.text)).toEqual([
      "Gives 50 silver [SILV] to Two of Seven (2172).",
      "Gives 100 silver [SILV] to Drones (3139).",
    ]);
  });

  it("does not match a unit only named inside another unit's line", () => {
    const messages = splitTurnMessages([
      "Two of One (4150): Gives 50 silver [SILV] to Two of Seven (2172).",
    ]);

    expect(turnMessagesForUnit(messages, "2172")).toEqual([]);
  });
});
