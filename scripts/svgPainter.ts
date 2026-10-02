/**
 * A recording stand-in for the part of `CanvasRenderingContext2D` the Shapes texture set is drawn
 * with (ah-d9jb.2), producing SVG that `sharp` rasterises offline.
 *
 * The agreed pictures were drawn on a browser canvas in `docs/ui/ah-d9jb.2-shapes-set.html`; this
 * lets that drawing code be ported almost line for line, with no native canvas package to install.
 * Points are transformed by the current matrix as they are recorded, and arcs are sampled into
 * short line segments, so every shape comes out as a plain `<path>`.
 */

type Matrix = readonly [number, number, number, number, number, number];
type Point = readonly [number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SEGMENTS_PER_TURN = 64;

export class RadialGradient {
  readonly stops: { offset: number; colour: string }[] = [];

  constructor(
    readonly id: string,
    readonly focus: Point,
    readonly centre: Point,
    readonly radius: number
  ) {}

  addColorStop(offset: number, colour: string) {
    this.stops.push({ offset, colour });
  }
}

type Paint = string | RadialGradient;

type State = {
  fillStyle: Paint;
  strokeStyle: Paint;
  lineWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  shadowColor: string;
  shadowBlur: number;
  matrix: Matrix;
};

function number(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** A CSS colour as an SVG colour and an opacity: `rgba(1,2,3,0.5)` -> `rgb(1,2,3)`, 0.5. */
export function splitColour(colour: string): { colour: string; opacity: number } {
  const match = colour.replace(/\s+/g, "").match(/^rgba?\(([-\d.]+),([-\d.]+),([-\d.]+)(?:,([-\d.]+))?\)$/);
  if (!match) {
    return { colour, opacity: 1 };
  }
  const channel = (value: string) => Math.max(0, Math.min(255, Math.round(Number(value))));
  return {
    colour: `rgb(${channel(match[1])},${channel(match[2])},${channel(match[3])})`,
    opacity: match[4] === undefined ? 1 : Number(match[4])
  };
}

function apply(matrix: Matrix, x: number, y: number): Point {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}

export class SvgPainter {
  private state: State = {
    fillStyle: "rgb(0,0,0)",
    strokeStyle: "rgb(0,0,0)",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    shadowColor: "rgba(0,0,0,0)",
    shadowBlur: 0,
    matrix: IDENTITY
  };
  private readonly saved: State[] = [];
  private subpaths: { points: Point[]; closed: boolean }[] = [];
  private readonly elements: string[] = [];
  private readonly gradients: RadialGradient[] = [];
  private readonly blurs = new Set<number>();

  constructor(readonly size: number) {}

  get fillStyle(): Paint {
    return this.state.fillStyle;
  }
  set fillStyle(value: Paint) {
    this.state.fillStyle = value;
  }
  get strokeStyle(): Paint {
    return this.state.strokeStyle;
  }
  set strokeStyle(value: Paint) {
    this.state.strokeStyle = value;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(value: number) {
    this.state.lineWidth = value;
  }
  get lineCap(): State["lineCap"] {
    return this.state.lineCap;
  }
  set lineCap(value: State["lineCap"]) {
    this.state.lineCap = value;
  }
  get lineJoin(): State["lineJoin"] {
    return this.state.lineJoin;
  }
  set lineJoin(value: State["lineJoin"]) {
    this.state.lineJoin = value;
  }
  get shadowColor(): string {
    return this.state.shadowColor;
  }
  set shadowColor(value: string) {
    this.state.shadowColor = value;
  }
  get shadowBlur(): number {
    return this.state.shadowBlur;
  }
  set shadowBlur(value: number) {
    this.state.shadowBlur = value;
  }

  save() {
    this.saved.push({ ...this.state });
  }

  restore() {
    const state = this.saved.pop();
    if (state) {
      this.state = state;
    }
  }

  translate(x: number, y: number) {
    this.state.matrix = multiply(this.state.matrix, [1, 0, 0, 1, x, y]);
  }

  rotate(angle: number) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.state.matrix = multiply(this.state.matrix, [cos, sin, -sin, cos, 0, 0]);
  }

  beginPath() {
    this.subpaths = [];
  }

  moveTo(x: number, y: number) {
    this.subpaths.push({ points: [apply(this.state.matrix, x, y)], closed: false });
  }

  lineTo(x: number, y: number) {
    const current = this.subpaths.at(-1);
    if (!current || current.closed) {
      this.moveTo(x, y);
      return;
    }
    current.points.push(apply(this.state.matrix, x, y));
  }

  quadraticCurveTo(controlX: number, controlY: number, x: number, y: number) {
    const current = this.subpaths.at(-1);
    if (!current) {
      this.moveTo(controlX, controlY);
    }
    const start = this.untransformedLast();
    for (let step = 1; step <= 12; step += 1) {
      const t = step / 12;
      const u = 1 - t;
      this.lineTo(
        u * u * start[0] + 2 * u * t * controlX + t * t * x,
        u * u * start[1] + 2 * u * t * controlY + t * t * y
      );
    }
  }

  arc(x: number, y: number, radius: number, start: number, end: number) {
    this.ellipse(x, y, radius, radius, 0, start, end);
  }

  ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, start: number, end: number) {
    const full = end - start >= Math.PI * 2;
    const sweep = full ? Math.PI * 2 : end - start;
    const steps = Math.max(4, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * SEGMENTS_PER_TURN));
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const point = (angle: number): Point => {
      const px = radiusX * Math.cos(angle);
      const py = radiusY * Math.sin(angle);
      return apply(this.state.matrix, x + px * cos - py * sin, y + px * sin + py * cos);
    };
    const points: Point[] = [];
    for (let step = 0; step <= (full ? steps - 1 : steps); step += 1) {
      points.push(point(start + (sweep * step) / steps));
    }
    const current = this.subpaths.at(-1);
    if (full) {
      this.subpaths.push({ points, closed: true });
    } else if (current && !current.closed) {
      current.points.push(...points);
    } else {
      this.subpaths.push({ points, closed: false });
    }
  }

  closePath() {
    const current = this.subpaths.at(-1);
    if (current) {
      current.closed = true;
    }
  }

  fillRect(x: number, y: number, width: number, height: number) {
    const saved = this.subpaths;
    this.subpaths = [];
    this.moveTo(x, y);
    this.lineTo(x + width, y);
    this.lineTo(x + width, y + height);
    this.lineTo(x, y + height);
    this.closePath();
    this.fill();
    this.subpaths = saved;
  }

  fill() {
    this.emit("fill");
  }

  stroke() {
    this.emit("stroke");
  }

  createRadialGradient(x0: number, y0: number, _r0: number, x1: number, y1: number, r1: number): RadialGradient {
    const gradient = new RadialGradient(`g${this.gradients.length}`, [x0, y0], [x1, y1], r1);
    this.gradients.push(gradient);
    return gradient;
  }

  isEmpty(): boolean {
    return this.elements.length === 0;
  }

  /** The tile as SVG, drawn `pixels` wide in its own `size`-unit coordinates. */
  toSvg(pixels: number): string {
    const defs = [
      ...this.gradients.map((gradient) => {
        const stops = gradient.stops
          .map(({ offset, colour }) => {
            const split = splitColour(colour);
            const opacity = split.opacity === 1 ? "" : ` stop-opacity="${number(split.opacity)}"`;
            return `<stop offset="${number(offset)}" stop-color="${split.colour}"${opacity}/>`;
          })
          .join("");
        return (
          `<radialGradient id="${gradient.id}" gradientUnits="userSpaceOnUse" cx="${number(gradient.centre[0])}" ` +
          `cy="${number(gradient.centre[1])}" r="${number(gradient.radius)}" fx="${number(gradient.focus[0])}" ` +
          `fy="${number(gradient.focus[1])}">${stops}</radialGradient>`
        );
      }),
      ...[...this.blurs].map(
        (blur) =>
          `<filter id="${this.blurId(blur)}" filterUnits="userSpaceOnUse" x="${-this.size}" y="${-this.size}" ` +
          `width="${this.size * 3}" height="${this.size * 3}"><feGaussianBlur stdDeviation="${number(blur / 2)}"/></filter>`
      )
    ];
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${this.size} ${this.size}">` +
      (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
      this.elements.join("") +
      "</svg>"
    );
  }

  private blurId(blur: number): string {
    return `b${number(blur).replace(".", "_")}`;
  }

  private untransformedLast(): Point {
    const last = this.subpaths.at(-1)?.points.at(-1) ?? [0, 0];
    const [a, b, c, d, e, f] = this.state.matrix;
    const determinant = a * d - b * c;
    const x = last[0] - e;
    const y = last[1] - f;
    return [(d * x - c * y) / determinant, (-b * x + a * y) / determinant];
  }

  private paint(paint: Paint): { colour: string; opacity: number } {
    return typeof paint === "string" ? splitColour(paint) : { colour: `url(#${paint.id})`, opacity: 1 };
  }

  private emit(mode: "fill" | "stroke") {
    const d = this.subpaths
      .filter((subpath) => subpath.points.length > (mode === "fill" ? 2 : 1))
      .map(
        ({ points, closed }) =>
          points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${number(x)} ${number(y)}`).join("") + (closed ? "Z" : "")
      )
      .join("");
    if (!d) {
      return;
    }
    const own = this.paint(mode === "fill" ? this.state.fillStyle : this.state.strokeStyle);
    const shadow = splitColour(this.state.shadowColor);
    if (this.state.shadowBlur > 0 && shadow.opacity > 0) {
      this.blurs.add(this.state.shadowBlur);
      this.elements.push(
        this.element(d, mode, shadow.colour, shadow.opacity * own.opacity, ` filter="url(#${this.blurId(this.state.shadowBlur)})"`)
      );
    }
    this.elements.push(this.element(d, mode, own.colour, own.opacity, ""));
  }

  private element(d: string, mode: "fill" | "stroke", colour: string, opacity: number, extra: string): string {
    const opacityText = opacity === 1 ? "" : ` ${mode}-opacity="${number(opacity)}"`;
    if (mode === "fill") {
      return `<path d="${d}" fill="${colour}"${opacityText}${extra}/>`;
    }
    return (
      `<path d="${d}" fill="none" stroke="${colour}"${opacityText} stroke-width="${number(this.state.lineWidth)}" ` +
      `stroke-linecap="${this.state.lineCap}" stroke-linejoin="${this.state.lineJoin}"${extra}/>`
    );
  }
}
