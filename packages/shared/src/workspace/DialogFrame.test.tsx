import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { DialogFrame, DialogFrameView, type DialogFrameProps } from "./DialogFrame";
import { findByTestId, queryByTestId } from "../testing/elementTree";

/**
 * The frame every dialog with a top bar renders through (ah-yaat): the veil, the box, the
 * draggable top bar with its close button, and Escape.
 *
 * Rendered without a DOM (ah-nass), so what is pinned is the markup in each state and the handlers
 * a test can call. The drag's motion - press, capture, the veil lifting - is the smoke suite's
 * `dialog-drag.spec.ts`; where a dialog may go is `dialogDrag.test.ts`; Escape is an effect, and the
 * dialog smoke specs press it.
 */
const base = (over: Partial<DialogFrameProps> = {}): DialogFrameProps => ({
  label: "Example",
  onDismiss: () => {},
  layer: "z-30",
  backdropTestId: "example-backdrop",
  testId: "example-dialog",
  boxClassName: "w-[20rem] rounded",
  barClassName: "items-center justify-between",
  bar: <h2>Example</h2>,
  close: { testId: "example-close", label: "close example", look: "framed" },
  children: <p data-testid="example-body">Body</p>,
  ...over
});

const draw = (element: ReactElement) => renderToStaticMarkup(element);

/** The opening tag of the element carrying `data-testid`. */
const tagOf = (markup: string, testId: string) =>
  markup.match(new RegExp(`<[a-z0-9]+\\b[^>]*data-testid="${testId}"[^>]*>`, "u"))?.[0] ?? "";

const moved = {
  moved: true,
  dialogStyle: { position: "fixed", left: 40, top: 70, margin: 0 } as const,
  barProps: {
    "data-dialog-bar": "",
    style: { touchAction: "none" },
    onPointerDown: () => {},
    onPointerMove: () => {},
    onPointerUp: () => {},
    onPointerCancel: () => {}
  } as const
};

describe("the dialog frame", () => {
  it("dims what is behind it while unmoved", () => {
    for (const markup of [draw(<DialogFrameView {...base()} />), draw(<DialogFrame {...base()} />)]) {
      expect(tagOf(markup, "example-backdrop")).toContain(
        'class="fixed inset-0 z-30 flex items-center justify-center bg-black/50"'
      );
    }
  });

  it("lifts the veil once moved and fixes the box where it was left", () => {
    const markup = draw(<DialogFrameView {...base()} drag={moved} />);
    expect(tagOf(markup, "example-backdrop")).toContain(
      'class="fixed inset-0 z-30 flex items-center justify-center"'
    );
    expect(tagOf(markup, "example-dialog")).toContain('style="position:fixed;left:40px;top:70px;margin:0"');
  });

  it("is a labelled modal dialog holding its body", () => {
    const markup = draw(<DialogFrame {...base()} />);
    const box = tagOf(markup, "example-dialog");
    expect(box).toContain('role="dialog"');
    expect(box).toContain('aria-modal="true"');
    expect(box).toContain('aria-label="Example"');
    expect(box).toContain('class="w-[20rem] rounded"');
    expect(markup).toContain('<p data-testid="example-body">Body</p>');
  });

  it("makes the top bar the drag handle", () => {
    const markup = draw(<DialogFrame {...base()} />);
    const bar = markup.match(/<div\b[^>]*data-dialog-bar=""[^>]*>/u)?.[0] ?? "";
    expect(bar).toContain('style="touch-action:none"');
    expect(bar).toContain('class="flex cursor-move select-none items-center justify-between"');
    expect(markup).toMatch(/data-dialog-bar=""[^>]*><h2>Example<\/h2><button/u);
  });

  it("dismisses on a press that lands on the backdrop itself, and not on one inside the box", () => {
    const onDismiss = vi.fn();
    const backdrop = findByTestId(<DialogFrameView {...base({ onDismiss })} />, "example-backdrop");
    const press = backdrop.props.onPointerDown as (event: { target: unknown; currentTarget: unknown }) => void;
    press({ target: "inside", currentTarget: "backdrop" });
    expect(onDismiss).not.toHaveBeenCalled();
    press({ target: "backdrop", currentTarget: "backdrop" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("leaves the backdrop inert when asked to", () => {
    const backdrop = findByTestId(
      <DialogFrameView {...base({ dismissOnBackdrop: false })} />,
      "example-backdrop"
    );
    expect(backdrop.props.onPointerDown).toBeUndefined();
  });

  it("closes from its close button", () => {
    const onDismiss = vi.fn();
    (findByTestId(<DialogFrameView {...base({ onDismiss })} />, "example-close").props.onClick as () => void)();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "framed",
      '<button type="button" data-testid="example-close" aria-label="close example" class="rounded border border-edge px-1.5 py-0.5 text-ink-soft hover:border-brass hover:text-brass">×</button>'
    ],
    [
      "plain",
      '<button type="button" data-testid="example-close" aria-label="close example" class="rounded px-1.5 text-ink-dim hover:text-ink">✕</button>'
    ],
    [
      "compact",
      '<button type="button" data-testid="example-close" aria-label="close example" title="close example" class="rounded border border-edge px-1.5 text-ink-dim hover:border-brass hover:text-brass">×</button>'
    ]
  ] as const)("draws the %s close button", (look, button) => {
    const markup = draw(
      <DialogFrameView {...base({ close: { testId: "example-close", label: "close example", look } })} />
    );
    expect(markup).toContain(button);
  });

  it("can take focus on its close button as it opens", () => {
    const close = findByTestId(
      <DialogFrameView
        {...base({ close: { testId: "example-close", label: "close example", look: "plain", autoFocus: true } })}
      />,
      "example-close"
    );
    expect(close.props.autoFocus).toBe(true);
  });

  it("hangs from the top on its layer when placed there", () => {
    const markup = draw(<DialogFrameView {...base({ layer: "z-40", placement: "top" })} />);
    expect(tagOf(markup, "example-backdrop")).toContain(
      'class="fixed inset-0 z-40 flex items-start justify-center pt-[10vh] bg-black/50"'
    );
  });

  it("swallows a dropped file only when asked to", () => {
    const plain = findByTestId(<DialogFrameView {...base()} />, "example-backdrop");
    expect(plain.props.onDragOver).toBeUndefined();
    expect(plain.props.onDrop).toBeUndefined();
    const backdrop = findByTestId(
      <DialogFrameView {...base({ swallowFileDrops: true })} />,
      "example-backdrop"
    );
    for (const handler of ["onDragOver", "onDrop"]) {
      const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      (backdrop.props[handler] as (e: typeof event) => void)(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    }
  });

  it("carries no test ids it was not given", () => {
    const markup = draw(
      <DialogFrameView {...base({ backdropTestId: undefined, testId: undefined })} />
    );
    expect(markup).not.toContain("example-backdrop");
    expect(markup).not.toContain("example-dialog");
    expect(queryByTestId(<DialogFrameView {...base()} />, "example-body")).not.toBeNull();
  });
});
