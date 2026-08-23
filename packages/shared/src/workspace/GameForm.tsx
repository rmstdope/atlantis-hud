import type { FormEvent } from "react";
import { useState } from "react";
import type { MapShape } from "@atlantis/core-client";
import type { MapDraft } from "../mapShape";
import { mapDraftFor, mapFromDraft, mapShapeProblems } from "../mapShape";
import { RULESETS } from "../rulesets";
import { MapShapeProblemLines } from "./MapShapeProblemLines";

/**
 * The game this form would create, or `null` when it would create none.
 *
 * A pure function rather than a branch inside the submit handler, so the refusal is testable in a
 * package that renders without a DOM and fires no events (`../testing/README.md`). `null` is the
 * answer for a map whose wrapping cannot be drawn: the button is disabled for that too, but a
 * disabled button is not a guarantee - Enter in a text field submits a form.
 */
export function gameSubmission(
  name: string,
  rulesetId: string,
  map: MapDraft
): { name: string; rulesetId: string; map: MapShape | undefined } | null {
  if (mapShapeProblems(map).length > 0) {
    return null;
  }
  return { name, rulesetId, map: mapFromDraft(map) ?? undefined };
}

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
  onCreate: (name: string, rulesetId: string, map?: MapShape) => void;
  submitLabel?: string;
}) {
  const [name, setName] = useState("");
  const [rulesetId, setRulesetId] = useState(RULESETS[0].id);
  // Prefilled from the chosen ruleset, and refilled below whenever that choice changes: a stale
  // 72x96 sitting under a newly-chosen variant is worse than no prefill, because it looks
  // deliberate.
  const [map, setMap] = useState(() => mapDraftFor(RULESETS[0].id));

  const chooseRuleset = (chosen: string) => {
    setRulesetId(chosen);
    setMap(mapDraftFor(chosen));
  };

  const problems = mapShapeProblems(map);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const submission = gameSubmission(name, rulesetId, map);
    if (submission === null) {
      return;
    }
    onCreate(submission.name, submission.rulesetId, submission.map);
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
          onChange={(event) => chooseRuleset(event.target.value)}
          className="rounded border border-edge bg-panel px-2 py-1 text-ink disabled:opacity-50"
        >
          {RULESETS.map((ruleset) => (
            <option key={ruleset.id} value={ruleset.id}>
              {ruleset.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 rounded border border-edge p-2">
        <legend className="px-1 text-ink-soft">Map</legend>
        <p className="text-ink-soft">
          How far the map runs, and where it joins back onto itself. Clear these if you do not know.
        </p>
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-ink-soft">Width</span>
            <input
              data-testid="game-map-width"
              aria-label="map width"
              inputMode="numeric"
              value={map.width}
              disabled={busy}
              onChange={(event) => setMap({ ...map, width: event.target.value })}
              className="w-full min-w-0 rounded border border-edge bg-panel px-2 py-1 text-ink disabled:opacity-50"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-ink-soft">Height</span>
            <input
              data-testid="game-map-height"
              aria-label="map height"
              inputMode="numeric"
              value={map.height}
              disabled={busy}
              onChange={(event) => setMap({ ...map, height: event.target.value })}
              className="w-full min-w-0 rounded border border-edge bg-panel px-2 py-1 text-ink disabled:opacity-50"
            />
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input
            data-testid="game-map-wrap-x"
            aria-label="wraps east to west"
            type="checkbox"
            checked={map.wrapX}
            disabled={busy}
            onChange={(event) => setMap({ ...map, wrapX: event.target.checked })}
          />
          <span className="text-ink-soft">Wraps east to west</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            data-testid="game-map-wrap-y"
            aria-label="wraps north to south"
            type="checkbox"
            checked={map.wrapY}
            disabled={busy}
            onChange={(event) => setMap({ ...map, wrapY: event.target.checked })}
          />
          <span className="text-ink-soft">Wraps north to south</span>
        </label>
        <MapShapeProblemLines problems={problems} testidPrefix="game-map-problem" />
      </fieldset>

      {error ? (
        <span data-testid="game-form-error" role="alert" className="text-danger">
          {error}
        </span>
      ) : null}

      <button
        type="submit"
        disabled={busy || problems.length > 0}
        className="rounded border border-brass px-2.5 py-1 text-brass disabled:opacity-50"
      >
        {busy ? "Creating…" : submitLabel}
      </button>
    </form>
  );
}
