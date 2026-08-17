import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { create } from "zustand";
import { restoreStoresForTest, setStoreStateForTest } from "./storeState";

type CounterState = {
  label: string;
  bump: () => void;
};

const useCounterStore = create<CounterState>((set) => ({
  label: "default",
  bump: () => set({ label: "bumped" })
}));

function Label() {
  const label = useCounterStore((state) => state.label);
  return <span>{label}</span>;
}

const draw = () => renderToStaticMarkup(<Label />);

describe("setStoreStateForTest", () => {
  afterEach(restoreStoresForTest);

  it("a static render shows the store's defaults", () => {
    expect(draw()).toContain("default");
  });

  it("a patched store is visible to a static render", () => {
    setStoreStateForTest(useCounterStore, { label: "patched" });

    expect(draw()).toContain("patched");
    expect(useCounterStore.getState().label).toBe("patched");
  });

  it("state driven through the store's own actions is visible once mirrored", () => {
    // Snapshot the pristine store before the action, so `afterEach` restores the default rather
    // than the bumped state - the same reason a test file resets its store before driving it.
    setStoreStateForTest(useCounterStore);

    useCounterStore.getState().bump();
    setStoreStateForTest(useCounterStore);

    expect(draw()).toContain("bumped");
  });

  it("restoring puts the store back for the next test", () => {
    setStoreStateForTest(useCounterStore, { label: "patched" });

    restoreStoresForTest();

    expect(useCounterStore.getState().label).toBe("default");
    expect(draw()).toContain("default");
  });
});
