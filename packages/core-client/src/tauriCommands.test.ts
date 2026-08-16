import { describe, expect, it, vi } from "vitest";
import { createTauriAdapter, TAURI_COMMANDS, type TauriInvoke } from "./tauriCommands";
import type { CoreAdapter } from "./index";

type Invocation = Record<string, (...args: unknown[]) => Promise<unknown>>;

describe("TAURI_COMMANDS", () => {
  it("builds an adapter with exactly the table's methods", () => {
    const invoke: TauriInvoke = vi.fn();
    const adapter = createTauriAdapter(invoke);
    expect(Object.keys(adapter).sort()).toEqual(Object.keys(TAURI_COMMANDS).sort());
  });

  it("invokes each row's command with its keys, in parameter order", async () => {
    for (const [method, [command, ...keys]] of Object.entries(TAURI_COMMANDS)) {
      const invoke = vi.fn().mockResolvedValue("answer");
      const adapter = createTauriAdapter(invoke) as unknown as Invocation;
      const args = keys.map((_, index) => `arg${index}`);

      await expect(adapter[method](...args)).resolves.toBe("answer");

      expect(invoke).toHaveBeenCalledWith(
        command,
        Object.fromEntries(keys.map((key, index) => [key, `arg${index}`]))
      );
    }
  });

  it("passes an explicit null through as null, never as undefined or a string", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const adapter = createTauriAdapter(invoke) as unknown as CoreAdapter;

    await adapter.validateOrders("raw orders", null, null, null);

    expect(invoke).toHaveBeenCalledWith("validate_orders", {
      raw_orders: "raw orders",
      ruleset_json: null,
      raw_report: null,
      disabled_codes: null
    });
  });
});
