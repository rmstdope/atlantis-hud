import { describe, expect, it } from "vitest";
import { orderMentions } from "./gameDataOrderText";

const ORDERS = new Set(["GIVE", "FORM", "TURN", "TAKE", "TRANSPORT", "DISTRIBUTE", "END", "WORK"]);

describe("orderMentions (ah-mlls.6)", () => {
  it("links an order the text names as the rules write orders: capitals, then order", () => {
    expect(orderMentions("See the GIVE order for an example.", ORDERS, "FORM")).toEqual([
      { text: "See the " },
      { text: "GIVE", entryId: "order:GIVE" },
      { text: " order for an example." }
    ]);
  });

  it("links the plural too", () => {
    expect(orderMentions("or issue any more GIVE orders.", ORDERS, "FORM")).toEqual([
      { text: "or issue any more " },
      { text: "GIVE", entryId: "order:GIVE" },
      { text: " orders." }
    ]);
  });

  it("links every mention in a paragraph", () => {
    const parts = orderMentions("The TURN order and the TAKE order.", ORDERS, "GIVE");
    expect(parts.filter((part) => "entryId" in part).map((part) => part.text)).toEqual([
      "TURN",
      "TAKE"
    ]);
  });

  it("never links the entry's own order", () => {
    expect(orderMentions("The FORM order is followed by a list.", ORDERS, "FORM")).toEqual([
      { text: "The FORM order is followed by a list." }
    ]);
  });

  it("leaves every other spelling of an order alone", () => {
    for (const text of [
      "the order DISTRIBUTE can be used in place of TRANSPORT",
      "a caravan using TAKE FROM.",
      "terminated by the END keyword",
      "the default order WORK, as all newly created units do",
      "using the NEW keyword",
      "the give order",
      "a NEWS order"
    ]) {
      expect(orderMentions(text, ORDERS, "FORM")).toEqual([{ text }]);
    }
  });

  it("keeps the text whole, whatever it links", () => {
    const text = "GIVE order first, then a TURN order, then ordinary words.";
    expect(
      orderMentions(text, ORDERS, "FORM")
        .map((part) => part.text)
        .join("")
    ).toBe(text);
  });
});
