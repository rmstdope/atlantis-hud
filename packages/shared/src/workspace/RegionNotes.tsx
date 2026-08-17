import { useEffect, useMemo, useRef, useState } from "react";
import type { CoreClient, HexNoteRecord, OpenedGame } from "@atlantis/core-client";
import { HEX_NOTE_MAX_CHARS } from "../hexNotes";
import { notesForRegion, useHexNotesStore } from "../hexNotesStore";
import { isMacPlatform } from "../shortcuts";
import { RAIL_LEFT_DEFAULT_REM } from "./panelLayout";
import { Absent, Section } from "./primitives";
import { canSave, keyToAction, reduce, type NotesMode } from "./regionNotesState";
import { useWorkspaceStore } from "../workspaceStore";

/**
 * The region panel's Notes section — the only editor the manual-hex-notes feature has (ah-o1t).
 *
 * Reads `useHexNotesStore`, the notes cache the map layer (ah-o1t.3) will also read; owns its own
 * editing state locally, so a hex change simply unmounts it — the interview's "discard silently".
 */
export function RegionNotes({
  regionId,
  client,
  game,
  turn
}: {
  regionId: string;
  client: CoreClient;
  /** `null` → nothing is rendered: there is no game to save a note into. */
  game: OpenedGame | null;
  /** `null` when the report is not parsed yet. Notes are then stamped 0, and the stamp is hidden. */
  turn: number | null;
}) {
  const status = useHexNotesStore((state) => state.status);
  // `notesForRegion` allocates a new array; selecting the raw list and filtering in a `useMemo`
  // keeps the store's snapshot stable between renders (`useSyncExternalStore` needs a `Object.is`-
  // stable snapshot when nothing changed - a selector allocating fresh on every call reads as a
  // change on every render and drives React into a re-render loop, React error #185).
  const allNotes = useHexNotesStore((state) => state.notes);
  const notes = useMemo(() => notesForRegion(allNotes, regionId), [allNotes, regionId]);
  const requestAdd = useHexNotesStore((state) => state.requestAdd);
  const clearRequestAdd = useHexNotesStore((state) => state.clearRequestAdd);
  const leftRailWidthRem = useWorkspaceStore((state) => state.leftRailWidthRem);

  const [mode, setMode] = useState<NotesMode>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  // A hex change unmounts this component (a fresh `regionId` prop is a fresh mount from React's
  // point of view only if the caller keys it; here the parent simply re-renders with new props,
  // so an explicit reset keeps the "discard silently" promise the plan makes).
  //
  // `currentRegionRef` guards the async handlers below: a save/edit/remove/toggle started on one
  // hex can resolve after the player has navigated elsewhere, and without the guard its result
  // would land on whichever hex is now selected - an error banner or a mode change nobody asked
  // for there. A boolean "am I still mounted" flag is not quite this: it forgets which hex asked,
  // so leaving and returning to the *same* hex before a stale call resolves would wrongly drop its
  // result. Comparing against the hex the call actually started on is precise regardless of what
  // the player did in between.
  const currentRegionRef = useRef(regionId);
  useEffect(() => {
    currentRegionRef.current = regionId;
    setMode({ kind: "idle" });
    setError(null);
  }, [regionId]);

  useEffect(() => {
    // Idle only: a request for a hex already mid-edit (typing a draft, or re-triggered for the
    // hex it just opened) must not silently blow the draft away - see `mode`'s own reset above for
    // where "discard silently" actually belongs, which is a hex change, not a second request.
    if (requestAdd && requestAdd.regionId === regionId && mode.kind === "idle") {
      setMode({ kind: "adding", draft: "" });
      setError(null);
      clearRequestAdd();
    }
  }, [requestAdd, regionId, clearRequestAdd, mode]);

  if (!game) {
    return null;
  }

  const narrow = (leftRailWidthRem ?? RAIL_LEFT_DEFAULT_REM) < 15;
  const mac = isMacPlatform();

  const beginAdd = () => {
    setMode(reduce(mode, { type: "add-note-clicked" }));
    setError(null);
  };

  const save = async () => {
    const targetRegionId = regionId;
    const value = mode.kind === "adding" ? mode.draft : mode.kind === "editing" ? mode.draft : null;
    if (value === null || !canSave(value)) {
      return;
    }
    try {
      if (mode.kind === "adding") {
        await useHexNotesStore
          .getState()
          .add(client, game, { regionId, text: value, turn: turn ?? 0, now: new Date().toISOString() });
      } else if (mode.kind === "editing") {
        await useHexNotesStore
          .getState()
          .edit(client, game, mode.noteId, { text: value }, new Date().toISOString());
      }
      if (currentRegionRef.current === targetRegionId) {
        setMode(reduce(mode, { type: "saved" }));
        setError(null);
      }
    } catch {
      if (currentRegionRef.current === targetRegionId) {
        setError("Could not save this note.");
      }
    }
  };

  const cancel = () => {
    setMode(reduce(mode, { type: "cancelled" }));
    setError(null);
  };

  const toggleOnMap = async (note: HexNoteRecord) => {
    const targetRegionId = regionId;
    try {
      await useHexNotesStore
        .getState()
        .edit(client, game, note.id, { onMap: !note.onMap }, new Date().toISOString());
      if (currentRegionRef.current === targetRegionId) {
        setError(null);
      }
    } catch {
      if (currentRegionRef.current === targetRegionId) {
        setError("Could not save this note.");
      }
    }
  };

  const remove = async (noteId: string) => {
    const targetRegionId = regionId;
    try {
      await useHexNotesStore.getState().remove(client, game, noteId);
      if (currentRegionRef.current === targetRegionId) {
        setMode(reduce(mode, { type: "removed" }));
        setError(null);
      }
    } catch {
      if (currentRegionRef.current === targetRegionId) {
        setError("Could not remove this note.");
      }
    }
  };

  return (
    <div data-testid="region-notes">
      <Section title="Notes" count={status === "ready" ? notes.length : undefined}>
        <div className="mb-1 flex flex-wrap items-center justify-end gap-2">
          {status === "ready" ? (
            <button
              type="button"
              data-testid="region-note-add"
              className="text-pane-sm text-select"
              onClick={beginAdd}
            >
              + Add note
            </button>
          ) : null}
        </div>

        {mode.kind === "adding" ? (
          <NoteEditor
            draft={mode.draft}
            mac={mac}
            onChange={(draft) => setMode(reduce(mode, { type: "draft-changed", draft }))}
            onSave={save}
            onCancel={cancel}
          />
        ) : null}

        {status === "ready" && notes.length === 0 && mode.kind !== "adding" ? (
          <Absent>No notes on this hex.</Absent>
        ) : null}

        {status === "ready"
          ? notes.map((note) =>
              mode.kind === "editing" && mode.noteId === note.id ? (
                <NoteEditor
                  key={note.id}
                  draft={mode.draft}
                  mac={mac}
                  onChange={(draft) => setMode(reduce(mode, { type: "draft-changed", draft }))}
                  onSave={save}
                  onCancel={cancel}
                />
              ) : (
                <NoteRow
                  key={note.id}
                  note={note}
                  narrow={narrow}
                  removing={mode.kind === "removing" && mode.noteId === note.id}
                  onEdit={() =>
                    setMode(reduce(mode, { type: "edit-note-clicked", noteId: note.id, text: note.text }))
                  }
                  onRemoveClicked={() => setMode(reduce(mode, { type: "remove-clicked", noteId: note.id }))}
                  onKeep={() => setMode(reduce(mode, { type: "kept" }))}
                  onRemove={() => remove(note.id)}
                  onToggleOnMap={() => toggleOnMap(note)}
                />
              )
            )
          : null}

        {error ? (
          <p data-testid="region-notes-error" className="m-0 text-pane-sm text-danger">
            {error}
          </p>
        ) : null}
      </Section>
    </div>
  );
}

