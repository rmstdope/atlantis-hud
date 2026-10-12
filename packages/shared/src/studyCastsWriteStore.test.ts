import { afterEach, describe, expect, it } from "vitest";
import { useStudyCastsWriteStore } from "./studyCastsWriteStore";

describe("useStudyCastsWriteStore", () => {
  afterEach(() => useStudyCastsWriteStore.getState().setWriteCasts(true));

  it("starts_ticked", () => {
    expect(useStudyCastsWriteStore.getState().writeCasts).toBe(true);
  });

  it("keeps_the_players_choice", () => {
    useStudyCastsWriteStore.getState().setWriteCasts(false);
    expect(useStudyCastsWriteStore.getState().writeCasts).toBe(false);
  });
});
