import { describe, expect, it } from "vitest";

import {
  FETCH_DIALOG_TITLE,
  FETCH_WORKING,
  KEEP_WHAT_I_HAVE,
  LOAD_IT_AGAIN,
  REFUSED_WITHOUT_A_SENTENCE,
  UNREACHABLE,
  UNREADABLE,
  decideArrival,
  fetchMetaLine,
  keepTurnLabel,
  loadedStatus,
  newOriginsFetchIsReady,
  newerTurnQuestion,
  openTurnLabel,
  sameTurnQuestion,
  stillShowing
} from "./newOriginsFetchView";
import { FETCH_CONFIRM } from "./newAgeFetchView";

const HOST = "atlantis-pbem.com";

describe("fetchMetaLine", () => {
  it("names the faction, the turn and the address, dropping each part it does not know", () => {
    expect(
      fetchMetaLine({
        factionName: "Merchant Guild",
        factionNumber: "27",
        turnNumber: 83,
        host: HOST
      })
    ).toBe("Merchant Guild (27) · turn 83 · atlantis-pbem.com");
    expect(
      fetchMetaLine({ factionName: null, factionNumber: null, turnNumber: 83, host: HOST })
    ).toBe("turn 83 · atlantis-pbem.com");
    // A name without a number, and a number without a name, are both no faction at all.
    expect(
      fetchMetaLine({ factionName: "Merchant Guild", factionNumber: null, turnNumber: 83, host: HOST })
    ).toBe("turn 83 · atlantis-pbem.com");
    expect(
      fetchMetaLine({ factionName: null, factionNumber: "27", turnNumber: 83, host: HOST })
    ).toBe("turn 83 · atlantis-pbem.com");
    expect(
      fetchMetaLine({ factionName: null, factionNumber: null, turnNumber: null, host: HOST })
    ).toBe("atlantis-pbem.com");
  });
});

describe("the words", () => {
  it("quotes every sentence this dialog can show", () => {
    expect(FETCH_DIALOG_TITLE).toBe("Fetch from New Origins");
    expect(FETCH_CONFIRM).toBe("Fetch");
    expect(FETCH_WORKING).toBe("Fetching this turn's report from New Origins…");
    expect(newerTurnQuestion(83, 84)).toBe(
      "Turn 84 has arrived. Opening it replaces turn 83 on screen, and anything you have changed since it was loaded."
    );
    expect(keepTurnLabel(83)).toBe("Keep turn 83");
    expect(openTurnLabel(84)).toBe("Open turn 84");
    expect(sameTurnQuestion(83)).toBe(
      "New Origins still has turn 83 — the turn you already have. Loading it again replaces what is on screen, and anything you have changed since."
    );
    expect(KEEP_WHAT_I_HAVE).toBe("Keep what I have");
    expect(LOAD_IT_AGAIN).toBe("Load it again");
    expect(loadedStatus(84, 4, 11)).toBe("turn 84 loaded — 4 regions, 11 units.");
    expect(loadedStatus(84, 1, 1)).toBe("turn 84 loaded — 1 region, 1 unit.");
    expect(stillShowing(83)).toBe("still showing turn 83.");
    expect(REFUSED_WITHOUT_A_SENTENCE).toBe(
      "New Origins would not give up this turn's report. Check the faction number and password."
    );
    expect(UNREACHABLE).toBe("Could not reach atlantis-pbem.com.");
    expect(UNREADABLE).toBe(
      "atlantis-pbem.com answered with something Atlantis HUD could not read. The site may have changed — downloading the report in a browser and dropping it here still works."
    );
  });
});

describe("decideArrival", () => {
  it("asks about a newer turn and differently about the same one", () => {
    const mine = (turnNumber: number | null) => ({ factionId: "27", turnNumber });
    expect(decideArrival(null, mine(84))).toEqual({ kind: "load" });
    expect(decideArrival(mine(83), mine(84))).toEqual({
      kind: "askNewer",
      currentTurn: 83,
      incomingTurn: 84
    });
    expect(decideArrival(mine(83), mine(83))).toEqual({ kind: "askSame", turnNumber: 83 });
    expect(decideArrival(mine(83), mine(80))).toEqual({ kind: "storeOnly" });
    expect(decideArrival(mine(83), { factionId: "42", turnNumber: 83 })).toEqual({
      kind: "foreign"
    });
    // Age outranks ownership - gh-208.
    expect(decideArrival(mine(83), { factionId: "42", turnNumber: 80 })).toEqual({
      kind: "storeOnly"
    });
    // A question that cannot name both turns is not the question that was agreed.
    expect(decideArrival(mine(null), mine(84))).toEqual({ kind: "load" });
  });
});

describe("newOriginsFetchIsReady", () => {
  const ready = { kind: "ready", message: null, retype: false } as const;

  it("lets a password with a double quote through", () => {
    expect(newOriginsFetchIsReady("27", 'a"b', ready)).toBe(true);
  });

  it("refuses a blank field, a faction number that is not digits, and a phase that is working", () => {
    expect(newOriginsFetchIsReady("27", "hunter2", ready)).toBe(true);
    expect(newOriginsFetchIsReady("", "hunter2", ready)).toBe(false);
    expect(newOriginsFetchIsReady("27", "  ", ready)).toBe(false);
    expect(newOriginsFetchIsReady("foo", "hunter2", ready)).toBe(false);
    expect(newOriginsFetchIsReady("27", "hunter2", { kind: "fetching" })).toBe(false);
  });
});
