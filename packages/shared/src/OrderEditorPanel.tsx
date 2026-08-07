import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canExportOrders,
  shouldSaveOnBlur,
  shouldTriggerAutosave,
  summarizeOrderValidation
} from "./orderEditor";

type OrderValidationResult = {
  diagnostics: Array<{
    code: string;
    message: string;
    lineStart: number;
    lineEnd: number;
    severity: "warning" | "error";
  }>;
};

type OrderDraftRecord = {
  key: {
    projectId: string;
    factionId: string;
    turnNumber: number;
  };
  orderText: string;
  updatedAt: string;
};

type OrderEditorClientLike = {
  validateOrders(rawOrders: string): Promise<OrderValidationResult>;
  loadOrderDraft(
    databasePath: string,
    projectId: string,
    factionId: string,
    turnNumber: number
  ): Promise<OrderDraftRecord | null>;
  saveOrderDraft(
    databasePath: string,
    projectId: string,
    factionId: string,
    turnNumber: number,
    orderText: string,
    updatedAt: string
  ): Promise<OrderDraftRecord>;
};

type OrderEditorPanelProps = {
  client: OrderEditorClientLike;
};

function downloadOrderText(fileName: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function OrderEditorPanel({ client }: OrderEditorPanelProps) {
  const [databasePath, setDatabasePath] = useState("");
  const [projectId, setProjectId] = useState("");
  const [factionId, setFactionId] = useState("");
  const [turnNumberText, setTurnNumberText] = useState("");
  const [orderText, setOrderText] = useState("");
  const [validationResult, setValidationResult] = useState<OrderValidationResult>({ diagnostics: [] });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const validationRequestId = useRef(0);
  const lastEditAtRef = useRef(Date.now());
  const dirtyRef = useRef(false);
  const turnNumber = turnNumberText.trim().length > 0 ? Number.parseInt(turnNumberText, 10) : Number.NaN;
  const canPersistDraft =
    databasePath.trim().length > 0 &&
    projectId.trim().length > 0 &&
    factionId.trim().length > 0 &&
    Number.isFinite(turnNumber);
  const validationSummary = useMemo(() => summarizeOrderValidation(validationResult), [validationResult]);
  const exportAllowed = canExportOrders(validationResult);
  const exportFileName = useMemo(() => {
    if (!Number.isFinite(turnNumber)) {
      return "orders.txt";
    }

    return `orders-turn-${turnNumber}.txt`;
  }, [turnNumber]);

  const persistDraft = useCallback(
    async (reason: string) => {
      if (!canPersistDraft) {
        setStatusMessage("fill project, faction, and turn first");
        return;
      }

      const saved = await client.saveOrderDraft(
        databasePath.trim(),
        projectId.trim(),
        factionId.trim(),
        turnNumber,
        orderText,
        new Date().toISOString()
      );
      setDirty(false);
      setLastSavedAt(saved.updatedAt);
      setStatusMessage(`${reason}: draft saved at ${saved.updatedAt}`);
    },
    [canPersistDraft, client, databasePath, factionId, orderText, projectId, turnNumber]
  );

  const handleOrderTextInput = useCallback((next: string) => {
    setOrderText(next);
    setDirty(true);
    lastEditAtRef.current = Date.now();
  }, []);

  const runValidation = useCallback(
    async (reason: string) => {
      const requestId = validationRequestId.current + 1;
      validationRequestId.current = requestId;
      const result = await client.validateOrders(orderText);
      if (validationRequestId.current === requestId) {
        setValidationResult(result);
        setStatusMessage(
          `${reason}: ${result.diagnostics.length} diagnostic(s), ${summarizeOrderValidation(result).errorCount} error(s)`
        );
      }
    },
    [client, orderText]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void runValidation("live validation");
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [orderText, runValidation]);

  useEffect(() => {
    if (!canPersistDraft) {
      return;
    }

    let cancelled = false;
    void client
      .loadOrderDraft(databasePath.trim(), projectId.trim(), factionId.trim(), turnNumber)
      .then((draft) => {
        if (cancelled) {
          return;
        }
        if (draft) {
          setOrderText(draft.orderText);
          setDirty(false);
          setLastSavedAt(draft.updatedAt);
          setStatusMessage(`loaded draft saved at ${draft.updatedAt}`);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatusMessage(error instanceof Error ? error.message : "failed to load draft");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canPersistDraft, client, databasePath, factionId, projectId, turnNumber]);

  useEffect(() => {
    if (!dirty || !canPersistDraft) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (shouldTriggerAutosave(lastEditAtRef.current, Date.now()) && dirtyRef.current) {
        void persistDraft("autosave");
      }
    }, 5_000);

    return () => window.clearTimeout(timeout);
  }, [canPersistDraft, dirty, persistDraft]);

  dirtyRef.current = dirty;

  return (
    <section data-testid="order-editor-panel">
      <h2>Order editor</h2>
      <label>
        Database path
        <input
          type="text"
          value={databasePath}
          onChange={(event) => setDatabasePath(event.target.value)}
          placeholder="/tmp/campaign.atlantis-project.sqlite"
        />
      </label>
      <label>
        Project id
        <input
          type="text"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          placeholder="faction-12"
        />
      </label>
      <label>
        Faction id
        <input
          type="text"
          value={factionId}
          onChange={(event) => setFactionId(event.target.value)}
          placeholder="17"
        />
      </label>
      <label>
        Turn number
        <input
          type="number"
          min="1"
          value={turnNumberText}
          onChange={(event) => setTurnNumberText(event.target.value)}
          placeholder="12"
        />
      </label>
      <textarea
        data-testid="order-editor-input"
        aria-label="Order text input"
        value={orderText}
        onInput={(event) => handleOrderTextInput(event.currentTarget.value)}
        onChange={(event) => handleOrderTextInput(event.currentTarget.value)}
        onBlur={() => {
          if (shouldSaveOnBlur(dirtyRef.current)) {
            void persistDraft("blur save");
          }
        }}
        rows={10}
        style={{
          width: "100%",
          minHeight: "240px",
          fontFamily: "monospace"
        }}
      />
      <div>
        <button
          type="button"
          onClick={() => {
            const next = "FLY 1 2";
            handleOrderTextInput(next);
            void client.validateOrders(next).then((result) => {
              setValidationResult(result);
              setStatusMessage("loaded invalid sample");
            });
          }}
        >
          Load invalid sample
        </button>
        <button
          type="button"
          onClick={() => {
            const next = "MOVE U100 R2";
            handleOrderTextInput(next);
            void client.validateOrders(next).then((result) => {
              setValidationResult(result);
            });
            void client
              .saveOrderDraft(
                databasePath.trim(),
                projectId.trim(),
                factionId.trim(),
                turnNumber,
                next,
                new Date().toISOString()
              )
              .then((saved) => {
                setDirty(false);
                setLastSavedAt(saved.updatedAt);
                setStatusMessage(`sample saved at ${saved.updatedAt}`);
              })
              .catch((error: unknown) => {
                setStatusMessage(error instanceof Error ? error.message : "failed to save sample");
              });
          }}
        >
          Load valid sample
        </button>
        <button
          type="button"
          onClick={() => {
            void runValidation("manual validation");
          }}
        >
          Validate orders
        </button>
        <button
          type="button"
          disabled={!exportAllowed}
          onClick={() => {
            if (!exportAllowed) {
              setStatusMessage("export blocked until validation errors are fixed");
              return;
            }

            downloadOrderText(exportFileName, orderText);
            setStatusMessage("exported current orders");
          }}
        >
          Export orders
        </button>
        <button
          type="button"
          disabled={!canPersistDraft}
          onClick={() => {
            void persistDraft("manual save");
          }}
        >
          Save draft
        </button>
      </div>
      <p data-testid="order-validation-summary">
        validation: {validationSummary.errorCount} error(s), {validationSummary.warningCount} warning(s) | export:{" "}
        {validationSummary.blocking ? "blocked" : "allowed"}
      </p>
      <ul>
        {validationResult.diagnostics.map((diagnostic) => (
          <li key={`${diagnostic.code}-${diagnostic.lineStart}-${diagnostic.lineEnd}`}>
            [{diagnostic.severity}] {diagnostic.code}: {diagnostic.message}
          </li>
        ))}
      </ul>
      <p role="status" data-testid="order-editor-status">
        {statusMessage ?? (lastSavedAt ? `last saved at ${lastSavedAt}` : "draft not saved yet")}
      </p>
    </section>
  );
}
