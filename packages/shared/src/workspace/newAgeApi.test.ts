import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HttpReply, HttpRequest, HttpTransport } from "./httpTransport";
import { newAgeClient, newAgeOrdersFormBody } from "./newAgeApi";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

/** A transport that records what it was asked and answers a canned reply. */
function fakeTransport(reply: HttpReply | (() => Promise<HttpReply>)): {
  transport: HttpTransport;
  calls: HttpRequest[];
} {
  const calls: HttpRequest[] = [];
  const transport: HttpTransport = async (request) => {
    calls.push(request);
    return typeof reply === "function" ? reply() : reply;
  };
  return { transport, calls };
}

const signal = new AbortController().signal;

describe("newAgeClient", () => {
  it("posts the world-scoped login as JSON and answers with the token", async () => {
    const { transport, calls } = fakeTransport({ status: 200, body: fixture("newage-login-ok.json") });

    const result = await newAgeClient(transport, "arcanum").login("27", "hunter2", signal);

    expect(calls).toEqual([
      {
        method: "POST",
        url: "https://atlantis-newage.com/api/worlds/arcanum/auth/login",
        headers: { "Content-Type": "application/json" },
        body: '{"faction_id":27,"password":"hunter2"}'
      }
    ]);
    expect(result).toEqual({
      kind: "ok",
      value: {
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        faction: { id: 3, name: "Merchant Guild", status: "active" }
      }
    });
  });

  it("reads a 401 as unauthorized", async () => {
    const { transport } = fakeTransport({ status: 401, body: fixture("newage-login-401.json") });

    expect(await newAgeClient(transport, "arcanum").login("27", "nope", signal)).toEqual({
      kind: "unauthorized"
    });
  });

  it("refuses a faction id that is not a plain number without sending anything", async () => {
    const { transport, calls } = fakeTransport({ status: 200, body: "{}" });

    const result = await newAgeClient(transport, "arcanum").login("new", "hunter2", signal);

    expect(result.kind).toBe("unsendable");
    expect(calls).toEqual([]);
  });

  it("answers unreachable when the transport rejects", async () => {
    const transport: HttpTransport = async () => {
      throw new Error("a rejection carrying the request body");
    };

    expect(await newAgeClient(transport, "arcanum").login("27", "hunter2", signal)).toEqual({
      kind: "unreachable"
    });
  });

  it("answers unreadable when a 200 carries no access token", async () => {
    const { transport } = fakeTransport({ status: 200, body: '{"token_type":"bearer"}' });

    expect(await newAgeClient(transport, "arcanum").login("27", "hunter2", signal)).toEqual({
      kind: "unreadable"
    });
  });

  it("refuses a world id that is not a plain slug", () => {
    const { transport } = fakeTransport({ status: 200, body: "{}" });

    expect(() => newAgeClient(transport, "../evil")).toThrow();
  });
});

describe("gameStatus", () => {
  it("asks the unauthenticated world status and reads the turn", async () => {
    const { transport, calls } = fakeTransport({
      status: 200,
      body: fixture("newage-game-status.json")
    });

    const result = await newAgeClient(transport, "arcanum").gameStatus(signal);

    expect(calls).toEqual([
      {
        method: "GET",
        url: "https://atlantis-newage.com/api/worlds/arcanum/game/status",
        headers: {}
      }
    ]);
    expect(calls[0]).not.toHaveProperty("body");
    expect(result).toEqual({
      kind: "ok",
      value: {
        turn: 83,
        deadline: "2026-09-06T08:36:32.435421+00:00",
        ordersReceived: [27],
        turnRunning: false,
        rulesetVersion: "1.2.0"
      }
    });
  });

  it("reads a non-401 failure as refused, carrying the server's own detail", async () => {
    const { transport } = fakeTransport({
      status: 503,
      body: '{"detail":"The world is being processed"}'
    });

    expect(await newAgeClient(transport, "arcanum").gameStatus(signal)).toEqual({
      kind: "refused",
      status: 503,
      detail: "The world is being processed"
    });
  });
});

describe("report and history", () => {
  it("asks for the txt report with the bearer token", async () => {
    const report = fixture("newage-report.txt");
    const { transport, calls } = fakeTransport({ status: 200, body: report });

    const result = await newAgeClient(transport, "arcanum").report("tok", signal);

    expect(calls).toEqual([
      {
        method: "GET",
        url: "https://atlantis-newage.com/api/worlds/arcanum/files/report?format=txt",
        headers: { Authorization: "Bearer tok" }
      }
    ]);
    expect(result).toEqual({ kind: "ok", value: report });
  });

  it("answers unauthorized when the token has expired", async () => {
    const { transport } = fakeTransport({ status: 401, body: '{"detail":"Not authenticated"}' });

    expect(await newAgeClient(transport, "arcanum").report("stale", signal)).toEqual({
      kind: "unauthorized"
    });
  });

  it("answers unreadable when the report comes back empty", async () => {
    const { transport } = fakeTransport({ status: 200, body: "   \n" });

    expect(await newAgeClient(transport, "arcanum").report("tok", signal)).toEqual({
      kind: "unreadable"
    });
  });

  it("reads a bare array of turn numbers", async () => {
    const { transport, calls } = fakeTransport({
      status: 200,
      body: fixture("newage-history-turns-array.json")
    });

    expect(await newAgeClient(transport, "arcanum").historyTurns("tok", signal)).toEqual({
      kind: "ok",
      value: [80, 81, 82]
    });
    expect(calls[0]).toEqual({
      method: "GET",
      url: "https://atlantis-newage.com/api/worlds/arcanum/files/history/turns",
      headers: { Authorization: "Bearer tok" }
    });
  });

  it("reads a turns object as well", async () => {
    const { transport } = fakeTransport({
      status: 200,
      body: fixture("newage-history-turns-object.json")
    });

    expect(await newAgeClient(transport, "arcanum").historyTurns("tok", signal)).toEqual({
      kind: "ok",
      value: [80, 81, 82]
    });
  });

  it("answers unreadable for a turn history in neither shape", async () => {
    const { transport } = fakeTransport({ status: 200, body: '{"latest": 82}' });

    expect(await newAgeClient(transport, "arcanum").historyTurns("tok", signal)).toEqual({
      kind: "unreadable"
    });
  });
});

