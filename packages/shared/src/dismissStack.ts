/**
 * Which dismissable surface is on top, so one Escape closes one thing.
 *
 * Every modal listens for Escape on the document in the capture phase, and capture order is
 * registration order - which is stacking order only by luck. With the settings dialog open under
 * the command palette, the dialog's older listener won the keypress and the palette stayed. This
 * stack is the explicit answer: a surface registers itself on mount, and only the top of the
 * stack may treat Escape as its own.
 */

const stack: Array<() => void> = [];

/**
 * Registers an open surface and answers its closer: calling it removes the layer wherever it
 * stands, so an out-of-order unmount cannot strand the layers above it. The closer doubles as
 * the layer's identity for `isTopDismissLayer`.
 */
export function pushDismissLayer(): () => void {
  const layer = () => {
    const at = stack.indexOf(layer);
    if (at !== -1) {
      stack.splice(at, 1);
    }
  };
  stack.push(layer);
  return layer;
}

export function isTopDismissLayer(token: unknown): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token;
}

/**
 * Whether any dismissable surface is open at all - which is when the global cycling chords
 * stand down: walking units under a dialog mutates a selection nobody can see.
 */
export function hasOpenDismissLayers(): boolean {
  return stack.length > 0;
}
