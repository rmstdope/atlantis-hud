import { describe, expect, it } from "vitest";
import { levelForPoints, monthEnd, pointsForLevel, projectedLevel, STUDY_POINTS_PER_MONTH } from "./studyProgress";

describe("pointsForLevel", () => {
  it("follows the rules' month structure at thirty points a month", () => {
    expect([0, 1, 2, 3, 4, 5].map(pointsForLevel)).toEqual([0, 30, 90, 180, 300, 450]);
  });

  it("is thirty per month of study", () => {
    expect(STUDY_POINTS_PER_MONTH).toBe(30);
  });
});

describe("levelForPoints", () => {
  it("compares against thresholds rather than dividing", () => {
    expect(levelForPoints(0)).toBe(0);
    expect(levelForPoints(29)).toBe(0);
    expect(levelForPoints(449)).toBe(4);
    expect(levelForPoints(450)).toBe(5);
    // Practice grants partial points, so a real report carries numbers off the thresholds.
    expect(levelForPoints(115)).toBe(2);
    expect(levelForPoints(245)).toBe(3);
  });

  it("is never negative", () => {
    expect(levelForPoints(-10)).toBe(0);
  });
});

describe("projectedLevel", () => {
  it("adds thirty a month to the points the sheet reported", () => {
    expect(projectedLevel({ level: 3, points: 270 }, 3, 5)).toBe(4);
  });

  it("stays where it was when the months could not carry it over the threshold", () => {
    expect(projectedLevel({ level: 3, points: 180 }, 3, 5)).toBe(3);
  });

  it("is capped at the skill's own maximum", () => {
    expect(projectedLevel({ level: 4, points: 325 }, 12, 5)).toBe(5);
  });

  it("returns the reported level when no month has passed", () => {
    expect(projectedLevel({ level: 2, points: 95 }, 0, 5)).toBe(2);
  });

  it("never falls below the reported level, whatever the points say", () => {
    expect(projectedLevel({ level: 3, points: 0 }, 0, 5)).toBe(3);
  });
});

// ah-2k4z: the one place a month's points are added, for the projection and the dropdown alike.
describe("monthEnd", () => {
  it("adds a studied month of thirty points", () => {
    expect(monthEnd({ level: 1, points: 30 }, { studied: 1, practised: false }, 5)).toEqual({
      level: 1,
      points: 60
    });
  });

  it("adds two months for a taught month", () => {
    expect(monthEnd({ level: 1, points: 30 }, { studied: 2, practised: false }, 5)).toEqual({
      level: 2,
      points: 90
    });
  });

  it("keeps a halved month's points fractional", () => {
    expect(monthEnd({ level: 3, points: 180 }, { studied: 0.75, practised: false }, 5)).toEqual({
      level: 3,
      points: 202.5
    });
  });

  it("adds five points of practice with no study", () => {
    expect(monthEnd({ level: 1, points: 85 }, { studied: 0, practised: true }, 5)).toEqual({
      level: 2,
      points: 90
    });
  });

  it("adds practice on top of a studied month", () => {
    expect(monthEnd({ level: 1, points: 60 }, { studied: 1, practised: true }, 5)).toEqual({
      level: 2,
      points: 95
    });
  });

  it("caps the level at the skill's maximum and keeps the points", () => {
    expect(monthEnd({ level: 2, points: 150 }, { studied: 2, practised: false }, 2)).toEqual({
      level: 2,
      points: 210
    });
  });

  it("never reads below the level he already holds", () => {
    expect(monthEnd({ level: 3, points: 0 }, { studied: 1, practised: false }, 5)).toEqual({
      level: 3,
      points: 30
    });
  });
});
