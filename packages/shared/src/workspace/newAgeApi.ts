/**
 * Talking to an Atlantis New Age world's REST API, and understanding what it said back.
 *
 * The whole of the logic is here and pure: building the requests the five endpoints the HUD needs
 * expect, and reading a value or a named failure out of each reply. Performing the request is a
 * shell's job, through `HttpTransport` - only the desktop has one, because `atlantis-newage.com`
 * allowlists CORS origins and the live web deploy is not on the list (probed 2026-09-04).
 *
 * **The reply bodies are secret.** An orders document's first line is `#atlantis <id> "<password>"`
 * in cleartext, and the server echoes it in its validation output. So nothing here logs a request,
 * a reply, a header or an error object; a transport rejection is caught and discarded unexamined,
 * the rule `sendOrders.ts` already follows, and everything a caller can see passes through
 * `redactFactionHeader`.
 *
 * The client holds no state beyond its world id: every authenticated call takes its token as an
 * argument. The session and the token's lifetime belong to the bead that adds the sign-in prompt;
 * a token cached here would be a second place that has to be cleared.
 */

import type { HttpReply, HttpRequest, HttpTransport } from "./httpTransport";

/** The one host this client talks to. Not configurable: the Tauri capability pins the same host. */
export const NEW_AGE_API_ORIGIN = "https://atlantis-newage.com";

/** What came back from a public faction record. `id` is `number | string` in the served spec. */
export type NewAgeFaction = { id: number | string; name: string; status: string };

export type NewAgeLogin = { accessToken: string; faction: NewAgeFaction };

export type NewAgeGameStatus = {
  turn: number;
  deadline: string | null;
  ordersReceived: number[];
  turnRunning: boolean;
  rulesetVersion: string | null;
};

/** The server's judgement on an orders upload, with every secret already stripped. */
export type NewAgeOrderVerdict = {
  saved: boolean;
  valid: boolean;
  errorCount: number;
  errors: string[];
  warnings: string[];
  message: string;
};

/** Why a call did not produce a value. Exhaustive: there is no sixth kind. */
export type NewAgeFailure =
  | { kind: "unsendable"; reason: string }
  | { kind: "unreachable" }
  | { kind: "unauthorized" }
  | { kind: "refused"; status: number; detail: string | null }
  | { kind: "unreadable" };

export type NewAgeResult<T> = { kind: "ok"; value: T } | NewAgeFailure;

export type NewAgeClient = {
  readonly worldId: string;
  login(
    factionId: string,
    password: string,
    signal: AbortSignal
  ): Promise<NewAgeResult<NewAgeLogin>>;
  gameStatus(signal: AbortSignal): Promise<NewAgeResult<NewAgeGameStatus>>;
  report(token: string, signal: AbortSignal): Promise<NewAgeResult<string>>;
  historyTurns(token: string, signal: AbortSignal): Promise<NewAgeResult<number[]>>;
  uploadOrders(
    token: string,
    ordersText: string,
    boundary: string,
    signal: AbortSignal
  ): Promise<NewAgeResult<NewAgeOrderVerdict>>;
};

/**
 * A world id is interpolated into a URL path, so anything but a plain slug could address a
 * different endpoint entirely - a `..` segment most obviously. World ids come from a fixed table,
 * so a bad one is a programming mistake rather than a runtime condition: this throws.
 */
const WORLD_ID = /^[a-z0-9-]+$/;

/** `#atlantis <id> "<password>"`, wherever it appears - see `ordersUpload.ts` for why anywhere. */
const FACTION_HEADER_LINE = /^[ \t]*#atlantis\b.*$/gim;

/** Every `#atlantis ...` line rewritten to `#atlantis [redacted]`. */
export function redactFactionHeader(text: string): string {
  return text.replace(FACTION_HEADER_LINE, "#atlantis [redacted]");
}

/**
 * The single-`file` multipart form `POST .../files/orders` expects, byte for byte.
 *
 * Hand-built rather than delegated to `FormData`, for the reason `ordersUploadBody` gives: what
 * goes on the wire is then exactly what a unit test pins. A new function rather than a parameter
 * on that one - New Age wants one `file` part where `atlantis-pbem.com` wants three fields.
 */
export function newAgeOrdersFormBody(
  ordersText: string,
  boundary: string
): { contentType: string; body: string } {
  if (!/^[A-Za-z0-9'()+_,\-./:=?]{1,70}$/.test(boundary)) {
    throw new Error("The multipart boundary is not one a form can carry.");
  }
  if (ordersText.includes(boundary)) {
    throw new Error("The multipart boundary occurs in what is being sent.");
  }
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body:
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="orders.txt"\r\n' +
      "Content-Type: text/plain\r\n\r\n" +
      `${ordersText}\r\n` +
      `--${boundary}--\r\n`
  };
}

