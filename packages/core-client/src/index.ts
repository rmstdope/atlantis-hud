export type GameInfo = {
  id: string;
  name: string;
  rulesetVersion: string;
  maxFactionCount: number;
};

type GameInfoWireShape = {
  id: string;
  name: string;
  rulesetVersion?: string;
  ruleset_version?: string;
  maxFactionCount?: number;
  max_faction_count?: number;
};

export interface CoreAdapter {
  getGameInfo(): Promise<unknown> | unknown;
}

export interface CoreClient {
  getGameInfo(): Promise<GameInfo>;
}

export interface WasmBindings {
  get_game_info(): unknown;
}

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function normalizeGameInfo(value: unknown): GameInfo {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid game info payload");
  }

  const payload = value as GameInfoWireShape;
  const rulesetVersion = payload.rulesetVersion ?? payload.ruleset_version;
  const maxFactionCount = payload.maxFactionCount ?? payload.max_faction_count;

  if (
    typeof payload.id !== "string" ||
    typeof payload.name !== "string" ||
    typeof rulesetVersion !== "string" ||
    typeof maxFactionCount !== "number"
  ) {
    throw new Error("incomplete game info payload");
  }

  return {
    id: payload.id,
    name: payload.name,
    rulesetVersion,
    maxFactionCount
  };
}

export function createCoreClient(adapter: CoreAdapter): CoreClient {
  return {
    async getGameInfo() {
      const value = await adapter.getGameInfo();
      return normalizeGameInfo(value);
    }
  };
}

export function createWasmAdapter(bindings: WasmBindings): CoreAdapter {
  return {
    getGameInfo() {
      return bindings.get_game_info();
    }
  };
}

export function createTauriAdapter(invoke: TauriInvoke): CoreAdapter {
  return {
    getGameInfo() {
      return invoke<GameInfoWireShape>("get_game_info");
    }
  };
}
