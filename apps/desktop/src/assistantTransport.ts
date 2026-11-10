/**
 * The desktop's way for an assistant to reach the HUD's tools: the MCP server the Rust shell runs
 * (`src-tauri/src/assistant.rs`), which emits each call as `assistant://call` and takes the answer
 * back through `assistant_answer`.
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
      const stop = await listen<AssistantCall>("assistant://call", (event) => {
        const call = event.payload;
        void onCall(call)
          .catch((error: unknown) => ({
            text: `The HUD failed to answer: ${error instanceof Error ? error.message : String(error)}`,
            isError: true
          }))
          .then((answer) => invoke("assistant_answer", { id: call.id, answer }))
          .catch(() => {
            // The shell could not take the answer, so the relay's timeout fails the call.
          });
      });
      await invoke("assistant_register_tools", { tools });
      return stop;
    },
    async connection() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke("assistant_connection");
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
