export type GameInfo = {
  id: string;
  name: string;
  rulesetVersion: string;
  maxFactionCount: number;
};

export type ProjectMetadata = {
  projectId: string;
  projectName: string;
};

export type ReportSourceRef = {
  sourceId: string;
  label: string;
};

export type ProjectManifest = {
  manifestVersion: number;
  metadata: ProjectMetadata;
  reportSources: ReportSourceRef[];
};

export type OpenedProject = {
  projectFilePath: string;
  databasePath: string;
  schemaVersion: number;
  manifest: ProjectManifest;
};

type GameInfoWireShape = {
  id: string;
  name: string;
  rulesetVersion?: string;
  ruleset_version?: string;
  maxFactionCount?: number;
  max_faction_count?: number;
};

type ProjectMetadataWireShape = {
  projectId?: string;
  project_id?: string;
  projectName?: string;
  project_name?: string;
};

type ReportSourceRefWireShape = {
  sourceId?: string;
  source_id?: string;
  label?: string;
};

type ProjectManifestWireShape = {
  manifestVersion?: number;
  manifest_version?: number;
  metadata?: ProjectMetadataWireShape;
  reportSources?: ReportSourceRefWireShape[];
  report_sources?: ReportSourceRefWireShape[];
};

type OpenedProjectWireShape = {
  projectFilePath?: string;
  project_file_path?: string;
  databasePath?: string;
  database_path?: string;
  schemaVersion?: number;
  schema_version?: number;
  manifest?: ProjectManifestWireShape;
};

export interface CoreAdapter {
  getGameInfo(): Promise<unknown> | unknown;
  createProject(projectFilePath: string, manifest: ProjectManifest): Promise<unknown> | unknown;
  openProject(projectFilePath: string): Promise<unknown> | unknown;
}

export interface CoreClient {
  getGameInfo(): Promise<GameInfo>;
  createProject(projectFilePath: string, manifest: ProjectManifest): Promise<OpenedProject>;
  openProject(projectFilePath: string): Promise<OpenedProject>;
}

export interface WasmBindings {
  get_game_info(): unknown;
  create_project_state(projectFilePath: string, manifest: ProjectManifest): unknown;
  open_project_state(projectFilePath: string): unknown;
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

function normalizeProjectMetadata(value: unknown): ProjectMetadata {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid project metadata payload");
  }

  const payload = value as ProjectMetadataWireShape;
  const projectId = payload.projectId ?? payload.project_id;
  const projectName = payload.projectName ?? payload.project_name;

  if (typeof projectId !== "string" || typeof projectName !== "string") {
    throw new Error("incomplete project metadata payload");
  }

  return {
    projectId,
    projectName
  };
}

function normalizeReportSourceRef(value: unknown): ReportSourceRef {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid report source payload");
  }

  const payload = value as ReportSourceRefWireShape;
  const sourceId = payload.sourceId ?? payload.source_id;

  if (typeof sourceId !== "string" || typeof payload.label !== "string") {
    throw new Error("incomplete report source payload");
  }

  return {
    sourceId,
    label: payload.label
  };
}

function normalizeProjectManifest(value: unknown): ProjectManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid project manifest payload");
  }

  const payload = value as ProjectManifestWireShape;
  const manifestVersion = payload.manifestVersion ?? payload.manifest_version;
  const reportSources = payload.reportSources ?? payload.report_sources;

  if (typeof manifestVersion !== "number" || !Array.isArray(reportSources) || payload.metadata === undefined) {
    throw new Error("incomplete project manifest payload");
  }

  return {
    manifestVersion,
    metadata: normalizeProjectMetadata(payload.metadata),
    reportSources: reportSources.map((source) => normalizeReportSourceRef(source))
  };
}

function normalizeOpenedProject(value: unknown): OpenedProject {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid opened project payload");
  }

  const payload = value as OpenedProjectWireShape;
  const projectFilePath = payload.projectFilePath ?? payload.project_file_path;
  const databasePath = payload.databasePath ?? payload.database_path;
  const schemaVersion = payload.schemaVersion ?? payload.schema_version;

  if (
    typeof projectFilePath !== "string" ||
    typeof databasePath !== "string" ||
    typeof schemaVersion !== "number" ||
    payload.manifest === undefined
  ) {
    throw new Error("incomplete opened project payload");
  }

  return {
    projectFilePath,
    databasePath,
    schemaVersion,
    manifest: normalizeProjectManifest(payload.manifest)
  };
}

export function createCoreClient(adapter: CoreAdapter): CoreClient {
  return {
    async getGameInfo() {
      const value = await adapter.getGameInfo();
      return normalizeGameInfo(value);
    },
    async createProject(projectFilePath: string, manifest: ProjectManifest) {
      const value = await adapter.createProject(projectFilePath, manifest);
      return normalizeOpenedProject(value);
    },
    async openProject(projectFilePath: string) {
      const value = await adapter.openProject(projectFilePath);
      return normalizeOpenedProject(value);
    }
  };
}

export function createWasmAdapter(bindings: WasmBindings): CoreAdapter {
  return {
    getGameInfo() {
      return bindings.get_game_info();
    },
    createProject(projectFilePath: string, manifest: ProjectManifest) {
      return bindings.create_project_state(projectFilePath, manifest);
    },
    openProject(projectFilePath: string) {
      return bindings.open_project_state(projectFilePath);
    }
  };
}

export function createTauriAdapter(invoke: TauriInvoke): CoreAdapter {
  return {
    getGameInfo() {
      return invoke<GameInfoWireShape>("get_game_info");
    },
    createProject(projectFilePath: string, manifest: ProjectManifest) {
      return invoke<OpenedProjectWireShape>("create_project", {
        project_file_path: projectFilePath,
        manifest
      });
    },
    openProject(projectFilePath: string) {
      return invoke<OpenedProjectWireShape>("open_project", {
        project_file_path: projectFilePath
      });
    }
  };
}