/** Throws on a world id that is not a plain slug. */
export function newAgeClient(transport: HttpTransport, worldId: string): NewAgeClient {
  if (!WORLD_ID.test(worldId)) {
    throw new Error("That is not a world id this client can address.");
  }
  const base = `${NEW_AGE_API_ORIGIN}/api/worlds/${worldId}`;

  async function send<T>(
    request: HttpRequest,
    signal: AbortSignal,
    read: (reply: HttpReply) => NewAgeResult<T>
  ): Promise<NewAgeResult<T>> {
    let reply: HttpReply;
    try {
      reply = await transport(request, signal);
    } catch {
      // Discarded unexamined: an HTTP client's error object can carry the response body, and a
      // reply in this family carries a password.
      return { kind: "unreachable" };
    }
    if (reply.status === 401) {
      return { kind: "unauthorized" };
    }
    if (reply.status < 200 || reply.status > 299) {
      return { kind: "refused", status: reply.status, detail: errorDetail(reply.body) };
    }
    return read(reply);
  }

  const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

  return {
    worldId,

    async login(factionId, password, signal) {
      if (!/^\d+$/.test(factionId)) {
        return { kind: "unsendable", reason: "The faction id must be a plain number." };
      }
      return send(
        {
          method: "POST",
          url: `${base}/auth/login`,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ faction_id: Number(factionId), password })
        },
        signal,
        (reply) => readLogin(reply.body)
      );
    },

    async gameStatus(signal) {
      return send({ method: "GET", url: `${base}/game/status`, headers: {} }, signal, (reply) =>
        readGameStatus(reply.body)
      );
    },

    async report(token, signal) {
      return send(
        { method: "GET", url: `${base}/files/report?format=txt`, headers: bearer(token) },
        signal,
        (reply): NewAgeResult<string> =>
          reply.body.trim() === ""
            ? { kind: "unreadable" }
            : { kind: "ok", value: reply.body }
      );
    },

    async historyTurns(token, signal) {
      return send(
        { method: "GET", url: `${base}/files/history/turns`, headers: bearer(token) },
        signal,
        (reply) => readHistoryTurns(reply.body)
      );
    },

    async uploadOrders(token, ordersText, boundary, signal) {
      let form: { contentType: string; body: string };
      try {
        form = newAgeOrdersFormBody(ordersText, boundary);
      } catch (error) {
        return {
          kind: "unsendable",
          reason: error instanceof Error ? error.message : "These orders cannot be sent as written."
        };
      }
      return send(
        {
          method: "POST",
          url: `${base}/files/orders`,
          headers: { ...bearer(token), "Content-Type": form.contentType },
          body: form.body
        },
        signal,
        (reply) => readVerdict(reply.body)
      );
    }
  };
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `ErrorResponse.detail` when the body carries one as a string, else nothing. */
function errorDetail(body: string): string | null {
  const parsed = parse(body);
  if (isRecord(parsed) && typeof parsed.detail === "string") {
    return redactFactionHeader(parsed.detail);
  }
  return null;
}

function readLogin(body: string): NewAgeResult<NewAgeLogin> {
  const parsed = parse(body);
  if (!isRecord(parsed) || typeof parsed.access_token !== "string" || parsed.access_token === "") {
    return { kind: "unreadable" };
  }
  const faction = parsed.faction;
  if (
    !isRecord(faction) ||
    (typeof faction.id !== "number" && typeof faction.id !== "string") ||
    typeof faction.name !== "string" ||
    typeof faction.status !== "string"
  ) {
    return { kind: "unreadable" };
  }
  return {
    kind: "ok",
    value: {
      accessToken: parsed.access_token,
      faction: { id: faction.id, name: faction.name, status: faction.status }
    }
  };
}

function readGameStatus(body: string): NewAgeResult<NewAgeGameStatus> {
  const parsed = parse(body);
  if (!isRecord(parsed) || typeof parsed.turn !== "number") {
    return { kind: "unreadable" };
  }
  const received = Array.isArray(parsed.orders_received)
    ? parsed.orders_received.filter((entry): entry is number => typeof entry === "number")
    : [];
  return {
    kind: "ok",
    value: {
      turn: parsed.turn,
      deadline: typeof parsed.deadline === "string" ? parsed.deadline : null,
      ordersReceived: received,
      turnRunning: parsed.turn_running === true,
      rulesetVersion: typeof parsed.ruleset_version === "string" ? parsed.ruleset_version : null
    }
  };
}

/**
 * The served spec declares no response schema for `files/history/turns` and it needs a bearer
 * token, so it could not be probed: a bare array and a `{turns: [...]}` object are the two shapes
 * accepted, and anything else is `unreadable` rather than a third guess.
 */
function readHistoryTurns(body: string): NewAgeResult<number[]> {
  const parsed = parse(body);
  const turns = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.turns)
      ? parsed.turns
      : undefined;
  if (!turns || !turns.every((entry) => typeof entry === "number")) {
    return { kind: "unreadable" };
  }
  return { kind: "ok", value: turns as number[] };
}

/**
 * The verdict, with `raw_output` dropped at the parse - it is the full checker output over a
 * document whose first line carries the password - and every remaining string redacted.
 *
 * `saved` can be `true` while `valid` is `false`: the server saves syntactically broken orders as
 * long as the envelope is right. Never derive one from the other.
 */
function readVerdict(body: string): NewAgeResult<NewAgeOrderVerdict> {
  const parsed = parse(body);
  if (!isRecord(parsed) || typeof parsed.saved !== "boolean" || typeof parsed.valid !== "boolean") {
    return { kind: "unreadable" };
  }
  return {
    kind: "ok",
    value: {
      saved: parsed.saved,
      valid: parsed.valid,
      errorCount: typeof parsed.error_count === "number" ? parsed.error_count : 0,
      errors: Array.isArray(parsed.errors) ? parsed.errors.flatMap(errorText) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.flatMap(errorText) : [],
      message: typeof parsed.message === "string" ? redactFactionHeader(parsed.message) : ""
    }
  };
}

/**
 * The spec contradicts itself about an order error's field name: `ValidationError` requires `msg`,
 * while the same schema's own example spells it `message`. Read either, drop anything else.
 */
function errorText(entry: unknown): string[] {
  if (typeof entry === "string") {
    return [redactFactionHeader(entry)];
  }
  if (isRecord(entry)) {
    if (typeof entry.msg === "string") {
      return [redactFactionHeader(entry.msg)];
    }
    if (typeof entry.message === "string") {
      return [redactFactionHeader(entry.message)];
    }
  }
  return [];
}
