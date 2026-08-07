import { useMemo, useState, type DragEvent } from "react";

type ReportParseResult = {
  turnHeader: { turnNumber: number } | null;
  detectedFactions: Array<{ factionId: string; name: string }>;
  warnings: Array<unknown>;
  meetsMinimumImportThreshold: boolean;
};

type ReportImportPreview = {
  duplicatePreview: {
    exists: boolean;
    rawChanged: boolean;
    parsedChanged: boolean;
    warningsChanged: boolean;
  };
};

type CoreClientLike = {
  parseReport(rawReport: string): Promise<ReportParseResult>;
  previewReportImport(
    databasePath: string,
    projectId: string,
    confirmedFactionId: string,
    rawReport: string
  ): Promise<ReportImportPreview>;
  commitReportImport(
    databasePath: string,
    projectId: string,
    confirmedFactionId: string,
    rawReport: string,
    allowOverwrite: boolean
  ): Promise<unknown>;
};

type ReportImportPanelProps = {
  client: CoreClientLike;
};

export function ReportImportPanel({ client }: ReportImportPanelProps) {
  const [databasePath, setDatabasePath] = useState("");
  const [projectId, setProjectId] = useState("");
  const [reportText, setReportText] = useState("");
  const [parseResult, setParseResult] = useState<ReportParseResult | null>(null);
  const [confirmedFactionId, setConfirmedFactionId] = useState("");
  const [preview, setPreview] = useState<ReportImportPreview | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [allowOverwrite, setAllowOverwrite] = useState(false);

  const canPreviewOrImport = useMemo(
    () =>
      databasePath.trim().length > 0 &&
      projectId.trim().length > 0 &&
      reportText.trim().length > 0 &&
      confirmedFactionId.trim().length > 0,
    [databasePath, projectId, reportText, confirmedFactionId]
  );

  const canCommit = useMemo(
    () =>
      canPreviewOrImport &&
      parseResult !== null &&
      parseResult.meetsMinimumImportThreshold &&
      preview !== null,
    [canPreviewOrImport, parseResult, preview]
  );

  const resetPreviewOnInputChange = () => {
    setPreview(null);
    setAllowOverwrite(false);
  };

  const onSelectFile = async (file: File) => {
    const text = await file.text();
    setReportText(text);
    setStatusMessage(`loaded ${file.name}`);
  };

  const onDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) {
      return;
    }
    await onSelectFile(file);
  };

  return (
    <section>
      <h2>Report import workflow</h2>
      <label>
        Database path
        <input
          type="text"
          value={databasePath}
          onChange={(event) => { setDatabasePath(event.target.value); resetPreviewOnInputChange(); }}
          placeholder="/tmp/campaign.atlantis-project.sqlite"
        />
      </label>
      <label>
        Project id
        <input
          type="text"
          value={projectId}
          onChange={(event) => { setProjectId(event.target.value); resetPreviewOnInputChange(); }}
          placeholder="faction-12"
        />
      </label>
      <article
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          void onDrop(event);
        }}
      >
        <p>Drop report file here or pick file.</p>
        <input
          type="file"
          accept=".txt,.report,.rep,text/plain"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }
            void onSelectFile(file);
          }}
        />
      </article>
      <label>
        Report text
        <textarea
          rows={10}
          value={reportText}
          onChange={(event) => setReportText(event.target.value)}
          placeholder="Paste Atlantis report text"
        />
      </label>
      <button
        type="button"
        onClick={() => {
          setStatusMessage("parsing report...");
          client
            .parseReport(reportText)
            .then((parsed) => {
              setParseResult(parsed);
              setPreview(null);
              setAllowOverwrite(false);
              const firstFaction = parsed.detectedFactions[0];
              setConfirmedFactionId(firstFaction?.factionId ?? "");
              setStatusMessage(`parsed report with ${parsed.warnings.length} warning(s)`);
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : "unknown parse error";
              setStatusMessage(`failed to parse report: ${message}`);
            });
        }}
      >
        Parse report
      </button>

      {parseResult ? (
        <div>
          <p>
            threshold: {parseResult.meetsMinimumImportThreshold ? "met" : "not met"} | turn:{" "}
            {parseResult.turnHeader ? parseResult.turnHeader.turnNumber : "unknown"} | warnings:{" "}
            {parseResult.warnings.length}
          </p>
          <label>
            Confirm faction
            <select
              value={confirmedFactionId}
              onChange={(event) => { setConfirmedFactionId(event.target.value); resetPreviewOnInputChange(); }}
            >
              {parseResult.detectedFactions.map((faction) => (
                <option key={faction.factionId} value={faction.factionId}>
                  {faction.factionId} - {faction.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <button
        type="button"
        disabled={!canPreviewOrImport}
        onClick={() => {
          client
            .previewReportImport(databasePath, projectId, confirmedFactionId, reportText)
            .then((nextPreview) => {
              setPreview(nextPreview);
              setStatusMessage("duplicate preview updated");
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : "unknown preview error";
              setStatusMessage(`failed to preview import: ${message}`);
            });
        }}
      >
        Preview duplicate impact
      </button>

      {preview ? (
        <p>
          duplicate: {preview.duplicatePreview.exists ? "yes" : "no"} | raw changed:{" "}
          {preview.duplicatePreview.rawChanged ? "yes" : "no"} | parsed changed:{" "}
          {preview.duplicatePreview.parsedChanged ? "yes" : "no"} | warnings changed:{" "}
          {preview.duplicatePreview.warningsChanged ? "yes" : "no"}
        </p>
      ) : null}

      <label>
        <input
          type="checkbox"
          checked={allowOverwrite}
          onChange={(event) => setAllowOverwrite(event.target.checked)}
        />
        Allow overwrite when duplicate exists
      </label>
      <button
        type="button"
        disabled={!canCommit}
        onClick={() => {
          client
            .commitReportImport(databasePath, projectId, confirmedFactionId, reportText, allowOverwrite)
            .then(() => {
              setStatusMessage("report import committed");
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : "unknown import error";
              setStatusMessage(`failed to commit import: ${message}`);
            });
        }}
      >
        Commit import
      </button>

      {statusMessage ? <p role="status">{statusMessage}</p> : null}
    </section>
  );
}
