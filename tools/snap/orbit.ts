// `--orbit ROUND[,DOWN[,NOTCHES]]`, once a scene is set: K, which swings the camera round to face the body or its mount,
// then ROUND degrees further round and DOWN degrees lower, the wheel NOTCHES out (in where negative), and the ease run
// out, so the picture is the orbit camera's (client/core/orbit.ts). The body keeps its facing.

import type { App } from "../../client/core/app.ts";
import { LOOK_SPEED } from "../../client/core/controls.ts";

export function orbitScene(app: App, run: (ms: number) => void, spec: string): void {
  const [round = 30, down = 15, notches = 0] = spec.split(",").filter((v) => v !== "").map(Number);
  if (![round, down, notches].every(Number.isFinite)) throw new Error(`--orbit takes ROUND[,DOWN[,NOTCHES]] in degrees and notches, not "${spec}"`);
  app.key("KeyK", true);
  app.key("KeyK", false);
  run(50);
  if (!app.orbit.on) throw new Error("--orbit: this view has no orbit camera");
  const pixel = LOOK_SPEED * app.controls.zoom * 180 / Math.PI;
  app.look(-round / pixel, down / pixel);
  for (let i = 0; i < Math.abs(notches); i++) app.wheel(Math.sign(notches) * 100);
  run(800);
}
