import { PopoverFrame } from "./popover";
import { SIGNED_OUT_ON_CLOSE } from "./newAgeSignInView";

/**
 * The popover behind the signed-in chip: who is signed in, that nothing is stored, and a way out.
 *
 * Split into a frame and a body for the reason `AddToArmyMenu` gives: `PopoverFrame` uses hooks and
 * focuses itself on mount, so a unit test in this package - which renders to static markup and runs
 * no effects - reaches the body rather than the frame.
 */
export function NewAgeWorldPanel({
  summary,
  onSignOut
}: {
  summary: string;
  onSignOut: () => void;
}) {
  return (
    <PopoverFrame testId="newage-panel" label="New Age world" align="right" width="w-72">
      <NewAgeWorldPanelBody summary={summary} onSignOut={onSignOut} />
    </PopoverFrame>
  );
}

/** Everything inside the frame - the half a unit test here can reach. */
export function NewAgeWorldPanelBody({
  summary,
  onSignOut
}: {
  summary: string;
  onSignOut: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink">{summary}</p>
      <p className="text-ink-dim">{SIGNED_OUT_ON_CLOSE}</p>
      <div className="flex justify-end">
        <button
          type="button"
          data-testid="newage-signout"
          onClick={onSignOut}
          className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
