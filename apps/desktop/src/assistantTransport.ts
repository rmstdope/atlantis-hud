/**
 * The desktop's way for an assistant to reach the HUD's tools: the MCP server the Rust shell runs
 * (`src-tauri/src/assistant.rs`), which emits each call as `assistant://call` and takes the answer
 * back through `assistant_answer`. A call the client gave up on arrives as `assistant://withdrawn`,
 * which aborts that call's signal.
 *
 * Undefined in a plain browser, where there is no shell and so no server.
 */

import type { AssistantCall, AssistantTransport } from "@atlantis/shared";
import { hasTauriRuntime } from "./desktopCore";

export function desktopAssistantTransport(): AssistantTransport | undefined {
  // A stand-in a smoke test installs before the bundle runs, as `desktopPlugins` allows for its port.
  const standIn =
    typeof window === "undefined"
      ? undefined
      : (window as Window & { __ATLANTIS_DESKTOP_ASSISTANT__?: AssistantTransport }).__ATLANTIS_DESKTOP_ASSISTANT__;
  if (standIn) {
    return standIn;
  }
  if (!hasTauriRuntime()) {
    return undefined;
  }
  return {
    async connect(tools, onCall) {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      // One per call still being answered, so a withdrawal reaches the call it names and no other.
      const inFlight = new Map<number, AbortController>();
      const stopCalls = await listen<AssistantCall>("assistant://call", (event) => {
        const call = event.payload;
        const controller = new AbortController();
        inFlight.set(call.id, controller);
        void onCall(call, controller.signal)
          .catch((error: unknown) => ({
            text: `The HUD failed to answer: ${error instanceof Error ? error.message : String(error)}`,
            isError: true
          }))
          .then((answer) => {
            inFlight.delete(call.id);
            return invoke("assistant_answer", { id: call.id, answer });
          })
          .catch(() => {
            // The shell could not take the answer, so the relay's timeout fails the call.
          });
      });
      const stopWithdrawals = await listen<number>("assistant://withdrawn", (event) => {
        inFlight.get(event.payload)?.abort();
        inFlight.delete(event.payload);
      });
      await invoke("assistant_register_tools", { tools });
      return () => {
        stopCalls();
        stopWithdrawals();
      };
    },
    async connection() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke("assistant_connection");
    },
    requestAttention() {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("assistant_request_attention"))
        .catch(() => {
          // Nothing bounces; the prompt is on screen all the same.
        });
    },
    async writeFile(path, text) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("assistant_write_file", { path, text });
      } catch (error: unknown) {
        // The shell refuses with the sentence itself, which Tauri hands over as a bare string.
        throw error instanceof Error ? error : new Error(String(error));
      }
    }
  };
}
