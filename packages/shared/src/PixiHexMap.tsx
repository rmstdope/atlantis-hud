import { Application, Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef } from "react";
import type { MapRegionNode } from "./mapData";

type PixiHexMapProps = {
  regions: MapRegionNode[];
  selectedRegionId: string | null;
  onSelectRegion: (regionId: string) => void;
  panX: number;
  panY: number;
  scale: number;
};

const HEX_SIZE = 22;
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
const HEX_HEIGHT = HEX_SIZE * 2;
const HEX_VERTICAL_SPACING = HEX_SIZE * 1.5;

function coordinateToPixel(col: number, row: number) {
  const x = col * HEX_WIDTH + (row % 2 === 0 ? 0 : HEX_WIDTH / 2);
  const y = row * HEX_VERTICAL_SPACING;
  return { x, y };
}

function drawHex(graphics: Graphics, centerX: number, centerY: number, highlighted: boolean) {
  const fillColor = highlighted ? 0x1d4ed8 : 0x1f2937;
  const borderColor = highlighted ? 0x93c5fd : 0x9ca3af;
  graphics.clear();
  graphics.lineStyle(2, borderColor, 1);
  graphics.beginFill(fillColor, 1);

  for (let corner = 0; corner < 6; corner += 1) {
    const angle = (Math.PI / 180) * (60 * corner - 30);
    const pointX = centerX + HEX_SIZE * Math.cos(angle);
    const pointY = centerY + HEX_SIZE * Math.sin(angle);
    if (corner === 0) {
      graphics.moveTo(pointX, pointY);
    } else {
      graphics.lineTo(pointX, pointY);
    }
  }
  graphics.closePath();
  graphics.endFill();
}

export function PixiHexMap({
  regions,
  selectedRegionId,
  onSelectRegion,
  panX,
  panY,
  scale
}: PixiHexMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const app = new Application({
      resizeTo: hostRef.current,
      antialias: true,
      backgroundColor: 0x0b1220
    });
    const world = new Container();
    world.position.set(panX, panY);
    world.scale.set(scale);
    app.stage.addChild(world);

    regions.forEach((region) => {
      const center = coordinateToPixel(region.coordinate.col, region.coordinate.row);
      const shape = new Graphics();
      drawHex(shape, center.x, center.y, region.regionId === selectedRegionId);
      world.addChild(shape);

      const label = new Text(region.regionId, {
        fill: 0xffffff,
        fontSize: 11
      });
      label.anchor.set(0.5, 0.5);
      label.position.set(center.x, center.y);
      world.addChild(label);
    });

    hostRef.current.innerHTML = "";
    hostRef.current.appendChild(app.view as HTMLCanvasElement);

    return () => {
      app.destroy(true);
    };
  }, [panX, panY, regions, scale, selectedRegionId]);

  return (
    <div style={{ position: "relative", width: "100%", height: "320px", border: "1px solid #374151" }}>
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          pointerEvents: "none"
        }}
      >
        <div
          style={{
            position: "absolute",
            transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
            transformOrigin: "0 0",
            pointerEvents: "none"
          }}
        >
          {regions.map((region) => {
            const center = coordinateToPixel(region.coordinate.col, region.coordinate.row);
            const width = HEX_WIDTH * 0.9;
            const height = HEX_HEIGHT * 0.8;
            return (
              <button
                key={region.regionId}
                type="button"
                aria-label={`hex ${region.regionId}`}
                onClick={() => onSelectRegion(region.regionId)}
                style={{
                  position: "absolute",
                  left: `${center.x - width / 2}px`,
                  top: `${center.y - height / 2}px`,
                  width: `${width}px`,
                  height: `${height}px`,
                  opacity: 0,
                  pointerEvents: "auto",
                  cursor: "pointer"
                }}
              >
                {region.regionId}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
