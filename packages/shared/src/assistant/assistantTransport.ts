/**
 * How a shell lets an assistant reach the tools in `assistantTools`.
 *
 * Injected into `AppShell` like every other platform port. Only the desktop has one: it serves the
 * tools over MCP on a loopback port (`crates/assistant-mcp`). The web build has no process a client
 * could connect to, and passes nothing.
 */

import { useEffect, useRef } from "react";
import { newAssistantSeen } from "./assistantSeen";
import { ASSISTANT_TOOLS, answerToolCall, type AssistantAnswer, type AssistantHost } from "./assistantTools";
import type { AssistantToolDefinition } from "./assistantTools";

/** One call the assistant made, as the shell hands it over. */
export interface AssistantCall {
  readonly id: number;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/** Where the assistant connects, as the settings dialog shows it. */
export interface AssistantConnection {
  readonly url: string;
  readonly token: string;
  /** Why the server is not listening, or `null` when it is. */
  readonly error: string | null;
}

export interface AssistantTransport {
  /**
   * Registers `tools` and hands every call to `onCall`, sending back what it answers. Resolves to
   * the function that stops listening.
   */
  connect(
    tools: readonly AssistantToolDefinition[],
    onCall: (call: AssistantCall) => Promise<AssistantAnswer>
  ): Promise<() => void>;
  /** Where the assistant connects. */
  connection(): Promise<AssistantConnection>;
}

/**
 * The command that connects Claude Code to this HUD, ready to paste into a terminal.
 *
 * `--scope user` so it is there in every directory, which is what a separate agent repository
 * needs; the token is the HUD's own and stays the same between launches.
 */
export function claudeAddCommand(connection: AssistantConnection): string {
  return `claude mcp add --scope user --transport http atlantis-hud ${connection.url} --header "Authorization: Bearer ${connection.token}"`;
}

/**
 * Keeps the assistant connected for as long as the shell is mounted.
 *
 * `host` is read through a ref, so a call is always answered from the turn on screen when it
 * arrives rather than the one there was when the transport connected. What the assistant has seen of
 * each unit's orders is kept here, between calls, for `list_order_edits` (ah-a97xg.10).
 */
export function useAssistant(transport: AssistantTransport | undefined, host: Omit<AssistantHost, "seen">): void {
  const latest = useRef(host);
  latest.current = host;
  const seen = useRef(newAssistantSeen());

  useEffect(() => {
    if (!transport) {
      return;
    }
    let stop: (() => void) | null = null;
    let unmounted = false;
    void transport
      .connect(ASSISTANT_TOOLS, (call) => answerToolCall({ ...latest.current, seen: seen.current }, call.name, call.arguments))
      .then((stopListening) => {
        if (unmounted) {
          stopListening();
        } else {
          stop = stopListening;
        }
      })
      .catch(() => {
        // No assistant is a HUD that works exactly as it did; the settings dialog says why.
      });
    return () => {
      unmounted = true;
      stop?.();
    };
  }, [transport]);
}
