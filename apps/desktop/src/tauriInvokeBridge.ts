import { invoke } from "@tauri-apps/api/core";
import type { TauriInvoke } from "@atlantis/core-client";

export const tauriInvokeBridge: TauriInvoke = invoke;
