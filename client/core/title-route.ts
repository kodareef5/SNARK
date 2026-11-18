/** Reproducible Miami camera and animation timeline. Coordinates are engine metres, west and north. */
export interface TitleFlight {
  map: string;
  mount: string;
  saddle: string;
  rider: string;
  hour: number;
  seconds: number;
  poster: number;
  splash: number;
  points: readonly (readonly number[])[];
  camera: { angle: number; distance: number; height: number; yawLimit: number; pitchLimit: number };
}
export const MIAMI_FLIGHT = {
  map: "core:miami",
  mount: "core:pteranodon",
  saddle: "core:saddle_pteranodon",
  rider: "core:survivor",
  hour: 7.4,
  seconds: 132,
  poster: 18,
  splash: 22,
  camera: { angle: -0.48, distance: 8.1, height: 2.05, yawLimit: 0.8, pitchLimit: 0.35 },
  // The route passes Watson Island, the bay side of downtown, Brickell Key and the turning basin.
  points: [
    [4850, 84, 4600],
    [5330, 110, 4230],
    [5780, 129, 3640],
    [5630, 102, 2930],
    [5040, 90, 2510],
    [4450, 102, 3050],
    [4320, 89, 3800],
    [4470, 74, 4370],
  ],
} as const satisfies TitleFlight;

export function flightPosition(seconds: number, route: TitleFlight = MIAMI_FLIGHT): number[] {
  const points = route.points,
    n = points.length;
  const u = ((((seconds % route.seconds) + route.seconds) % route.seconds) / route.seconds) * n;
  const i = Math.floor(u),
    t = u - i;
  return [0, 1, 2].map((axis) => {
    const a = points[(i + n - 1) % n]![axis]!,
      b = points[i]![axis]!;
    const c = points[(i + 1) % n]![axis]!,
      d = points[(i + 2) % n]![axis]!;
    return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * b - 3 * c + d - a)));
  });
}