describe("newAgeOrdersFormBody", () => {
  it("builds a single-file multipart form with CRLF line endings", () => {
    const { contentType, body } = newAgeOrdersFormBody("#atlantis 27", "BOUND");

    expect(contentType).toBe("multipart/form-data; boundary=BOUND");
    expect(body).toBe(
      "--BOUND\r\n" +
        'Content-Disposition: form-data; name="file"; filename="orders.txt"\r\n' +
        "Content-Type: text/plain\r\n" +
        "\r\n" +
        "#atlantis 27\r\n" +
        "--BOUND--\r\n"
    );
  });

  it("refuses orders containing the multipart boundary", () => {
    expect(() => newAgeOrdersFormBody("#atlantis 27\nBOUND\n#end\n", "BOUND")).toThrow();
  });
});

describe("uploadOrders", () => {
  it("posts the form with the bearer token and reads the verdict", async () => {
    const { transport, calls } = fakeTransport({
      status: 200,
      body: fixture("newage-orders-saved-invalid.json")
    });

    const result = await newAgeClient(transport, "arcanum").uploadOrders(
      "tok",
      "#atlantis 27",
      "BOUND",
      signal
    );

    expect(calls[0]?.url).toBe("https://atlantis-newage.com/api/worlds/arcanum/files/orders");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers).toEqual({
      Authorization: "Bearer tok",
      "Content-Type": "multipart/form-data; boundary=BOUND"
    });
    expect(result).toEqual({
      kind: "ok",
      value: {
        saved: true,
        valid: false,
        errorCount: 1,
        errors: ["INVALID_COMMAND is not a valid order."],
        warnings: [],
        message: "Orders saved with 1 syntax errors - please fix and re-upload"
      }
    });
  });

  it("never carries raw_output into the verdict", async () => {
    const { transport } = fakeTransport({
      status: 200,
      body: fixture("newage-orders-saved-invalid.json")
    });

    const result = await newAgeClient(transport, "arcanum").uploadOrders(
      "tok",
      "#atlantis 27",
      "BOUND",
      signal
    );

    expect(JSON.stringify(result)).not.toContain("raw_output");
    expect(JSON.stringify(result)).not.toContain("*** Error");
  });

  it("reads an error entry that spells its text `msg` as well as one that spells it `message`", async () => {
    const { transport } = fakeTransport({
      status: 200,
      body: JSON.stringify({
        saved: true,
        valid: false,
        error_count: 2,
        errors: [{ msg: "spelled msg" }, { message: "spelled message" }],
        warnings: ["a warning"],
        message: "two errors"
      })
    });

    const result = await newAgeClient(transport, "arcanum").uploadOrders(
      "tok",
      "#atlantis 27",
      "BOUND",
      signal
    );

    expect(result).toEqual({
      kind: "ok",
      value: {
        saved: true,
        valid: false,
        errorCount: 2,
        errors: ["spelled msg", "spelled message"],
        warnings: ["a warning"],
        message: "two errors"
      }
    });
  });

  it("redacts a faction header line out of everything the verdict carries", async () => {
    const { transport } = fakeTransport({
      status: 200,
      body: JSON.stringify({
        saved: true,
        valid: false,
        error_count: 1,
        errors: [{ msg: '  #atlantis 27 "hunter2"\nbad order' }],
        warnings: [],
        message: '#atlantis 27 "hunter2"'
      })
    });

    const result = await newAgeClient(transport, "arcanum").uploadOrders(
      "tok",
      "#atlantis 27",
      "BOUND",
      signal
    );

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("hunter2");
    expect(serialised).toContain("#atlantis [redacted]");
  });

  it("refuses orders containing the boundary through the client too", async () => {
    const { transport, calls } = fakeTransport({ status: 200, body: "{}" });

    const result = await newAgeClient(transport, "arcanum").uploadOrders(
      "tok",
      "#atlantis 27\nBOUND\n",
      "BOUND",
      signal
    );

    expect(result.kind).toBe("unsendable");
    expect(calls).toEqual([]);
  });
});
