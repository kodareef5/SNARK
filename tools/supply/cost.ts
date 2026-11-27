// What a drop's light costs a GPU (planning/workstreams/supply.md, "Cost"), measured as the instruments' was
// (planning/workstreams/instruments.md): each program drawn full screen at 1,024 square in Chrome on this machine's GPU,
// blended, by timer query, seven rounds, the median, in ms a megapixel (tools/probe-lit/sky.ts timeRuns).
//
// The beacon and its source use detail cards. The jet and capsule strips use the surface program.
// The difference between the two sky runs measures four streaks in flight.
//
//   bun tools/supply/cost.ts

import { tierOf } from "../../client/core/assets/tiers.ts";
import { DETAIL_BEACON, DETAIL_GLOW, DROPS_AT, DROP_STREAKS, FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { PROGRAMS, withDefines } from "../../client/core/render/programs.ts";
import { GLOW_JET, LIGHT_LANTERN, packEffect } from "../../client/core/render/supply-light.ts";
import { writeDropSky } from "../../client/core/render/supply-sky.ts";
import { airFrame } from "../../client/core/render/atmosphere.ts";
import { skyFrame, theSky } from "../../client/core/render/sky.ts";
import { DROP_GLOW, DROP_LIGHT } from "../../content/street-finishes.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { supplyTimes, type SupplyList, type SupplyRow } from "../../shared/sim/supply.ts";
import { EYE_KNOT } from "../../shared/world/tide-eye.ts";
import { CARD } from "../bench/fire-cost.ts";
import { findChrome } from "../chrome.ts";
import { look, timeRuns } from "../probe-lit/sky.ts";

const HOUR = 16;
const R = TICK_RATE;

/** The frame block at four in the afternoon over open ground, one cloud layer, with `list`'s casts in its lanes. */
function frame(list: SupplyList | null, tick: number): number[] {
  const f = new Float32Array(FRAME_FLOATS);
  skyFrame(HOUR, theSky(), f);
  airFrame(f, theSky(), HOUR, 0, 0, 0, 4000, 1, false);
  f[FRAME.eyeHeight] = 10;
  writeDropSky(f, list, tick, R, 0, 10, 0, [], 0);
  return [...f];
}

/** Four drops in flight at once, cast from a knot 3 km north toward places round the eye. */
function fourInFlight(): { list: SupplyList; tick: number } {
  const rows: SupplyRow[] = [0, 1, 2, 3].map((k) => ({
    id: k + 1, tier: 0, cls: 0, ringed: k === 3, landed: false, opened: false, announce: 0, sender: 255, eye: 0, look: k,
    ox: 0, oy: EYE_KNOT, oz: 3000, x: [-900, -300, 300, 900][k]!, y: 4, z: [1500, 2200, 1800, 1200][k]!,
    ...supplyTimes(0, null, 60, 30, 7, 1200, R),
  }));
  const list: SupplyList = { tiers: [{ name: "Red", rgb: 0xf03838, level: 60, count: 6 }], classes: [{ name: "Arms", mark: 1 }], rows };
  // A third of the way through their flights, every streak up and over the horizon.
  return { list, tick: rows[0]!.release + 10 * R };
}

/**
 * A triangle over the whole screen for the surface program, as a tube's side 60 m off would fill it: across it the
 * face turns from edge-on toward the eye and away again, and up it run uTube's metres of the strip's row uTube.x.
 */
const TUBE = `#version 300 es
uniform vec2 uTube;
flat out float vFinishSeed;
out vec3 vWheelPoint;
out vec4 vWheel;
out vec3 vRel, vNormal;
out vec4 vTangent;
out vec2 vUv;
void main() {
  vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vRel = vec3(at.x * 30.0, at.y * 30.0, 60.0);
  vNormal = vec3(at.x, 0.0, -0.45);
  vTangent = vec4(0.0, 1.0, 0.0, 1.0);
  vUv = vec2((at.y * 0.5 + 0.5) * uTube.y / 32.0, (uTube.x + 0.5) / 8.0);
  vFinishSeed = 0.0;
  vWheelPoint = vec3(0.0);
  vWheel = vec4(0.0);
  gl_Position = vec4(at, 0.0, 1.0);
}`;

const chrome = findChrome();
if (!chrome) throw new Error("no Chrome to measure in");
const high = tierOf("high");
const sky = PROGRAMS.sky!(high, "rgba");
const surface = PROGRAMS.surfaceUndyedWhole!(high, "rgba");
const matrix = [...look(0, (14 * Math.PI) / 180, 1)];
const flight = fourInFlight();
const none = frame(null, 0);
const four = frame(flight.list, flight.tick);
const lit = [0, 1, 2, 3].filter((k) => four[DROPS_AT + k * 8 + 3]! > 0.5).length;
if (lit !== DROP_STREAKS) throw new Error(`the frame holds ${lit} streaks at strength, not ${DROP_STREAKS}`);
/** Twelve seconds after landing, a red drop of six, at full power. */
const effect = (ringed: boolean): number[] => [12, 0xf03838, 1, packEffect(6, ringed, 3)];
type Run = Record<string, unknown> & { name: string };
const details = PROGRAMS.details!(high, "rgba", false, true);
const card = (name: string, flags: number): Run => ({
  name, vertex: CARD, fragment: withDefines(details.fragment, details.defines), samplers: details.samplers,
  frame: none, matrix, uniforms: { uCard: [flags, 1, 1, 0], uBlend: [1], uCells: [4], uFrom: [0] },
});
const runs: Run[] = [
  { name: "sky, no cast", ...sky, frame: none, matrix },
  { name: "sky, four casts", ...sky, frame: four, matrix },
  card("shaft", DETAIL_BEACON),
  card("source glow", DETAIL_GLOW),
  { name: "jet", vertex: TUBE, fragment: surface.fragment, samplers: surface.samplers, frame: none, matrix, uniforms: { uTube: [GLOW_JET, 3], uStreetMaterial: [DROP_GLOW], uEffect: effect(false), uFrom: [0] } },
  { name: "capsule light", vertex: TUBE, fragment: surface.fragment, samplers: surface.samplers, frame: none, matrix, uniforms: { uTube: [LIGHT_LANTERN, 2], uStreetMaterial: [DROP_LIGHT], uEffect: effect(false), uFrom: [0] } },
];
// COST_ONLY names the runs to keep, by the start of their names: for looking at one.
const only = process.env.COST_ONLY?.split(",");
if (only) runs.splice(0, runs.length, ...runs.filter((r) => only.some((o) => r.name.startsWith(o))));
const t = await timeRuns(chrome, runs);
console.log(`full screen at 1,024 square on ${t.renderer}, blended, ${t.timer ? "by timer query" : "by the clock"}, in ms a megapixel:`);
for (const r of runs) console.log(`  ${r.name.padEnd(18)} ${(t[r.name] as number).toFixed(3)}`);
const ms = (name: string): number => t[name] as number;
if (t["sky, four casts"] !== undefined && t["sky, no cast"] !== undefined) console.log(`  four casts alone   ${(ms("sky, four casts") - ms("sky, no cast")).toFixed(3)}`);
process.exit(0);
