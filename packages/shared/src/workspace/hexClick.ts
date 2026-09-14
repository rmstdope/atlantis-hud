import { isRecentreGesture } from "./mapRecentre";

/** What a primary or secondary click on a hex position does. */
export type HexClick =
  | { kind: "ignore" } // the click ended a drag
  | { kind: "recentre" } // right button, or Ctrl+click on macOS
  | { kind: "select-hex"; regionId: string } // the map holds a hex here
  | { kind: "select-ground" }; // nothing known here: select by position

/**
 * The one decision for a click on a hex position, shared by every element that stands for a hex -
 * the hex polygon, the fog rect and the marks drawn over a hex. First match wins.
 */
export function hexClickOf(click: {
  dragged: boolean;
  button: number;
  ctrlKey: boolean;
  isMac: boolean;
  hexRegionId: string | null;
}): HexClick {
  if (click.dragged) {
    return { kind: "ignore" };
  }
  if (isRecentreGesture({ button: click.button, ctrlKey: click.ctrlKey }, click.isMac)) {
    return { kind: "recentre" };
  }
  if (click.hexRegionId !== null) {
    return { kind: "select-hex", regionId: click.hexRegionId };
  }
  return { kind: "select-ground" };
}
