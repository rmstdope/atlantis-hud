import type { RoutePlanResponse, RouteProblem, ReportUnit } from "@atlantis/core-client";
import { abbreviateDirection } from "../hexMapModel";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { Absent, Field, Row, Section } from "./primitives";

/**
 * The route, or the reason there is none.
 *
 * Every refusal is named. "The sea is in the way at (8,52)" is something a player can act on, where
 * "no route" is not, so the panel spends its space on saying which of the two it is.
 */
export function PlannerPanel({
  unit,
  armed,
  busy,
  answer,
  onArm,
  onClear,
  onApply
}: {
  unit: ReportUnit | null;
  armed: boolean;
  busy: boolean;
  answer: RoutePlanResponse | null;
  onArm: () => void;
  onClear: () => void;
  onApply: (order: string) => void;
}) {
  const canPlan = Boolean(unit?.own);

  return (
    <CollapsiblePanel
      panel="planner"
      title="Movement"
      hint={armed ? "— pick a destination on the map" : undefined}
      actions={
        <div className="flex gap-1.5">
          <button
            type="button"
            data-testid="planner-arm"
            disabled={!canPlan || busy}
            onClick={onArm}
            className="rounded border border-edge bg-ground px-2 py-0.5 text-[11px] text-ink enabled:hover:border-select disabled:opacity-40"
          >
            {armed ? "Pick a hex…" : "Plan move"}
          </button>
          <button
            type="button"
            data-testid="planner-clear"
            disabled={!answer && !armed}
            onClick={onClear}
            className="rounded border border-edge bg-ground px-2 py-0.5 text-[11px] text-ink enabled:hover:border-select disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      }
    >
      {!canPlan ? (
        <Absent>
          {unit
            ? "Only your own units can be given orders, so only they can be planned for."
            : "No unit selected."}
        </Absent>
      ) : busy ? (
        <Absent>Working out a route…</Absent>
      ) : !answer ? (
        <Absent>
          {armed ? "Pick a destination on the map." : "Plan a move to see its cost and risk."}
        </Absent>
      ) : answer.problem ? (
        <Refusal problem={answer.problem} />
      ) : (
        <Route answer={answer} onApply={onApply} />
      )}
    </CollapsiblePanel>
  );
}

/** Turns a typed refusal into a sentence, because a reason is the whole point of refusing. */
export function describeProblem(problem: RouteProblem): string {
  switch (problem.kind) {
    case "notYourUnit":
      return "That unit belongs to another faction, so you cannot order it.";
    case "overloaded":
      return "The unit is carrying more than it can move with, so the game will not give it a MOVE order at all.";
    case "mobilityUnstated":
      return "The report does not say what this unit can carry, so there is nothing to plan with.";
    case "alreadyThere":
      return "The unit is already standing there.";
    case "noKnownRoute":
      return "Nothing the faction has seen joins those two hexes up.";
    case "originUnknown":
      return "The map does not know the hex this unit is standing in.";
    case "unknownHex":
      return `Nothing is known about (${problem.coordinate.x},${problem.coordinate.y}), so a route there would have an invented cost.`;
    case "oceanNeedsShip":
      return `The sea at (${problem.coordinate.x},${problem.coordinate.y}) is in the way, and crossing it needs a ship.`;
    case "flightWouldEndOverOcean":
      return `A single MOVE order would leave the unit over water at (${problem.coordinate.x},${problem.coordinate.y}) when the month ran out, and a unit that ends a turn over water drowns.`;
  }
}

function Refusal({ problem }: { problem: RouteProblem }) {
  return (
    <p data-testid="planner-problem" className="m-0 text-danger">
      {describeProblem(problem)}
    </p>
  );
}

/** The order a route becomes, as the game writes it. */
export function routeAsOrder(answer: RoutePlanResponse): string {
  const steps = answer.plan?.steps ?? [];
  return `MOVE ${steps.map((step) => abbreviateDirection(step.direction)).join(" ")}`;
}

function Route({
  answer,
  onApply
}: {
  answer: RoutePlanResponse;
  onApply: (order: string) => void;
}) {
  const plan = answer.plan;
  if (!plan) {
    return null;
  }

  const months = plan.months.length;
  const order = routeAsOrder(answer);

  return (
    <div data-testid="planner-route">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-px">
        <Field label="To" value={`(${plan.to.x},${plan.to.y})`} />
        <Field label="Travel" value={plan.mode} />
        <Field label="Cost" value={`${plan.totalCost} movement point${plan.totalCost === 1 ? "" : "s"}`} />
        <Field label="Arrives" value={months === 1 ? "this month" : `in ${months} months`} />
      </dl>

      {answer.risk ? <Risk risk={answer.risk} /> : null}

      <Section title="Route" count={plan.steps.length}>
        <ol className="m-0 list-none p-0 text-ink-soft">
          {plan.steps.map((step, index) => (
            <li key={`${step.to.x},${step.to.y},${index}`}>
              <Row
                // The same shorthand the exits list and the MOVE order itself use.
                label={`${index + 1}. ${abbreviateDirection(step.direction)}`}
                value={`${step.terrain} (${step.to.x},${step.to.y}) · ${step.cost}${step.road ? " · road" : ""}`}
              />
            </li>
          ))}
        </ol>
      </Section>

      {months > 1 ? (
        <Section title="Months" count={months}>
          <ol className="m-0 list-none p-0 text-ink-soft">
            {plan.months.map((leg) => (
              <li key={leg.month}>
                <Row
                  label={`Month ${leg.month}`}
                  value={`${leg.steps} step${leg.steps === 1 ? "" : "s"}, ending (${leg.endsAt.x},${leg.endsAt.y})`}
                />
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          data-testid="planner-apply"
          onClick={() => onApply(order)}
          className="rounded border border-edge bg-ground px-2 py-0.5 text-[11px] text-brass hover:border-select"
        >
          Apply to orders
        </button>
        <code data-testid="planner-order" className="text-[11px] text-ink-soft">
          {order}
        </code>
      </div>
    </div>
  );
}

function Risk({ risk }: { risk: NonNullable<RoutePlanResponse["risk"]> }) {
  const colour =
    risk.level === "high" ? "text-danger" : risk.level === "medium" ? "text-warn" : "text-ok";

  return (
    <p data-testid="planner-risk" data-level={risk.level} className="m-0 mt-2">
      <strong className={`font-medium ${colour}`}>{risk.level} risk</strong>
      {risk.worst ? <span className="text-ink-soft"> — {risk.worst.reason}</span> : null}
    </p>
  );
}
