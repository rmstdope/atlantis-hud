import { describe, expect, it } from "vitest";
import { performOrdersSend } from "./sendOrders";
import type { OrdersUploadReply } from "./ordersUpload";

const REFUSED = '<div class="alert-danger"><h3>Faction password is incorrect.</h3></div>';

const run = (
  upload: (body: string) => Promise<OrdersUploadReply>,
  order: string[] = [],
  password = "s3cret"
) =>
  performOrdersSend({
    flush: async () => {
      order.push("flush");
    },
    upload: async (prepared) => {
      order.push("upload");
      return upload(prepared.body);
    },
    url: "https://atlantis-pbem.com/game/upload-orders",
    factionId: "42",
    password,
    ordersText: '#atlantis 42\n#end\n',
    boundary: "BOUND",
    signal: new AbortController().signal
  });

describe("sending a turn's orders", () => {
  it("flushes the draft before the request leaves", async () => {
    const order: string[] = [];
    await run(async () => ({ status: 200, body: "<pre>ok</pre>" }), order);
    expect(order).toEqual(["flush", "upload"]);
  });

  it("puts the password into the #atlantis line of what it sends, and nowhere on disk", async () => {
    let sent = "";
    await run(async (body) => {
      sent = body;
      return { status: 200, body: "<pre>ok</pre>" };
    });
    expect(sent).toContain('#atlantis 42 "s3cret"');
  });

  it("reads a refusal out of a 200, rather than calling it a success", async () => {
    const phase = await run(async () => ({ status: 200, body: REFUSED }));
    expect(phase).toEqual({ kind: "refused", reason: "Faction password is incorrect." });
  });

  it("calls a request that could not be made at all unreachable", async () => {
    const phase = await run(async () => {
      throw new Error("carries the response body, so it is never logged");
    });
    expect(phase).toEqual({ kind: "unreachable" });
  });

  it("refuses a password it cannot write into the header, without going near the network", async () => {
    const order: string[] = [];
    const phase = await run(async () => ({ status: 200, body: "<pre>ok</pre>" }), order, 'hunter"2');
    expect(phase.kind).toBe("refused");
    expect(order).not.toContain("upload");
  });
});
