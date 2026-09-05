import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { GameDataLink, ProblemMessage, ProblemWho, Row, SeverityMark } from "./primitives";

describe("SeverityMark", () => {
  it("marks a warning with an amber glyph and the word warning", () => {
    const markup = renderToStaticMarkup(<SeverityMark severity="warning" />);

    expect(markup).toContain("⚠");
    expect(markup).toContain("text-warn");
    expect(markup).toContain("aria-hidden");
    expect(markup).toContain(">warning<");
  });

  it("marks an error with a red cross and the word error", () => {
    const markup = renderToStaticMarkup(<SeverityMark severity="error" />);

    expect(markup).toContain("✕");
    expect(markup).toContain("text-danger");
    expect(markup).toContain(">error<");
    expect(markup).not.toContain("text-warn");
  });
});

describe("ProblemWho", () => {
  it("names the unit, and says so for a screen reader", () => {
    const markup = renderToStaticMarkup(<ProblemWho unitId="2042" />);

    expect(markup).toContain("2042");
    expect(markup).toContain(">unit <");
  });

  it("says hex when the problem belongs to no unit", () => {
    const markup = renderToStaticMarkup(<ProblemWho unitId={null} />);

    expect(markup).toContain(">hex<");
    expect(markup).toContain("italic");
    expect(markup).toContain("the whole hex");
  });

  it("a unit id with a way to select it renders as a button", () => {
    const markup = renderToStaticMarkup(
      <ProblemWho unitId="2042" known={new Set(["2042"])} onSelectUnit={() => {}} />
    );

    expect(markup).toContain("<button");
    expect(markup).toContain('data-testid="problem-unit-2042"');
    expect(markup).toContain("text-brass");
    expect(markup).toContain("hover:underline");
    expect(markup).toContain("focus-visible:outline-brass");
    expect(markup).toContain(">unit <");
    expect(markup).toContain("2042");
  });

  it("a unit id with no handler stays plain text", () => {
    const markup = renderToStaticMarkup(<ProblemWho unitId="2042" known={new Set(["2042"])} />);

    expect(markup).not.toContain("<button");
    expect(markup).toContain(">unit <");
    expect(markup).toContain("2042");
  });

  it("a unit the report does not describe stays plain text", () => {
    const markup = renderToStaticMarkup(
      <ProblemWho unitId="9002" known={new Set(["2042"])} onSelectUnit={() => {}} />
    );

    expect(markup).not.toContain("<button");
    expect(markup).toContain("9002");
  });

  it("a hex-level diagnostic still reads hex", () => {
    const markup = renderToStaticMarkup(
      <ProblemWho unitId={null} known={new Set(["2042"])} onSelectUnit={() => {}} />
    );

    expect(markup).toContain(">hex<");
    expect(markup).not.toContain("<button");
  });
});

describe("ProblemMessage", () => {
  const known = new Set(["4021", "18642"]);

  it("links every unit a message names", () => {
    const markup = renderToStaticMarkup(
      <ProblemMessage message="unit 4021 is not building" known={known} onSelectUnit={() => {}} />
    );

    expect(markup).toContain('data-testid="problem-unit-4021"');
    expect(markup).toContain("text-brass");
    expect(markup).toContain("is not building");
  });

  it("links both when a message names two", () => {
    const markup = renderToStaticMarkup(
      <ProblemMessage
        message="unit 4021 is teaching unit 18642 already"
        known={known}
        onSelectUnit={() => {}}
      />
    );

    expect(markup).toContain('data-testid="problem-unit-4021"');
    expect(markup).toContain('data-testid="problem-unit-18642"');
  });

  it("leaves a unit the report does not describe as plain text", () => {
    const markup = renderToStaticMarkup(
      <ProblemMessage
        message="unit 9002 is not in this hex to be taught"
        known={known}
        onSelectUnit={() => {}}
      />
    );

    expect(markup).not.toContain("<button");
    expect(markup).toContain("9002");
    expect(markup).toContain("is not in this hex to be taught");
  });

  it("leaves a message naming no unit alone", () => {
    const markup = renderToStaticMarkup(
      <ProblemMessage message="nobody is guarding this hex" known={known} onSelectUnit={() => {}} />
    );

    expect(markup).not.toContain("<button");
    expect(markup).toContain("nobody is guarding this hex");
  });

  it("renders the message unchanged with no handler", () => {
    const markup = renderToStaticMarkup(<ProblemMessage message="unit 4021 is not building" />);

    expect(markup).not.toContain("<button");
    expect(markup).toContain("unit 4021 is not building");
  });

  it("links the second call as well as the first", () => {
    const once = renderToStaticMarkup(
      <ProblemMessage message="unit 4021 is not building" known={known} onSelectUnit={() => {}} />
    );
    const twice = renderToStaticMarkup(
      <ProblemMessage message="unit 4021 is not building" known={known} onSelectUnit={() => {}} />
    );

    expect(twice).toBe(once);
    expect(twice).toContain('data-testid="problem-unit-4021"');
  });

  it("names the button unit 4021 and hides the visible word, so it is heard once", () => {
    const markup = renderToStaticMarkup(
      <ProblemMessage message="unit 4021 is not building" known={known} onSelectUnit={() => {}} />
    );

    // The word inside the button, for its accessible name; the visible one hidden, so linear
    // reading does not hear "unit unit 4021".
    expect(markup).toContain('<button type="button" data-testid="problem-unit-4021"');
    expect(markup).toContain('<span class="sr-only">unit </span>4021');
    expect(markup).toContain('aria-hidden="true">unit </span>');
  });
});

describe("a game data link", () => {
  it("is a button carrying its entry id", () => {
    const html = renderToStaticMarkup(
      <GameDataLink entryId="skill:LUMB" onOpen={() => {}}>
        lumberjack
      </GameDataLink>
    );
    expect(html).toContain('type="button"');
    expect(html).toContain('data-game-data-entry="skill:LUMB"');
    expect(html).toContain("lumberjack");
  });

  it("takes focus visibly, so the hover-led affordance is reachable from the keyboard", () => {
    const html = renderToStaticMarkup(
      <GameDataLink entryId="skill:LUMB" onOpen={() => {}}>
        lumberjack
      </GameDataLink>
    );
    expect(html).toContain("focus-visible:outline");
    expect(html).toContain("border-dotted");
  });

  it("lets a row's label be a node, not only a string", () => {
    const html = renderToStaticMarkup(
      <Row
        label={
          <GameDataLink entryId="skill:LUMB" onOpen={() => {}}>
            lumberjack
          </GameDataLink>
        }
        value="1 · 30"
      />
    );
    expect(html).toContain('data-game-data-entry="skill:LUMB"');
  });
});

describe("a formed subject in the Problems panel", () => {
  // Decision D1 (`ah-ty3s.1`): the entry selects the formed unit itself, so it is a control only
  // when that unit can be reached - which is what `known` says.
  const draw = (known: ReadonlySet<string>) =>
    renderToStaticMarkup(
      <ProblemWho
        unitId="new-1"
        formed={{ alias: "1", formedBy: "1922" }}
        regionId="1:6,52"
        known={known}
        onSelectUnit={() => {}}
      />
    );

  it("a formed subject is a button only when the formed unit itself can be reached", () => {
    expect(draw(new Set(["1922"]))).not.toContain("<button");
    const reachable = draw(new Set(["1922", "new-1"]));
    expect(reachable).toContain('data-testid="problem-unit-new-1"');
    expect(reachable).toContain("new 1");
  });
});
