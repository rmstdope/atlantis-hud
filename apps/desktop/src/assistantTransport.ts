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
  if (!hasTauriRuntime()) {
    return undefined;
  }
  return {
    async connect(tools, onCall) {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      const stop = await listen<AssistantCall>("assistant://call", (event) => {
        const call = event.payload;
        void onCall(call).then((answer) => invoke("assistant_answer", { id: call.id, answer }));
      });
      await invoke("assistant_register_tools", { tools });
      return stop;
    },
    async connection() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke("assistant_connection");
    }
  };
}
