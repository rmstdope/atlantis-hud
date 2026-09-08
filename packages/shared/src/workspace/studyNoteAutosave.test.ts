import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNoteAutosave } from "./studyNoteAutosave";

describe("createNoteAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes the note once the player stops typing", () => {
    const write = vi.fn();
    const autosave = createNoteAutosave(write, "");

    autosave.typed("heading for Gate Lore");
    vi.advanceTimersByTime(399);
    expect(write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("heading for Gate Lore");
  });

  it("writes only the last text of a burst", () => {
    const write = vi.fn();
    const autosave = createNoteAutosave(write, "");

    autosave.typed("a");
    vi.advanceTimersByTime(100);
    autosave.typed("ab");
    vi.advanceTimersByTime(100);
    autosave.typed("abc");
    vi.advanceTimersByTime(400);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("abc");
  });

  it("writes what is owed at once when the editor goes away", () => {
    const write = vi.fn();
    const autosave = createNoteAutosave(write, "");

    autosave.typed("x");
    autosave.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("x");

    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("does not write a note nobody changed", () => {
    const write = vi.fn();
    const autosave = createNoteAutosave(write, "old");

    autosave.flush();
    expect(write).not.toHaveBeenCalled();

    autosave.typed("old");
    vi.advanceTimersByTime(400);
    expect(write).not.toHaveBeenCalled();
  });

  it("writes the note trimmed", () => {
    const write = vi.fn();
    const autosave = createNoteAutosave(write, "");

    autosave.typed("  x  ");
    vi.advanceTimersByTime(400);

    expect(write).toHaveBeenCalledWith("x");
  });

  it("cancel drops what is owed", () => {
    const write = vi.fn();
    const autosave = createNoteAutosave(write, "");

    autosave.typed("x");
    autosave.cancel();
    vi.advanceTimersByTime(400);
    expect(write).not.toHaveBeenCalled();

    autosave.flush();
    expect(write).not.toHaveBeenCalled();
  });
});