function NoteEditor({
  draft,
  mac,
  onChange,
  onSave,
  onCancel
}: {
  draft: string;
  mac: boolean;
  onChange: (draft: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div data-testid="region-note-editor" className="mb-2">
      <textarea
        autoFocus
        rows={3}
        maxLength={HEX_NOTE_MAX_CHARS}
        value={draft}
        className="w-full rounded border border-edge bg-surface p-1.5 text-pane"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          const action = keyToAction({
            key: event.key,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey
          });
          if (action === "save") {
            event.preventDefault();
            onSave();
          } else if (action === "cancel") {
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="mt-1 flex items-center justify-end gap-2">
        <button type="button" data-testid="region-note-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          data-testid="region-note-save"
          disabled={!canSave(draft)}
          onClick={onSave}
        >
          Save
        </button>
      </div>
      <p className="m-0 text-pane-sm text-ink-dim">
        {mac ? "⌘↩ saves · Esc cancels" : "Ctrl+↩ saves · Esc cancels"}
      </p>
    </div>
  );
}

function NoteRow({
  note,
  narrow,
  removing,
  onEdit,
  onRemoveClicked,
  onKeep,
  onRemove,
  onToggleOnMap
}: {
  note: HexNoteRecord;
  narrow: boolean;
  removing: boolean;
  onEdit: () => void;
  onRemoveClicked: () => void;
  onKeep: () => void;
  onRemove: () => void;
  onToggleOnMap: () => void;
}) {
  return (
    <div data-testid="region-note" data-note-id={note.id} className="mb-1.5">
      <button
        type="button"
        disabled={removing}
        className={`m-0 block w-full whitespace-pre-wrap text-left ${removing ? "text-ink-dim" : "cursor-pointer"}`}
        onClick={removing ? undefined : onEdit}
      >
        {note.onMap ? <span aria-label="shown on the map">◆ </span> : null}
        {note.text}
      </button>
      {removing ? (
        <div className="flex items-center justify-between gap-2 text-pane-sm">
          <span>Remove this note?</span>
          <span className="flex gap-2">
            <button type="button" onClick={onKeep}>
              Keep
            </button>
            <button
              type="button"
              data-testid="region-note-remove"
              className="border border-danger text-danger"
              onClick={onRemove}
            >
              Remove
            </button>
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 text-pane-sm text-ink-dim">
          {note.turn > 0 ? <span>turn {note.turn}</span> : <span />}
          <span className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={note.onMap}
                data-testid="region-note-map"
                aria-label="Map"
                onChange={onToggleOnMap}
                className="h-3 w-3 accent-select"
              />
              Map
            </label>
            <button type="button" data-testid="region-note-remove" onClick={onRemoveClicked}>
              {narrow ? "✕" : "Remove"}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
