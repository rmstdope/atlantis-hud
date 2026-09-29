import type { MapSizes } from "@atlantis/core-client";
import { type Ref, useRef, useState } from "react";
import {
  mapLevelLabel,
  mapSizesDraftOf,
  mapSizesFromDraft,
  mapSizesSummary,
  shrunkLevel,
  type MapLevel,
  type MapSizesDraft
} from "../mapShape";
import { useEscapeToDismiss } from "./dismissLayer";
import { MapSizesFields } from "./MapSizesFields";

const BUTTON =
  "rounded border border-edge px-2.5 py-1 text-ink-soft hover:border-brass hover:text-brass disabled:opacity-50";
const PRIMARY =
  "rounded border border-brass bg-brass/10 px-2.5 py-1 text-brass hover:bg-brass/15 disabled:border-edge disabled:bg-transparent disabled:text-ink-dim disabled:opacity-50";

/**
 * World settings' map sizes: a one-line summary of every level and an "Edit map sizes" button that
 * opens a focused window. Nothing here is editable in place - changing a size is a deliberate
 * edit-and-save, and closing without saving keeps nothing.
 */
export function MapSizesSettings({
  mapSizes,
  assumed,
  busy,
  onChange
}: {
  /** The world's configuration, already read through `mapSizesOfGame`. */
  mapSizes: MapSizes | null;
  /** The sizes are the ruleset's default rather than anything this world recorded. */
  assumed: boolean;
  busy: boolean;
  onChange: (mapSizes: MapSizes) => void;
}) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    setEditing(false);
    // After the window unmounts, so focus lands back on the button that opened it.
    requestAnimationFrame(() => editButton.current?.focus());
  };

  return (
    <>
      <MapSizesSummary
        mapSizes={mapSizes}
        assumed={assumed}
        busy={busy}
        editButtonRef={editButton}
        onEdit={() => setEditing(true)}
      />
      {editing ? (
        <MapSizesEditor
          mapSizes={mapSizes}
          busy={busy}
          onSave={(next) => {
            onChange(next);
            close();
          }}
          onCancel={close}
        />
      ) : null}
    </>
  );
}

export function MapSizesSummary({
  mapSizes,
  assumed,
  busy,
  editButtonRef,
  onEdit
}: {
  mapSizes: MapSizes | null;
  assumed: boolean;
  busy: boolean;
  editButtonRef?: Ref<HTMLButtonElement>;
  onEdit: () => void;
}) {
  return (
    <section className="flex items-center gap-3 rounded border border-edge bg-panel p-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-ink">Map sizes</span>
        <span data-testid="settings-map-sizes-summary" className="text-pane-xs text-ink-soft">
          {mapSizesSummary(mapSizes)}
        </span>
        {assumed ? (
          <span data-testid="settings-map-assumed" className="text-pane-xs text-ink-dim">
            Assumed from the ruleset - nobody has confirmed them for this game.
          </span>
        ) : null}
      </div>
      <button
        ref={editButtonRef}
        type="button"
        data-testid="settings-map-sizes-edit"
        disabled={busy}
        onClick={onEdit}
        className={`ml-auto shrink-0 ${BUTTON}`}
      >
        Edit map sizes
      </button>
    </section>
  );
}

/** The editing window's state, Escape and focus; the drawing is `MapSizesEditorPanel`'s. */
function MapSizesEditor({
  mapSizes,
  busy,
  onSave,
  onCancel
}: {
  mapSizes: MapSizes | null;
  busy: boolean;
  onSave: (mapSizes: MapSizes) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => mapSizesDraftOf(mapSizes));
  const [confirming, setConfirming] = useState<MapLevel | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const keepEditing = () => {
    const level = confirming;
    setConfirming(null);
    requestAnimationFrame(() =>
      panel.current
        ?.querySelector<HTMLInputElement>(`[data-testid="settings-map-sizes-${level}-width"]`)
        ?.focus()
    );
  };

  useEscapeToDismiss(() => (confirming === null ? onCancel() : keepEditing()));

  return (
    <MapSizesEditorPanel
      panelRef={panel}
      draft={draft}
      busy={busy}
      confirming={confirming}
      onDraft={setDraft}
      onSave={() => {
        const next = mapSizesFromDraft(draft);
        if (next === null) {
          return;
        }
        const shrunk = shrunkLevel(mapSizes, next);
        if (shrunk !== null) {
          setConfirming(shrunk);
          return;
        }
        onSave(next);
      }}
      onConfirm={() => {
        const next = mapSizesFromDraft(draft);
        if (next !== null) {
          onSave(next);
        }
      }}
      onKeepEditing={keepEditing}
      onCancel={onCancel}
    />
  );
}

/** The focused "Edit map sizes" window, and its "Save map sizes?" confirmation. Hook-free. */
export function MapSizesEditorPanel({
  panelRef,
  draft,
  busy,
  confirming,
  onDraft,
  onSave,
  onConfirm,
  onKeepEditing,
  onCancel
}: {
  panelRef?: Ref<HTMLDivElement>;
  draft: MapSizesDraft;
  busy: boolean;
  /** The level a save would make smaller or remove, while the player is asked to confirm. */
  confirming: MapLevel | null;
  onDraft: (draft: MapSizesDraft) => void;
  onSave: () => void;
  onConfirm: () => void;
  onKeepEditing: () => void;
  onCancel: () => void;
}) {
  const invalid = mapSizesFromDraft(draft) === null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div
        ref={panelRef}
        data-testid="settings-map-sizes-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Edit map sizes"
        className="w-[36rem] max-w-[94vw] rounded border border-brass/60 bg-panel-raised p-3 text-pane whitespace-normal shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-brass/60 pb-2">
          <h3 className="m-0 text-brass">Edit map sizes</h3>
          <button
            type="button"
            data-testid="settings-map-sizes-close"
            aria-label="close map sizes"
            onClick={onCancel}
            className="rounded border border-edge px-1.5 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            ×
          </button>
        </div>
        <p className="my-2 text-ink-soft">
          Change a level’s size, add a level, or clear both fields to remove a level.
        </p>
        <MapSizesFields
          draft={draft}
          disabled={busy || confirming !== null}
          testidPrefix="settings-map-sizes"
          autoFocusFirst
          onChange={onDraft}
        />
        {confirming !== null ? (
          <div
            data-testid="settings-map-sizes-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="Save map sizes?"
            className="mt-3 rounded border border-danger/40 bg-danger/10 p-2"
          >
            <h4 className="m-0 text-ink">Save map sizes?</h4>
            <p className="my-1 text-ink-soft">
              Making {mapLevelLabel(confirming)} smaller may remove parts of this level that are
              outside its new size.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onKeepEditing} className={BUTTON}>
                Keep editing
              </button>
              <button
                type="button"
                data-testid="settings-map-sizes-confirm-save"
                autoFocus
                disabled={busy}
                onClick={onConfirm}
                className={PRIMARY}
              >
                Save map sizes
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" data-testid="settings-map-sizes-cancel" onClick={onCancel} className={BUTTON}>
              Cancel
            </button>
            <button
              type="button"
              data-testid="settings-map-sizes-save"
              disabled={busy || invalid}
              onClick={onSave}
              className={PRIMARY}
            >
              Save map sizes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
