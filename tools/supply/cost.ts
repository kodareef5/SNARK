// What a drop's light costs a GPU (planning/workstreams/supply.md, "Cost"), measured as the instruments' was
// (planning/workstreams/instruments.md): each program drawn full screen at 1,024 square in Chrome on this machine's GPU,
// blended, by timer query, seven rounds, the median, in ms a megapixel (tools/probe-lit/sky.ts timeRuns).
//
// The shaft, its sheath, its halos, a class figure, a jet and the foot's glow are one material of the surface program
// (DROP_GLOW), a row each; the capsule's lit strips are another (DROP_LIGHT). The streaks are in the sky's program, so
// their cost is the sky with four in flight less the sky with none.
//
//   bun tools/supply/cost.ts

import { tierOf } from "../../client/core/assets/tiers.ts";
import { DROPS_AT, DROP_STREAKS, FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { GLOW_FIGURE, GLOW_FOOT, GLOW_HALO, GLOW_JET, GLOW_SHAFT, GLOW_SHEATH, LIGHT_LANTERN, packEffect } from "../../client/core/render/supply-light.ts";
import { writeDropSky } from "../../client/core/render/supply-sky.ts";
import { airFrame } from "../../client/core/render/atmosphere.ts";
import { skyFrame, theSky } from "../../client/core/render/sky.ts";
import { DROP_GLOW, DROP_LIGHT } from "../../content/street-finishes.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { supplyTimes, type SupplyList, type SupplyRow } from "../../shared/sim/supply.ts";
import { EYE_KNOT } from "../../shared/world/tide-eye.ts";
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
const glow = (name: string, row: number, metres: number, ringed = false): Run => ({ name, vertex: TUBE, fragment: surface.fragment, samplers: surface.samplers, frame: none, matrix, uniforms: { uTube: [row, metres], uStreetMaterial: [DROP_GLOW], uEffect: effect(ringed), uFrom: [0] } });
const runs: Run[] = [
  { name: "sky, no cast", ...sky, frame: none, matrix },
  { name: "sky, four casts", ...sky, frame: four, matrix },
  glow("shaft", GLOW_SHAFT, 60),
  glow("sheath", GLOW_SHEATH, 60, true),
  glow("halo", GLOW_HALO, 4, true),
  glow("figure", GLOW_FIGURE, 30),
  glow("jet", GLOW_JET, 3),
  glow("foot", GLOW_FOOT, 6),
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
// A far shaft is three pixels wide and, from 1 km at 1,080 lines, about 600 tall: twelve of them are 0.0216 megapixels.
if (t.shaft !== undefined) console.log(`  twelve far shafts  ${(ms("shaft") * 12 * 3 * 600 / 1e6).toFixed(4)} ms a frame (three pixels wide, 600 tall each)`);
process.exit(0);
