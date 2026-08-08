import type { ReactNode } from "react";

/** A labelled group inside a panel, with an optional count so the user knows what is hidden. */
export function Section({
  title,
  count,
  asOf,
  children
}: {
  title: string;
  count?: number;
  asOf?: string | null;
  children: ReactNode;
}) {
  return (
    <>
      <p className="mt-2.5 mb-1 text-[10px] uppercase tracking-[0.1em] text-brass">
        {title}
        {count === undefined ? null : (
          <span className="ml-1.5 normal-case tracking-normal text-ink-dim">{count}</span>
        )}
        {asOf ? (
          <span className="ml-1.5 normal-case tracking-normal text-warn">{asOf}</span>
        ) : null}
      </p>
      {children}
    </>
  );
}

/** A label and value on one line, with the value aligned right. */
export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="tabular-nums text-ink-soft">{value}</span>
    </div>
  );
}

/** A key and value in a two-column grid, for the fixed fields at the top of a panel. */
export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-ink-soft">{label}</dt>
      <dd className="m-0 tabular-nums">{value}</dd>
    </>
  );
}

/** States an absence explicitly, rather than leaving a blank the user has to interpret. */
export function Absent({ children }: { children: ReactNode }) {
  return <p className="m-0 italic text-ink-dim">{children}</p>;
}

/** Warns that what follows was true at some earlier turn and may since have changed. */
export function StaleBanner({ lastSeenTurn, ageInTurns }: { lastSeenTurn: number; ageInTurns: number }) {
  return (
    <p className="mb-2 flex gap-2 rounded border border-l-[3px] border-brass/60 bg-brass/10 px-2 py-1.5 text-[#e6c884]">
      <span aria-hidden>&#9719;</span>
      <span>
        <strong className="font-medium text-[#f2dda6]">Last seen turn {lastSeenTurn}</strong>
        {ageInTurns > 0 ? `, ${ageInTurns} turn${ageInTurns === 1 ? "" : "s"} ago` : ""}. Not in the
        current report, so these figures may be out of date.
      </span>
    </p>
  );
}
