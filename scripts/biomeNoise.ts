/**
 * The noise and colouring maths both biome texture sets are drawn from (`genBiomes.ts`): periodic
 * value noise and its fractal sum, so every tile wraps seamlessly, and the colour ramps that turn a
 * field into pixels. Kept apart from the generator, which runs on import.
 */

export type Rgb = readonly [number, number, number];
export type Field = Float32Array;
export type Ramp = readonly (readonly [number, Rgb])[];

export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

export function smoothstep(value: number) {
  return value * value * (3 - 2 * value);
}

export function periodicValueNoise(size: number, period: number, seed: number): Field {
  const rng = random(seed);
  const lattice = Array.from({ length: period * period }, () => rng());
  const output = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const coordinateY = (y / size) * period;
    const y0 = Math.floor(coordinateY) % period;
    const y1 = (y0 + 1) % period;
    const fy = smoothstep(coordinateY - Math.floor(coordinateY));
    for (let x = 0; x < size; x += 1) {
      const coordinateX = (x / size) * period;
      const x0 = Math.floor(coordinateX) % period;
      const x1 = (x0 + 1) % period;
      const fx = smoothstep(coordinateX - Math.floor(coordinateX));
      const top = lattice[y0 * period + x0] * (1 - fx) + lattice[y0 * period + x1] * fx;
      const bottom =
        lattice[y1 * period + x0] * (1 - fx) + lattice[y1 * period + x1] * fx;
      output[y * size + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return output;
}

export function fbm(size: number, period: number, octaves: number, seed: number): Field {
  const output = new Float32Array(size * size);
  let amplitude = 1;
  let amplitudeSum = 0;
  let currentPeriod = period;
  for (let octave = 0; octave < octaves; octave += 1) {
    const layer = periodicValueNoise(size, currentPeriod, seed + octave * 101);
    for (let index = 0; index < output.length; index += 1) {
      output[index] += layer[index] * amplitude;
    }
    amplitudeSum += amplitude;
    amplitude *= 0.5;
    currentPeriod *= 2;
  }
  for (let index = 0; index < output.length; index += 1) {
    output[index] /= amplitudeSum;
  }
  return output;
}

export function normalize(field: Field): Field {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of field) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const scale = maximum - minimum || 1;
  return Float32Array.from(field, (value) => (value - minimum) / scale);
}

export function blend(first: Rgb, second: Rgb, amount: number): Rgb {
  return [
    first[0] * (1 - amount) + second[0] * amount,
    first[1] * (1 - amount) + second[1] * amount,
    first[2] * (1 - amount) + second[2] * amount
  ];
}

export function ramp(value: number, stops: readonly (readonly [number, Rgb])[]): Rgb {
  if (value <= stops[0][0]) {
    return stops[0][1];
  }
  for (let index = 1; index < stops.length; index += 1) {
    const [position, colour] = stops[index];
    if (value <= position) {
      const [previousPosition, previousColour] = stops[index - 1];
      return blend(previousColour, colour, (value - previousPosition) / (position - previousPosition));
    }
  }
  return stops[stops.length - 1][1];
}

export function renderField(field: Field, colours: Ramp, seed: number, size: number) {
  const height = size;
  const width = size;
  const pixels = Buffer.alloc(width * height * 3);
  const noise = random(seed);
  for (let index = 0; index < field.length; index += 1) {
    const colour = ramp(field[index], colours);
    const grain = (noise() - 0.5) * 10;
    pixels[index * 3] = Math.max(0, Math.min(255, Math.round(colour[0] + grain)));
    pixels[index * 3 + 1] = Math.max(0, Math.min(255, Math.round(colour[1] + grain)));
    pixels[index * 3 + 2] = Math.max(0, Math.min(255, Math.round(colour[2] + grain)));
  }
  return pixels;
}

export function mix(first: Field, second: Field, firstWeight: number, secondWeight: number): Field {
  return Float32Array.from(first, (value, index) => value * firstWeight + second[index] * secondWeight);
}

export function sineField(frequency: number, warp: Field, size: number): Field {
  return Float32Array.from(warp, (value, index) => {
    const x = (index % size) / size;
    const y = Math.floor(index / size) / size;
    return 0.5 + 0.5 * Math.sin((x + y * 0.4) * Math.PI * 2 * frequency + value * 8);
  });
}

