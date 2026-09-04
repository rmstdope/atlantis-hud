import { describe, expect, it } from "vitest";

import {
  NO_NEW_AGE_SESSIONS,
  newAgeFactionOf,
  newAgeSessionFor,
  withNewAgeSession,
  withoutNewAgeSession,
  type NewAgeSession
} from "./newAgeSession";

const arcanum: NewAgeSession = {
  worldId: "arcanum",
  factionId: "27",
  factionName: "Merchant Guild",
  token: "token-a"
};
const trident: NewAgeSession = {
  worldId: "trident",
  factionId: "4",
  factionName: "Sea Wolves",
  token: "token-b"
};

describe("newAgeSession", () => {
  it("keeps one session per game", () => {
    const first = withNewAgeSession(NO_NEW_AGE_SESSIONS, "game-1", arcanum);
    const both = withNewAgeSession(first, "game-2", trident);
    expect(newAgeSessionFor(both, "game-1", "arcanum")).toEqual(arcanum);
    expect(newAgeSessionFor(both, "game-2", "trident")).toEqual(trident);
    expect(NO_NEW_AGE_SESSIONS).toEqual({});
    expect(Object.keys(first)).toEqual(["game-1"]);
  });

  it("does not offer a session minted for another world", () => {
    const sessions = withNewAgeSession(NO_NEW_AGE_SESSIONS, "game-1", arcanum);
    expect(newAgeSessionFor(sessions, "game-1", "trident")).toBeNull();
    expect(newAgeSessionFor(sessions, "game-1", null)).toBeNull();
  });

  it("has no session for a game that never signed in, or for no game at all", () => {
    const sessions = withNewAgeSession(NO_NEW_AGE_SESSIONS, "game-1", arcanum);
    expect(newAgeSessionFor(sessions, "game-9", "arcanum")).toBeNull();
    expect(newAgeSessionFor(sessions, null, "arcanum")).toBeNull();
  });

  it("forgets one game's session and leaves the other", () => {
    const both = withNewAgeSession(
      withNewAgeSession(NO_NEW_AGE_SESSIONS, "game-1", arcanum),
      "game-2",
      trident
    );
    const left = withoutNewAgeSession(both, "game-1");
    expect(newAgeSessionFor(left, "game-1", "arcanum")).toBeNull();
    expect(newAgeSessionFor(left, "game-2", "trident")).toEqual(trident);
    expect(newAgeSessionFor(both, "game-1", "arcanum")).toEqual(arcanum);
  });

  it("reads a session as the faction the label helpers take", () => {
    expect(newAgeFactionOf(arcanum)).toEqual({ id: "27", name: "Merchant Guild", status: "" });
  });
});
