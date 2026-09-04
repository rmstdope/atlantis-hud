/**
 * The signed-in New Age sessions an app is holding, one per game, in memory and nowhere else.
 *
 * Nothing here is persisted: no store, no settings key, no `localStorage`. A reload signs the
 * player out, which is the navigator's decision on `ah-lbd9` made mechanical.
 */

import type { NewAgeFaction } from "./newAgeApi";

/**
 * A signed-in session. `token` is a secret: it is never persisted, never logged, and never
 * rendered - only put in an `Authorization` header by `newAgeApi.ts`.
 */
export type NewAgeSession = {
  /** The API world this token is good for. A game whose ruleset changed must not keep it. */
  worldId: string;
  factionId: string;
  factionName: string;
  token: string;
};

/** Sessions by game id. Nothing outside a running app ever holds one. */
export type NewAgeSessions = Readonly<Record<string, NewAgeSession>>;

export const NO_NEW_AGE_SESSIONS: NewAgeSessions = {};

/**
 * This game's session, or `null` - including when it was made for a different world.
 *
 * The world check is what makes a per-game session safe: a game's ruleset can be changed in
 * Settings, and a token minted for `arcanum` is not good for `trident`. Answering `null` puts the
 * control back to signed out rather than presenting a token the world will reject.
 */
export function newAgeSessionFor(
  sessions: NewAgeSessions,
  gameId: string | null,
  worldId: string | null
): NewAgeSession | null {
  if (gameId === null || worldId === null) {
    return null;
  }
  const session = sessions[gameId];
  return session !== undefined && session.worldId === worldId ? session : null;
}

export function withNewAgeSession(
  sessions: NewAgeSessions,
  gameId: string,
  session: NewAgeSession
): NewAgeSessions {
  return { ...sessions, [gameId]: session };
}

export function withoutNewAgeSession(sessions: NewAgeSessions, gameId: string): NewAgeSessions {
  const rest = { ...sessions };
  delete rest[gameId];
  return rest;
}

/**
 * The session as the label helpers read a faction, so they keep one argument type and a session
 * does not have to store a whole `NewAgeFaction`.
 */
export function newAgeFactionOf(session: NewAgeSession): NewAgeFaction {
  return { id: session.factionId, name: session.factionName, status: "" };
}
