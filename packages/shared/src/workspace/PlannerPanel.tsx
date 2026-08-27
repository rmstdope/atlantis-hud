import type {
  ReportUnit,
  RoutePlan,
  RoutePlanResponse,
  RouteProblem,
  RouteStep
} from "@atlantis/core-client";
import { useEffect, useRef } from "react";
import { abbreviateDirection } from "../hexMapModel";
import { Absent, Field, Row, Section } from "./primitives";

/**
 * The Plan move / Clear pair, for the shared Unit/Movement slot's title bar.
 *
 * Split out of the panel this file used to be when Unit and Movement came to share one slot
 * (ah-zh5i.2): the slot owns the header, so the buttons have to be handed to it.
 */
export function PlannerActions({
  unit,
  armed,
  busy,
  onArm,
  onClear,
  hasAnswer
}: {
  unit: ReportUnit | null;
  armed: boolean;
  busy: boolean;
  onArm: () => void;
  onClear: () => void;
  /** Whether there is a route or a refusal standing, which is what `Clear` has to clear. */
  hasAnswer: boolean;
}) {
  const canPlan = Boolean(unit?.own);

  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        data-testid="planner-arm"
        disabled={!canPlan || busy}
        onClick={onArm}
        className="rounded border border-edge bg-ground px-2 py-0.5 text-pane text-ink enabled:hover:border-select disabled:opacity-40"
      >
        {armed ? "Pick a hex…" : "Plan move"}
      </button>
      <button
        type="button"
        data-testid="planner-clear"
        disabled={!hasAnswer && !armed}
        onClick={onClear}
        className="rounded border border-edge bg-ground px-2 py-0.5 text-pane text-ink enabled:hover:border-select disabled:opacity-40"
      >
        Clear
      </button>
    </div>
  );
}

/**
 * The route, or the reason there is none.
 *
 * Every refusal is named. "The sea is in the way at (8,52)" is something a player can act on, where
 * "no route" is not, so the panel spends its space on saying which of the two it is.
 *
 * The body scrolls and the Apply row does not. Before ah-zh5i.2 the whole thing was one block
 * inside `CollapsiblePanel`'s own `overflow-auto`, so a long route pushed `Apply to orders` out of
 * sight - and a route of any length pushed the orders editor below the slot underneath the units
 * pane, where it could not be clicked at all.
 */
export function PlannerBody({
  unit,
  armed,
  busy,
  answer,
  onApply
}: {
  unit: ReportUnit | null;
  armed: boolean;
  busy: boolean;
  answer: RoutePlanResponse | null;
  onApply: (order: string) => void;
}) {
  const canPlan = Boolean(unit?.own);
  const plan = canPlan && !busy ? (answer?.plan ?? null) : null;
  const apply = useRef<HTMLButtonElement | null>(null);
  const lastPlan = useRef<RoutePlan | null>(plan);

  /**
   * Focus lands on Apply when a route arrives, chosen with the navigator: the next likely action is
   * under the hand and Enter applies it.
   *
   * Keyed on the plan rather than on the answer, and that is not a detail. The shell sets the route
   * and clears `busy` in two separate commits, so on the commit the answer arrives the button is
   * still not rendered and a ref read there is null - which is exactly how an answer-keyed effect
   * fired once, harmlessly, and left focus on the map (found in the smoke suite building ah-zh5i.2).
   * The plan is what the button's presence follows, so an effect on it can never run ahead of it.
   *
   * The ref starts at the plan this component mounted with, so coming back to the Movement tab with
   * a route already standing steals no focus. `apply.current` is null exactly when the button is not
   * in the DOM - a refusal, the slot folded, the Unit tab showing - where focus stays put. And the
   * shell hands `setRoute` a fresh object for every answer, so re-planning the same route re-fires.
   */
  useEffect(() => {
    if (plan === lastPlan.current) {
      return;
    }
    lastPlan.current = plan;
    if (plan) {
      apply.current?.focus();
    }
  }, [plan]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-testid="planner-scroll" className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
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
          <Route answer={answer} />
        )}
      </div>
      {plan ? (
        // Pinned below the scroller rather than inside it: a long route used to push
        // `Apply to orders` out of sight, and a route of any length pushed the orders editor
        // underneath the units pane where it could not be clicked at all (ah-zh5i.2).
        <div className="mt-2 flex flex-none items-center gap-2 border-t border-edge px-2.5 py-2">
          <button
            type="button"
            ref={apply}
            data-testid="planner-apply"
            onClick={() => onApply(plan.order)}
            className="rounded border border-edge bg-ground px-2 py-0.5 text-pane text-brass hover:border-select"
          >
            Apply to orders
          </button>
          <code data-testid="planner-order" className="text-pane text-ink-soft">
            {plan.order}
          </code>
        </div>
      ) : null}
    </div>
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
    case "oceanNeedsShip":
      return `The sea at (${problem.coordinate.x},${problem.coordinate.y}) is in the way, and crossing it needs a ship.`;
    case "flightWouldEndOverOcean":
      return `A single MOVE order would leave the unit over water at (${problem.coordinate.x},${problem.coordinate.y}) when the month ran out, and a unit that ends a turn over water drowns.`;
    case "crewCannotSail":
      return `The crew cannot sail this fleet: it needs ${problem.required} levels of sailing, and the units aboard have ${problem.available}.`;
  }
}

function Refusal({ problem }: { problem: RouteProblem }) {
  return (
    <p data-testid="planner-problem" className="m-0 text-danger">
      {describeProblem(problem)}
    </p>
  );
}

/**
 * How much of a route was invented, or nothing when none of it was.
 *
 * A cost that looks like every other cost is read as a fact, and the cost of a step into
 * unexplored country is not one: the core takes such a hex for the terrain behind it, which is a
 * guess about the going, about whether the way is even passable, and about what is standing there.
 * Saying how many hexes that covers is what keeps the rest of the panel honest.
 */
export function describeEstimate(steps: RouteStep[]): string | null {
  const guessed = steps.filter((step) => step.estimated).length;
  if (guessed === 0) {
    return null;
  }

  return `${guessed} of these hexes ${guessed === 1 ? "is" : "are"} unexplored: the terrain, the cost and whatever stands there are guesses, and one of them may be sea.`;
}

function Route({ answer }: { answer: RoutePlanResponse }) {
  const plan = answer.plan;
  if (!plan) {
    return null;
  }

  const months = plan.months.length;
  const estimate = describeEstimate(plan.steps);

  return (
    <div data-testid="planner-route">
      {estimate ? (
        <p data-testid="planner-estimate" className="m-0 mb-2 text-warn">
          {estimate}
        </p>
      ) : null}

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
                // An unexplored hex is named as such rather than by the terrain it was taken for:
                // that terrain is the guess, and printing it as though it were reported would be
                // the panel inventing a sighting.
                value={
                  step.estimated
                    ? `unexplored (${step.to.x},${step.to.y}) · ${step.cost} · estimated`
                    : `${step.terrain} (${step.to.x},${step.to.y}) · ${step.cost}${step.road ? " · road" : ""}`
                }
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
