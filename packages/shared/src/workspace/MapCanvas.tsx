import { Application, Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef } from "react";
import { hexCorners, hexToPixel, type HexMapModel, type HexNode } from "../hexMapModel";

const HEX_RADIUS = 18;
const MIN_SCALE = 0.25;
const MAX_SCALE = 3;

const TERRAIN_COLOURS: Record<string, number> = {
  ocean: 0x1d3f63,
  plain: 0x7a7440,
  forest: 0x2f5d3a,
  mountain: 0x5c5c66,
  swamp: 0x3d4a2e,
  desert: 0x8a7546,
  jungle: 0x2b6b4a,
  tundra: 0x6b7a80,
  cavern: 0x3a3a44,
  underforest: 0x2a4433,
  wasteland: 0x6a5a46
};

const UNKNOWN = 0x161c24;

function terrainColour(terrain: string): number {
  return TERRAIN_COLOURS[terrain.toLowerCase()] ?? 0x555f6b;
}

/** Blends a colour toward the unexplored ground, so an older sighting reads as fainter. */
function fade(colour: number, amount: number): number {
  const mix = (shift: number) => {
    const from = (colour >> shift) & 0xff;
    const to = (UNKNOWN >> shift) & 0xff;
    return Math.round(from * (1 - amount) + to * amount) << shift;
  };
  return mix(16) | mix(8) | mix(0);
}

/**
 * How a hex is painted, given how much the player can trust it.
 *
 * Staleness fades with age rather than switching on at a threshold: a hex seen last turn is nearly
 * current, one seen twenty turns ago is nearly a rumour, and a single flat "stale" colour would
 * throw that away.
 */
function fillFor(hex: HexNode, showStaleness: boolean): { colour: number; alpha: number } {
  const base = terrainColour(hex.terrain);

  if (hex.knowledge === "current") {
    return { colour: base, alpha: 1 };
  }
  if (hex.knowledge === "named") {
    return { colour: base, alpha: 0.45 };
  }
  if (!showStaleness) {
    return { colour: base, alpha: 1 };
  }
  const age = hex.ageInTurns ?? 0;
  return { colour: fade(base, Math.min(0.62, 0.3 + age * 0.02)), alpha: 1 };
}

type MapCanvasProps = {
  model: HexMapModel;
  level: number;
  selectedRegionId: string | null;
  onSelectRegion: (regionId: string) => void;
  showStaleness: boolean;
  showUnits: boolean;
};

/**
 * The world map.
 *
 * Rewritten rather than adjusted: the previous renderer destroyed and recreated the entire Pixi
 * application on every pan, zoom and selection change, and hit-tested with invisible DOM buttons
 * laid over the canvas. Here the application is created once and only the hex layer is redrawn,
 * panning and zooming move the world container without touching the scene, and Pixi does its own
 * hit-testing.
 *
 * An accessible button per hex is still rendered, off-screen, because a canvas is invisible to
 * assistive technology and to end-to-end tests alike.
 */
