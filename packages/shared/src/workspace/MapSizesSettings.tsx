import type { MapSizes } from "@atlantis/core-client";
import { useState } from "react";
import { MAP_LEVELS, mapSizesDraftFor, mapSizesFromDraft, mapSizesProblems } from "../mapShape";

export function MapSizesSettings({
  mapSizes,
  busy,
  onChange
}: {
  mapSizes: MapSizes | undefined;
  busy: boolean;
  onChange: (mapSizes: MapSizes | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => sizesDraft(mapSizes));
  const [confirming, setConfirming] = useState(false);
  const save = () => {
    const next = mapSizesFromDraft(draft);
    if (next === null) return;
    if (becomesSmaller(mapSizes, next)) {
      setConfirming(true);
      return;
    }
    onChange(next);
    setEditing(false);
  };
  if (!editing) {
    return <button type="button" disabled={busy} onClick={() => setEditing(true)}>Edit map sizes</button>;
  }
  return (
    <section>
      {MAP_LEVELS.map((level) => (
        <div key={level}>
          <span>{level}</span>
          <input aria-label={`${level} width`} value={draft[level].width} onChange={(event) => setDraft({ ...draft, [level]: { ...draft[level], width: event.target.value } })} />
          <input aria-label={`${level} height`} value={draft[level].height} onChange={(event) => setDraft({ ...draft, [level]: { ...draft[level], height: event.target.value } })} />
        </div>
      ))}
      {mapSizesProblems(draft).map((problem) => <p key={problem} role="alert">{problem}</p>)}
      {confirming ? <div role="dialog" aria-label="Save map sizes?"><button onClick={() => setConfirming(false)}>Keep editing</button><button onClick={() => { const next = mapSizesFromDraft(draft); if (next) onChange(next); setEditing(false); }}>Save map sizes</button></div> : null}
      <button type="button" disabled={busy} onClick={save}>Save map sizes</button>
      <button type="button" onClick={() => { setDraft(sizesDraft(mapSizes)); setEditing(false); }}>Cancel</button>
    </section>
  );
}

function sizesDraft(mapSizes: MapSizes | undefined) {
  const draft = mapSizesDraftFor("unknown");
  if (!mapSizes) return draft;
  for (const level of MAP_LEVELS) {
    const size = mapSizes.levels[level];
    if (size) draft[level] = { width: String(size.width), height: String(size.height) };
  }
  return { ...draft, wrapX: mapSizes.wrapX, wrapY: mapSizes.wrapY };
}

function becomesSmaller(previous: MapSizes | undefined, next: MapSizes) {
  return Object.entries(previous?.levels ?? {}).some(([level, size]) => {
    const changed = next.levels[level];
    return !changed || changed.width < size.width || changed.height < size.height;
  });
}
