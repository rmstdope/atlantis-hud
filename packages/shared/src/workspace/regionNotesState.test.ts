import { describe, expect, it } from "vitest";
import { canSave, keyToAction, reduce, revealDue, REVEAL_WINDOW_MS, type NotesMode } from "./regionNotesState";

describe("canSave", () => {
  it("refuses empty or whitespace-only text", () => {
    expect(canSave("")).toBe(false);
    expect(canSave("   ")).toBe(false);
  });

  it("refuses text over the 500-character limit", () => {
    expect(canSave("a".repeat(501))).toBe(false);
  });

  it("allows trimmed text within the limit", () => {
    expect(canSave("Build a castle here")).toBe(true);
    expect(canSave("a".repeat(500))).toBe(true);
  });
});

describe("keyToAction", () => {
  it("saves on Cmd/Ctrl+Enter", () => {
    expect(keyToAction({ key: "Enter", metaKey: true, ctrlKey: false })).toBe("save");
    expect(keyToAction({ key: "Enter", metaKey: false, ctrlKey: true })).toBe("save");
  });

  it("does not save on a plain Enter - it is a newline", () => {
    expect(keyToAction({ key: "Enter", metaKey: false, ctrlKey: false })).toBeNull();
  });

  it("cancels on Escape", () => {
    expect(keyToAction({ key: "Escape", metaKey: false, ctrlKey: false })).toBe("cancel");
  });

  it("is null for every other key", () => {
    expect(keyToAction({ key: "a", metaKey: false, ctrlKey: false })).toBeNull();
  });
});

describe("reduce", () => {
  const idle: NotesMode = { kind: "idle" };

  it("add-note-clicked enters adding with an empty draft", () => {
    expect(reduce(idle, { type: "add-note-clicked" })).toEqual({ kind: "adding", draft: "" });
  });

  it("edit-note-clicked enters editing with the note's text as the draft", () => {
    expect(reduce(idle, { type: "edit-note-clicked", noteId: "n1", text: "hi" })).toEqual({
      kind: "editing",
      noteId: "n1",
      draft: "hi"
    });
  });

  it("draft-changed updates the draft in adding or editing mode", () => {
    expect(reduce({ kind: "adding", draft: "" }, { type: "draft-changed", draft: "x" })).toEqual({
      kind: "adding",
      draft: "x"
    });
    expect(
      reduce({ kind: "editing", noteId: "n1", draft: "" }, { type: "draft-changed", draft: "y" })
    ).toEqual({ kind: "editing", noteId: "n1", draft: "y" });
  });

  it("cancelled returns to idle from any mode", () => {
    expect(reduce({ kind: "adding", draft: "x" }, { type: "cancelled" })).toEqual(idle);
    expect(reduce({ kind: "editing", noteId: "n1", draft: "x" }, { type: "cancelled" })).toEqual(idle);
    expect(reduce({ kind: "removing", noteId: "n1" }, { type: "cancelled" })).toEqual(idle);
  });

  it("saved returns to idle", () => {
    expect(reduce({ kind: "adding", draft: "x" }, { type: "saved" })).toEqual(idle);
  });

  it("remove-clicked enters removing for that note", () => {
    expect(reduce(idle, { type: "remove-clicked", noteId: "n1" })).toEqual({
      kind: "removing",
      noteId: "n1"
    });
  });

  it("kept returns to idle from removing", () => {
    expect(reduce({ kind: "removing", noteId: "n1" }, { type: "kept" })).toEqual(idle);
  });

  it("removed returns to idle", () => {
    expect(reduce({ kind: "removing", noteId: "n1" }, { type: "removed" })).toEqual(idle);
  });
});

describe("revealDue (ah-mlls.5)", () => {
  const notes = [{ id: "a" }, { id: "b" }];
  const asked = { regionId: "1:7,53", noteId: "b", at: 1000 };

  it("names the note asked for on this hex", () => {
    expect(revealDue(asked, "1:7,53", notes, 1200)).toBe("b");
  });

  it("is nothing on another hex", () => {
    expect(revealDue(asked, "1:8,54", notes, 1200)).toBeNull();
  });

  it("is nothing when the note is not on the hex", () => {
    expect(revealDue({ ...asked, noteId: "gone" }, "1:7,53", notes, 1200)).toBeNull();
  });

  it("is nothing once the request has gone stale", () => {
    expect(revealDue(asked, "1:7,53", notes, 1000 + REVEAL_WINDOW_MS + 1)).toBeNull();
  });

  it("is nothing with no request", () => {
    expect(revealDue(null, "1:7,53", notes, 1200)).toBeNull();
  });
});
