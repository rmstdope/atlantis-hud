/**
 * The study planner's "Also write the casts" tick (ah-9qdz.4).
 *
 * One tick for the whole Orders tab, ticked when the app starts and kept as the player left it
 * until the app closes: closing the planner, switching game and a new report do not reset it.
 * Module state does exactly that, so it is deliberately **not persisted** - a reload of the web
 * app is the app closing, and starts ticked again.
 */

import { create } from "zustand";

export type StudyCastsWriteState = {
  writeCasts: boolean;
  setWriteCasts: (writeCasts: boolean) => void;
};

export const useStudyCastsWriteStore = create<StudyCastsWriteState>()((set) => ({
  writeCasts: true,
  setWriteCasts: (writeCasts) => set({ writeCasts })
}));
