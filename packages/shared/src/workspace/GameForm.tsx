import type { FormEvent } from "react";
import { useState } from "react";
import { RULESETS } from "../rulesets";

/**
 * Everything creating a game asks for: a name, and which ruleset it is played under.
 *
 * One component rather than two, because the picker and the empty-workspace gate ask exactly the
 * same question and an answer accepted in one place but not the other would be a bug waiting to
 * happen. Only the surrounding chrome differs.
 */
export function GameForm({
  busy,
  error,
  onCreate,
  submitLabel = "Create game"
}: {
  busy: boolean;
  error: string | null;
  onCreate: (name: string, rulesetId: string) => void;
  submitLabel?: string;
}) {
  const [name, setName] = useState("");
  const [rulesetId, setRulesetId] = useState(RULESETS[0].id);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCreate(name, rulesetId);
  };

  return (
    <form data-testid="game-form" onSubmit={submit} className="flex flex-col gap-2 text-pane">
      <label className="flex flex-col gap-1">
        <span className="text-ink-soft">Name</span>
        <input
          data-testid="game-name"
          aria-label="game name"
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-edge bg-panel px-2 py-1 text-ink disabled:opacity-50"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-ink-soft">Ruleset</span>
        <select
          data-testid="game-ruleset"
          aria-label="ruleset"
          value={rulesetId}
          disabled={busy}
          onChange={(event) => setRulesetId(event.target.value)}
          className="rounded border border-edge bg-panel px-2 py-1 text-ink disabled:opacity-50"
        >
          {RULESETS.map((ruleset) => (
            <option key={ruleset.id} value={ruleset.id}>
              {ruleset.label}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <span data-testid="game-form-error" role="alert" className="text-danger">
          {error}
        </span>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded border border-brass px-2.5 py-1 text-brass disabled:opacity-50"
      >
        {busy ? "Creating…" : submitLabel}
      </button>
    </form>
  );
}