export function MapCanvas({
  model,
  level,
  selectedRegionId,
  onSelectRegion,
  showStaleness,
  showUnits
}: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const selectRef = useRef(onSelectRegion);
  selectRef.current = onSelectRegion;

  // Created once. Everything after this mutates the scene rather than rebuilding it.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    const app = new Application({
      resizeTo: host,
      antialias: true,
      backgroundColor: 0x0a0e13
    });
    const world = new Container();
    app.stage.addChild(world);

    appRef.current = app;
    worldRef.current = world;
    host.appendChild(app.view as unknown as Node);

    let dragging = false;
    let moved = false;
    let originX = 0;
    let originY = 0;

    const canvas = app.view as unknown as HTMLCanvasElement;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      moved = false;
      originX = event.clientX - world.position.x;
      originY = event.clientY - world.position.y;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) {
        return;
      }
      world.position.set(event.clientX - originX, event.clientY - originY);
      moved = true;
    };
    const onPointerUp = () => {
      dragging = false;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const previous = world.scale.x;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, previous * (event.deltaY < 0 ? 1.1 : 0.9)));
      // Zoom about the pointer rather than the origin, so the hex under the cursor stays put.
      const bounds = canvas.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      world.position.set(
        pointerX - ((pointerX - world.position.x) / previous) * next,
        pointerY - ((pointerY - world.position.y) / previous) * next
      );
      world.scale.set(next);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    // A drag that ended on a hex must not also select it.
    canvas.addEventListener("click", (event) => {
      if (moved) {
        event.stopPropagation();
      }
    });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      app.destroy(true);
      appRef.current = null;
      worldRef.current = null;
    };
  }, []);

  // Redraws the hex layer only. The application, its canvas and the view transform survive.
  useEffect(() => {
    const world = worldRef.current;
    if (!world) {
      return;
    }

    world.removeChildren();
    const corners = hexCorners(HEX_RADIUS);
    const visible = model.hexes.filter((hex) => hex.coordinate.z === level);

    const trace = (shape: Graphics, centre: { x: number; y: number }) => {
      corners.forEach((corner, index) => {
        const x = centre.x + corner.x;
        const y = centre.y + corner.y;
        if (index === 0) {
          shape.moveTo(x, y);
        } else {
          shape.lineTo(x, y);
        }
      });
      shape.closePath();
    };

    // The unexplored lattice. Without it the known hexes float as islands on a black field and the
    // map reads as broken rather than as mostly unexplored, which is the honest picture: a faction
    // knows a handful of hexes out of a world.
    if (visible.length > 0) {
      const xs = visible.map((hex) => hex.coordinate.x);
      const ys = visible.map((hex) => hex.coordinate.y);
      const margin = 6;
      const fog = new Graphics();
      fog.lineStyle(1, 0x11161d, 1);
      fog.beginFill(UNKNOWN, 1);
      for (let x = Math.min(...xs) - margin; x <= Math.max(...xs) + margin; x += 1) {
        for (let y = Math.min(...ys) - margin; y <= Math.max(...ys) + margin; y += 1) {
          // Only half the lattice positions exist.
          if ((x + y) % 2 !== 0) {
            continue;
          }
          trace(fog, hexToPixel({ x, y, z: level }, HEX_RADIUS));
        }
      }
      fog.endFill();
      world.addChild(fog);
    }

    for (const hex of visible) {
      const centre = hexToPixel(hex.coordinate, HEX_RADIUS);
      const selected = hex.regionId === selectedRegionId;
      const { colour, alpha } = fillFor(hex, showStaleness);

      const shape = new Graphics();
      shape.lineStyle(selected ? 2.5 : 1, selected ? 0xd9a441 : 0x0a0e13, 1);
      shape.beginFill(colour, alpha);
      trace(shape, centre);
      shape.endFill();

      shape.eventMode = "static";
      shape.cursor = "pointer";
      shape.on("pointertap", () => selectRef.current(hex.regionId));
      world.addChild(shape);

      if (hex.settlementName) {
        const label = new Text(hex.settlementName, {
          fill: 0xf0e2bd,
          fontSize: 9,
          fontFamily: "monospace"
        });
        label.anchor.set(0.5, 0);
        label.position.set(centre.x, centre.y + 4);
        world.addChild(label);
      }

      if (showUnits && hex.ownUnitCount + hex.foreignUnitCount > 0) {
        const pips = new Graphics();
        if (hex.ownUnitCount > 0) {
          pips.beginFill(0x5ec8f0).drawCircle(centre.x - 4, centre.y - 7, 2.6).endFill();
        }
        if (hex.foreignUnitCount > 0) {
          pips.beginFill(0xf07070).drawCircle(centre.x + 4, centre.y - 7, 2.6).endFill();
        }
        world.addChild(pips);
      }
    }
  }, [model, level, selectedRegionId, showStaleness, showUnits]);

  // Centres on the selection the first time a world arrives, so the view does not open on empty fog.
  const centredRef = useRef(false);
  useEffect(() => {
    const app = appRef.current;
    const world = worldRef.current;
    if (!app || !world || centredRef.current) {
      return;
    }
    const target =
      model.hexes.find((hex) => hex.regionId === selectedRegionId) ??
      model.hexes.find((hex) => hex.knowledge === "current");
    if (!target) {
      return;
    }
    const centre = hexToPixel(target.coordinate, HEX_RADIUS);
    world.position.set(app.renderer.width / 2 - centre.x, app.renderer.height / 2 - centre.y);
    centredRef.current = true;
  }, [model, selectedRegionId]);

  return (
    <div className="absolute inset-0" data-testid="map-canvas">
      <div ref={hostRef} className="h-full w-full" />
      {/*
        A canvas says nothing to a screen reader or to Playwright, so every hex also exists as a
        button. Positioned off-screen rather than hidden, so it stays focusable and clickable.
      */}
      <div className="sr-only">
        {model.hexes
          .filter((hex) => hex.coordinate.z === level)
          .map((hex) => (
            <button
              key={hex.regionId}
              type="button"
              aria-label={`hex ${hex.regionId}`}
              aria-pressed={hex.regionId === selectedRegionId}
              onClick={() => onSelectRegion(hex.regionId)}
            >
              {hex.label}
            </button>
          ))}
      </div>
    </div>
  );
}
