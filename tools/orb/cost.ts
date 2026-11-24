// What an orb's screen costs a GPU: each scene drawn full screen at 1,024 square in Chrome on this machine's card by
// timer query, seven rounds, the median, in ms a megapixel (tools/probe-lit/sky.ts timeRuns), on each tier's defines.
// The screen is the ball's skin seen from 25 m, where a puck is three pixels, and from 2 km, where it is plain. The gate
// is 0.5 ms with the ball filling a 1080p view on high: 0.24 ms a megapixel.
//
//   bun tools/orb/cost.ts
import { TIERS } from "../../client/core/assets/tiers.ts";
import { ORB_FRAGMENT, writeOrb } from "../../client/core/render/orb.ts";
import "../../client/core/render/orb-late.ts";
import { FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { postFrame } from "../../client/core/render/post.ts";
import { PROGRAMS, withDefines } from "../../client/core/render/programs.ts";
import { skyFrame, theSky } from "../../client/core/render/sky.ts";
import { ORB_SCENES, type OrbSite } from "../../shared/world/orb.ts";
import type { TideEyeSite } from "../../shared/world/tide-eye.ts";
import { findChrome } from "../chrome.ts";
import { look, timeRuns } from "../probe-lit/sky.ts";

const SITE: OrbSite = { name: "Sphere", x: 0, y: 0, z: 200, yaw: 0, radius: 78, centre: 34 };
const BLUE: TideEyeSite = { name: "Sphere", x: 0, y: 0, z: 410, yaw: 0, color: "blue", radius: 28 };

/** A triangle over the whole screen whose places are the ball's skin toward the eye, `uSpan.x` metres across. */
const SKIN = `#version 300 es
uniform vec2 uSpan;
out vec3 vRel;
void main() {
  vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vRel = vec3(at * uSpan.x * 0.5, 122.0) + vec3(0.0, 34.0, 0.0);
  gl_Position = vec4(at, 0.0, 1.0);
}`;

/** The frame block with scene `which` held: the eye at power and striking at night, which is the most a scene works out. */
function frame(which: number): number[] {
  const f = new Float32Array(FRAME_FLOATS);
  skyFrame(23, theSky(), f);
  postFrame(f, TIERS[2]!, 23, 1080);
  writeOrb(f, [SITE], [BLUE], 380.6, 23, 0, 0, 0, null, 0, 30, which);
  f[FRAME.eyeHeight] = 10;
  return [...f];
}

const chrome = findChrome();
if (!chrome) throw new Error("no Chrome to measure in");
const matrix = [...look(0, 0, 1)];
const runs = TIERS.flatMap((tier) => {
  const text = PROGRAMS.orb!(tier, "rgba", false, tier.post !== null);
  return ORB_SCENES.flatMap((scene, which) => [["near", 320], ["far", 16000]].map(([where, span]) => ({ name: `${tier.name} ${scene} ${where}`, vertex: SKIN, fragment: withDefines(text.fragment, text.defines), samplers: {}, frame: frame(which), matrix, uniforms: { uSpan: [span as number, 0] } })));
});
if (runs[0]!.fragment.indexOf(ORB_FRAGMENT.slice(-200)) < 0) throw new Error("the program's text is not the orb's");
const t = await timeRuns(chrome, runs);
console.log(`full screen at 1,024 square on ${t.renderer}, ${t.timer ? "by timer query" : "by the clock"}, in ms a megapixel (near: pucks at three pixels; far: the ball small):`);
for (const tier of TIERS) {
  console.log(`  ${tier.name}`);
  for (const scene of ORB_SCENES) console.log(`    ${scene.padEnd(8)} near ${(t[`${tier.name} ${scene} near`] as number).toFixed(3)}  far ${(t[`${tier.name} ${scene} far`] as number).toFixed(3)}`);
}
process.exit(0);
