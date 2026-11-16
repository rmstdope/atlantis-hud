# ah-9vmbx.2 — the assistant asks the HUD to send the orders

## A Close button's `autoFocus` never took focus

**What happened.** Both Send dialogs swap their footer to a single Close once there is a result, and that button carries `autoFocus`. The acceptance needed "focus moves to Close", so the smoke walk asserted it, and it failed: `document.activeElement` was `<body>`, and no `focusin` ever fired on Close. A probe walk showed nothing taking focus at all.

**Why.** Not established. The Close replaces the Cancel/Send footer in an existing, already-mounted form, and React's `autoFocus` did not focus it there. Before the swap, the password field is disabled while the send is in flight, which drops focus to `<body>`.

**Cost.** One failed smoke run and one probe walk, about ten minutes. Today's own Send dialogs had the same gap without anyone noticing, because no walk ever asserted Close's focus.

**Prevent by.** Any dialog in `packages/shared/src/workspace/` that relies on `autoFocus` for an element appearing after a state change should move focus explicitly: a ref plus an effect keyed on that state, as `SendOrdersDialog.tsx` and `NewAgeSendDialog.tsx` now do. A smoke walk that names a focus rule should assert `toBeFocused()` on it.

**Seen before.** No. `ah-jpcj.1` is about a cited precedent that managed no focus, not about `autoFocus` failing.

## Escape pressed right after a dialog is drawn can arrive before its listener

**What happened.** A walk pressed Escape as soon as the assistant's prompt was visible, and the dialog stayed open. With a short wait first, the same press closed it.

**Why.** `useEscapeToDismiss` registers its document listener in an effect. The dialog here opens from outside any React event, from the assistant's call, so the effect can land a frame after the dialog is drawn and visible to Playwright.

**Cost.** One failed walk and a probe, about five minutes.

**Prevent by.** A smoke walk that presses Escape on a dialog opened programmatically should retry in `expect(...).toPass()` until the dialog is gone, as `tests/smoke/assistant-send.spec.ts` does. Asserting visibility alone does not show the dialog is listening yet.

**Seen before.** No.
