import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantAnswer, AssistantCall } from "@atlantis/shared";
import { desktopAssistantTransport } from "./assistantTransport";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

const CALL: AssistantCall = { id: 7, name: "get_orders", arguments: {} };

type Handler = (event: { payload: unknown }) => void;

/** Connects with `onCall`, and hands back what delivers each of the shell's events. */
async function connectedTo(onCall: (call: AssistantCall, signal: AbortSignal) => Promise<AssistantAnswer>) {
  const handlers = new Map<string, Handler>();
  listen.mockImplementation(async (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return () => undefined;
  });
  await desktopAssistantTransport()!.connect([], onCall);
  return {
    call: (call: AssistantCall) => handlers.get("assistant://call")?.({ payload: call }),
    withdraw: (id: number) => handlers.get("assistant://withdrawn")?.({ payload: id })
  };
}

/** Connects with `onCall`, and hands back what delivers a call the way the shell's event does. */
async function connectedWith(onCall: (call: AssistantCall, signal: AbortSignal) => Promise<AssistantAnswer>) {
  return (await connectedTo(onCall)).call;
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

  it("writes a file the assistant asked for through the shell, which says why when it cannot", async () => {
    await desktopAssistantTransport()!.writeFile("/tmp/battle.json", "{}");

    expect(invoke).toHaveBeenCalledWith("assistant_write_file", { path: "/tmp/battle.json", text: "{}" });

    invoke.mockRejectedValue("the folder /nowhere does not exist");
    await expect(desktopAssistantTransport()!.writeFile("/nowhere/x.json", "{}")).rejects.toThrow(
      "the folder /nowhere does not exist"
    );
  });

  it("prefers a stand-in a smoke test installed, with no Tauri runtime present", () => {
    const standIn = { connect: vi.fn(), connection: vi.fn() };
    vi.stubGlobal("window", { __ATLANTIS_DESKTOP_ASSISTANT__: standIn });

    expect(desktopAssistantTransport()).toBe(standIn);
  });

  it("aborts a call's signal when the shell withdraws it, and no other call's", async () => {
    const signals = new Map<number, AbortSignal>();
    const shell = await connectedTo((call, signal) => {
      signals.set(call.id, signal);
      return new Promise(() => undefined);
    });

    shell.call(CALL);
    shell.call({ ...CALL, id: 8 });
    shell.withdraw(7);

    expect(signals.get(7)?.aborted).toBe(true);
    expect(signals.get(8)?.aborted).toBe(false);
  });

  it("asks the shell for the player's attention", async () => {
    desktopAssistantTransport()!.requestAttention?.();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("assistant_request_attention"));
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
