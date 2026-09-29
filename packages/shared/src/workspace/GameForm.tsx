import type { FormEvent } from "react";
import { useState } from "react";
import type { MapShape, MapSizes } from "@atlantis/core-client";
import type { MapSizesDraft } from "../mapShape";
import { MAP_LEVELS, mapSizesDraftFor, mapSizesFromDraft, mapSizesProblems } from "../mapShape";
import { RULESETS } from "../rulesets";

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
  map: MapSizesDraft
): { name: string; rulesetId: string; map: MapShape | undefined; mapSizes: MapSizes } | null {
  const mapSizes = mapSizesFromDraft(map);
  if (mapSizes === null) {
    return null;
  }
  const surface = mapSizes.levels.surface;
  return {
    name,
    rulesetId,
    map: surface === undefined ? undefined : { ...surface, wrapX: map.wrapX, wrapY: map.wrapY },
    mapSizes
  };
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
  unavailable = false,
  error,
  onCreate,
  submitLabel = "Create game"
}: {
  busy: boolean;
  /** Disabled without claiming work is under way: another tab holds the saved-games list. */
  unavailable?: boolean;
  error: string | null;
  onCreate: (name: string, rulesetId: string, map?: MapShape, mapSizes?: MapSizes) => void;
  submitLabel?: string;
}) {
  const [name, setName] = useState("");
  const [rulesetId, setRulesetId] = useState(RULESETS[0].id);
  // Prefilled from the chosen ruleset, and refilled below whenever that choice changes: a stale
  // 72x96 sitting under a newly-chosen variant is worse than no prefill, because it looks
  // deliberate.
  const [map, setMap] = useState(() => mapSizesDraftFor(RULESETS[0].id));

  const chooseRuleset = (chosen: string) => {
    setRulesetId(chosen);
    setMap(mapSizesDraftFor(chosen));
  };

  const problems = mapSizesProblems(map);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const submission = gameSubmission(name, rulesetId, map);
    if (submission === null) {
      return;
    }
    onCreate(submission.name, submission.rulesetId, submission.map, submission.mapSizes);
  };

  return (
    <form data-testid="game-form" onSubmit={submit} className="flex flex-col gap-2 text-pane">
      <label className="flex flex-col gap-1">
        <span className="text-pane-xs uppercase tracking-[0.08em] text-brass">Name</span>
        <input
          data-testid="game-name"
          aria-label="game name"
          value={name}
          disabled={busy || unavailable}
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-edge bg-panel px-2 py-1 text-ink outline-none focus:border-brass disabled:opacity-50"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-pane-xs uppercase tracking-[0.08em] text-brass">Ruleset</span>
        <select
          data-testid="game-ruleset"
          aria-label="ruleset"
          value={rulesetId}
          disabled={busy || unavailable}
          onChange={(event) => chooseRuleset(event.target.value)}
          className="rounded border border-edge bg-panel px-2 py-1 text-ink outline-none focus:border-brass disabled:opacity-50"
        >
          {RULESETS.map((ruleset) => (
            <option key={ruleset.id} value={ruleset.id}>
              {ruleset.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 rounded border border-brass/60 bg-panel p-2">
        <legend className="px-1 text-pane-xs uppercase tracking-[0.08em] text-brass">Map level</legend>
        <p className="text-ink-soft">
          Set a size for any map level you want in this world. Leave both fields empty to not create that level.
        </p>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <span className="text-pane-xs uppercase tracking-[0.08em] text-brass">Map level</span>
          <span className="text-pane-xs uppercase tracking-[0.08em] text-brass">Width</span>
          <span className="text-pane-xs uppercase tracking-[0.08em] text-brass">Height</span>
          {MAP_LEVELS.map((level) => (
            <div key={level} className="contents">
              <span className="self-center capitalize text-ink-soft">{level}</span>
              <input
                data-testid={`game-map-${level}-width`}
                aria-label={`${level} width`}
                inputMode="numeric"
                value={map[level].width}
                disabled={busy || unavailable}
                onChange={(event) => setMap({ ...map, [level]: { ...map[level], width: event.target.value } })}
                className="min-w-0 rounded border border-edge bg-panel-raised px-2 py-1 text-ink outline-none focus:border-brass disabled:opacity-50"
              />
              <input
                data-testid={`game-map-${level}-height`}
                aria-label={`${level} height`}
                inputMode="numeric"
                value={map[level].height}
                disabled={busy || unavailable}
                onChange={(event) => setMap({ ...map, [level]: { ...map[level], height: event.target.value } })}
                className="min-w-0 rounded border border-edge bg-panel-raised px-2 py-1 text-ink outline-none focus:border-brass disabled:opacity-50"
              />
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input
            data-testid="game-map-wrap-x"
            aria-label="wraps east to west"
            type="checkbox"
            checked={map.wrapX}
            disabled={busy || unavailable}
            onChange={(event) => setMap({ ...map, wrapX: event.target.checked })}
          />
          <span className="text-ink-soft">Wrap east to west</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            data-testid="game-map-wrap-y"
            aria-label="wraps north to south"
            type="checkbox"
            checked={map.wrapY}
            disabled={busy || unavailable}
            onChange={(event) => setMap({ ...map, wrapY: event.target.checked })}
          />
          <span className="text-ink-soft">Wrap north to south</span>
        </label>
        {problems.map((problem) => <p key={problem} role="alert" className="text-danger">{problem}</p>)}
      </fieldset>

      {error ? (
        <span data-testid="game-form-error" role="alert" className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-danger">
          {error}
        </span>
      ) : null}

      <button
        type="submit"
        disabled={busy || unavailable || problems.length > 0}
        className="rounded border border-brass bg-brass/10 px-2.5 py-1 text-brass hover:bg-brass/15 disabled:border-edge disabled:bg-transparent disabled:text-ink-dim disabled:opacity-50"
      >
        {busy ? "Creating…" : submitLabel}
      </button>
    </form>
  );
}
