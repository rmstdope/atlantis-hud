import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantAnswer, AssistantCall } from "@atlantis/shared";
import { desktopAssistantTransport } from "./assistantTransport";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

const CALL: AssistantCall = { id: 7, name: "get_orders", arguments: {} };

/** Connects with `onCall`, and hands back what delivers a call the way the shell's event does. */
async function connectedWith(onCall: (call: AssistantCall) => Promise<AssistantAnswer>) {
  let deliver: (event: { payload: AssistantCall }) => void = () => undefined;
  listen.mockImplementation(async (_name: string, handler: typeof deliver) => {
    deliver = handler;
    return () => undefined;
  });
  await desktopAssistantTransport()!.connect([], onCall);
  return (call: AssistantCall) => deliver({ payload: call });
}

describe("desktopAssistantTransport", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers with an error when a tool call fails, rather than leaving the assistant waiting", async () => {
    const deliver = await connectedWith(() => Promise.reject(new Error("the window is gone")));

    deliver(CALL);

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("assistant_answer", {
        id: 7,
        answer: { text: "The HUD failed to answer: the window is gone", isError: true }
      })
    );
  });

  it("prefers a stand-in a smoke test installed, with no Tauri runtime present", () => {
    const standIn = { connect: vi.fn(), connection: vi.fn() };
    vi.stubGlobal("window", { __ATLANTIS_DESKTOP_ASSISTANT__: standIn });

    expect(desktopAssistantTransport()).toBe(standIn);
  });

  // Vitest fails the run on an unhandled rejection, which is what this one would be.
  it("lets the relay's timeout deal with an answer that cannot be sent", async () => {
    const deliver = await connectedWith(() => Promise.resolve({ text: "orders", isError: false }));
    invoke.mockRejectedValue(new Error("the shell is gone"));

    deliver(CALL);

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("assistant_answer", expect.anything()));
    await new Promise((settled) => setTimeout(settled, 0));
  });
});
