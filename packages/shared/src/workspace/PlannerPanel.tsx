import type {
  Coordinate,
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

/**
 * How a water terrain is named in a sentence: "the lake"/"a lake" for anything the report names,
 * but the ocean is "the sea" and "ocean", because that is what players already read.
 */
const WATER_WORDS: Record<
  string,
  { definite: string; indefinite: string; deepDefinite?: string; deepIndefinite?: string }
> = {
  ocean: {
    definite: "the sea",
    indefinite: "ocean",
    deepDefinite: "the deep sea",
    deepIndefinite: "deep sea"
  }
};

function definiteWater(terrain: string): string {
  const word = terrain.toLowerCase();
  return WATER_WORDS[word]?.definite ?? `the ${word}`;
}

function indefiniteWater(terrain: string): string {
  const word = terrain.toLowerCase();
  return WATER_WORDS[word]?.indefinite ?? `a ${word}`;
}

function capitalised(sentence: string): string {
  return sentence.slice(0, 1).toUpperCase() + sentence.slice(1);
}

/**
 * The two halves of a water refusal: one for water standing in the way, one for water the player
 * clicked on, of which "in the way" is untrue.
 */
function waterOpening(problem: {
  coordinate: Coordinate;
  terrain: string;
  destination: boolean;
}): string {
  const where = `(${problem.coordinate.x},${problem.coordinate.y})`;
  return problem.destination
    ? `${where} is ${indefiniteWater(problem.terrain)}`
    : `${capitalised(definiteWater(problem.terrain))} at ${where} is in the way`;
}

/**
 * The same, for water the depth rule refuses: "the deep sea" rather than "the sea".
 *
 * Deep water can only ever be the ocean terrain - every terrain the swimming rule names as
 * unrestricted is open whatever its depth - so the fallback here exists for the compiler rather
 * than for a player.
 */
function deepOpening(problem: {
  coordinate: Coordinate;
  terrain: string;
  destination: boolean;
}): string {
  const word = problem.terrain.toLowerCase();
  const where = `(${problem.coordinate.x},${problem.coordinate.y})`;
  return problem.destination
    ? `${where} is ${WATER_WORDS[word]?.deepIndefinite ?? `deep ${word}`}`
    : `${capitalised(WATER_WORDS[word]?.deepDefinite ?? `the deep ${word}`)} at ${where} is in the way`;
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
      return `${capitalised(definiteWater(problem.terrain))} at (${problem.coordinate.x},${problem.coordinate.y}) is in the way, and crossing it needs a ship.`;
    case "destinationNeedsShip":
      return `(${problem.coordinate.x},${problem.coordinate.y}) is ${indefiniteWater(problem.terrain)}, and this unit would need a ship to be there.`;
    case "swimLoadTooHeavy":
      return `${waterOpening(problem)}, and this unit cannot swim carrying ${problem.load} when it can bear ${problem.capacity}.`;
    case "deepWaterNeedsSeaCreatures":
      return problem.borne > 0
        ? `${deepOpening(problem)}, and this unit's sea creatures can bear ${problem.borne} of its ${problem.load}.`
        : `${deepOpening(problem)}, and this unit can swim only in coastal water.`;
    case "waterDepthUnknown":
      return `There is no telling whether ${definiteWater(problem.terrain)} at (${problem.coordinate.x},${problem.coordinate.y}) is deep, and this unit can swim only in coastal water.`;
    case "swimCapacityUnstated":
      return `The report does not say how much this unit can carry while swimming, so there is no telling whether it can enter ${definiteWater(problem.terrain)} at (${problem.coordinate.x},${problem.coordinate.y}).`;
    case "flightWouldEndOverOcean":
      return `A single MOVE order would leave this unit over ${definiteWater(problem.terrain)} at (${problem.coordinate.x},${problem.coordinate.y}) when the month ran out, and a unit that ends a turn over water drowns.`;
    case "crewCannotSail":
      return `The crew cannot sail this fleet: it needs ${problem.required} levels of sailing, and the units aboard have ${problem.available}.`;
    case "notFleetOwner":
      return `${problem.unit} is a passenger on ${problem.fleet}. Only its owner, ${problem.owner}, can set its course.`;
    case "fleetOverloaded":
      // The weight aboard first, then the hull's capacity, then what follows from it - the
      // skeleton the crew refusal beside this one uses. Naming the shortfall ("put 60 ashore")
      // was offered and not taken: it promises a fix that is false when the crew is short too.
      return problem.crew
        ? `This fleet will not sail: it is carrying ${problem.load} on a capacity of ${problem.capacity}, and the units aboard have ${problem.crew.available} levels of sailing where it needs ${problem.crew.required}.`
        : `This fleet is carrying more than it can hold: ${problem.load} aboard on a capacity of ${problem.capacity}, so it will not sail.`;
    case "sailNeedsOcean":
      return `A fleet may only sail where one end of the step is water, so it cannot go from ${problem.fromTerrain} (${problem.from.x},${problem.from.y}) straight to ${problem.toTerrain} (${problem.to.x},${problem.to.y}).`;
    case "isthmusNeedsCanal":
      return `A fleet must leave a land hex by the side it entered or one beside it, so it cannot sail straight through ${problem.terrain} (${problem.coordinate.x},${problem.coordinate.y}).`;
    case "fleetLandingInland":
      return `A fleet may land only on a coast, and ${problem.terrain.toLowerCase()} (${problem.coordinate.x},${problem.coordinate.y}) touches no sea.`;
    case "fleetLandingCoastUnknown":
      return `A fleet may land only on a coast, and there is no telling whether ${problem.terrain.toLowerCase()} (${problem.coordinate.x},${problem.coordinate.y}) touches the sea.`;
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

  return `${guessed} of these hexes ${guessed === 1 ? "is" : "are"} unexplored: the terrain, the cost and whatever stands there are guesses, and one of them may be water.`;
}

/**
 * Why the sailing weight check is missing, or nothing when it was made.
 *
 * A route the panel is sure about and one it could not check must not look alike; that is the
 * silent confidence this exists to remove.
 */
export function describeLoadCheck(plan: RoutePlan): string | null {
  if (!plan.loadUnchecked) {
    return null;
  }

  return "The report doesn't say how much this fleet is carrying, so whether it is light enough to sail has not been checked.";
}

/**
 * What a wet step says it is. A flier is over the water, a fleet is on it and has nothing to
 * report, and anything else standing in water got there by swimming - there is no other way in.
 */
function waterMark(mode: RoutePlan["mode"]): string {
  if (mode === "fly") return " · over water";
  if (mode === "sail") return "";
  return " · swimming";
}

/** One route step as the panel prints it. */
export function describeStep(step: RouteStep, mode: RoutePlan["mode"]): string {
  if (step.estimated) {
    // An unexplored hex is named as such rather than by the terrain it was taken for: that terrain
    // is the guess, and printing it as though it were reported would be the panel inventing a
    // sighting.
    return `unexplored (${step.to.x},${step.to.y}) · ${step.cost} · estimated`;
  }
  const wet = step.overWater ? waterMark(mode) : "";
  // The suffix sits where `· road` sits. No sailing step is ever both - a fleet's step is never on
  // a road and a canal region is land, so `overWater` is false - so the order is settled rather
  // than load-bearing.
  const through = step.canal ? ` · ${step.canal}` : "";
  return `${step.terrain} (${step.to.x},${step.to.y}) · ${step.cost}${step.road ? " · road" : ""}${through}${wet}`;
}

function Route({ answer }: { answer: RoutePlanResponse }) {
  const plan = answer.plan;
  if (!plan) {
    return null;
  }

  const months = plan.months.length;
  const estimate = describeEstimate(plan.steps);
  const loadCheck = describeLoadCheck(plan);

  return (
    <div data-testid="planner-route">
      {estimate ? (
        <p data-testid="planner-estimate" className="m-0 mb-2 text-warn">
          {estimate}
        </p>
      ) : null}

      {loadCheck ? (
        <p data-testid="planner-load-caution" className="m-0 mb-2 text-warn">
          {loadCheck}
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
            <li
              key={`${step.to.x},${step.to.y},${index}`}
              className={step.overWater && plan.mode !== "sail" ? "text-select" : undefined}
            >
              <Row
                // The same shorthand the exits list and the MOVE order itself use.
                label={`${index + 1}. ${abbreviateDirection(step.direction)}`}
                value={describeStep(step, plan.mode)}
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
