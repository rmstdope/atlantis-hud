import { describe, expect, it } from "vitest";
import { SvgPainter } from "./svgPainter";

/** The elements drawn, without the `<svg>` wrapper and `<defs>`. */
function body(painter: SvgPainter): string {
  return painter.toSvg(256).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "").replace(/<defs>.*<\/defs>/s, "");
}

function pathPoints(svg: string): number[][] {
  const d = svg.match(/ d="([^"]*)"/)?.[1] ?? "";
  return [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe("SvgPainter (the canvas subset the Shapes set is drawn with)", () => {
  it("draws nothing until something is filled or stroked", () => {
    const painter = new SvgPainter(256);
    painter.beginPath();
    painter.moveTo(1, 1);
    painter.lineTo(5, 5);
    expect(body(painter)).toBe("");
    expect(painter.isEmpty()).toBe(true);
  });

  it("turns a full arc into one closed path around its centre", () => {
    const painter = new SvgPainter(256);
    painter.fillStyle = "rgb(10,20,30)";
    painter.beginPath();
    painter.arc(100, 50, 10, 0, 7);
    painter.fill();
    const svg = body(painter);
    expect(svg).toContain('fill="rgb(10,20,30)"');
    expect(svg).toMatch(/ d="[^"]*Z"/);
    for (const [x, y] of pathPoints(svg)) {
      expect(Math.hypot(x - 100, y - 50)).toBeCloseTo(10, 1);
    }
  });

  it("keeps a partial ellipse open, between its two angles", () => {
    const painter = new SvgPainter(256);
    painter.strokeStyle = "rgb(1,2,3)";
    painter.lineWidth = 2;
    painter.beginPath();
    painter.ellipse(50, 50, 20, 10, 0, 0, Math.PI);
    painter.stroke();
    const svg = body(painter);
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).not.toMatch(/Z"/);
    const points = pathPoints(svg);
    expect(points[0][0]).toBeCloseTo(70, 3);
    expect(points[0][1]).toBeCloseTo(50, 3);
    expect(points.at(-1)?.[0]).toBeCloseTo(30, 3);
    expect(points.every(([, y]) => y >= 50 - 1e-6)).toBe(true);
  });

  it("splits an rgba colour into the colour and its opacity", () => {
    const painter = new SvgPainter(256);
    painter.fillStyle = "rgba(255,80,10,0.5)";
    painter.fillRect(0, 0, 10, 10);
    const svg = body(painter);
    expect(svg).toContain('fill="rgb(255,80,10)"');
    expect(svg).toContain('fill-opacity="0.5"');
  });

  it("moves recorded points by translate and rotate, and restore undoes both and the style", () => {
    const painter = new SvgPainter(256);
    painter.save();
    painter.fillStyle = "rgb(9,9,9)";
    painter.translate(100, 100);
    painter.rotate(Math.PI / 2);
    painter.beginPath();
    painter.moveTo(10, 0);
    painter.lineTo(0, 0);
    painter.lineTo(0, 5);
    painter.fill();
    painter.restore();
    painter.beginPath();
    painter.moveTo(10, 0);
    painter.lineTo(0, 0);
    painter.lineTo(0, 5);
    painter.fill();
    const [turned, plain] = body(painter).split("/>").filter(Boolean);
    const first = pathPoints(turned)[0];
    expect(first[0]).toBeCloseTo(100, 6);
    expect(first[1]).toBeCloseTo(110, 6);
    expect(turned).toContain('fill="rgb(9,9,9)"');
    expect(pathPoints(plain)[0]).toEqual([10, 0]);
    expect(plain).toContain('fill="rgb(0,0,0)"');
  });

  it("puts a radial gradient in defs and fills from it", () => {
    const painter = new SvgPainter(256);
    const gradient = painter.createRadialGradient(8, 8, 1, 10, 10, 6);
    gradient.addColorStop(0, "rgb(200,200,200)");
    gradient.addColorStop(1, "rgba(20,80,84,0)");
    painter.fillStyle = gradient;
    painter.beginPath();
    painter.arc(10, 10, 6, 0, 7);
    painter.fill();
    const svg = painter.toSvg(256);
    const id = svg.match(/<radialGradient id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(svg).toContain('gradientUnits="userSpaceOnUse"');
    expect(svg).toMatch(/cx="10" cy="10" r="6" fx="8" fy="8"/);
    expect(svg).toContain('<stop offset="1" stop-color="rgb(20,80,84)" stop-opacity="0"/>');
    expect(body(painter)).toContain(`fill="url(#${id})"`);
  });

  it("draws a glow as a blurred copy in the shadow colour beneath the shape", () => {
    const painter = new SvgPainter(256);
    painter.shadowColor = "rgba(255,90,0,0.9)";
    painter.shadowBlur = 8;
    painter.strokeStyle = "rgba(255,80,10,0.5)";
    painter.beginPath();
    painter.moveTo(0, 0);
    painter.lineTo(10, 10);
    painter.stroke();
    const svg = painter.toSvg(256);
    expect(svg).toMatch(/<filter id="[^"]+"[^>]*><feGaussianBlur stdDeviation="4"\/><\/filter>/);
    const [glow, shape] = body(painter).split("/>").filter(Boolean);
    expect(glow).toContain("filter=");
    expect(glow).toContain('stroke="rgb(255,90,0)"');
    expect(glow).toContain('stroke-opacity="0.45"');
    expect(shape).not.toContain("filter=");
    expect(shape).toContain('stroke="rgb(255,80,10)"');
  });

  it("draws the tile at any pixel size, keeping its own coordinates", () => {
    const svg = new SvgPainter(256).toSvg(512);
    expect(svg).toMatch(/^<svg [^>]*width="512" height="512" viewBox="0 0 256 256"/);
  });
});
