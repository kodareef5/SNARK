// What an orb's screen costs a GPU: each scene drawn full screen at 1,024 square in Chrome on this machine's card by
// timer query, seven rounds, the median, in ms a megapixel (tools/probe-lit/sky.ts timeRuns), on each tier's defines.
// The screen is the ball's skin seen near, where a puck is four and a half pixels and drawn in full; from across the
// street, where a pixel is wider than a puck and the picture is plain but whole; and far, where a pixel is 22 m and the
// scenes have dropped all they drop. The instant is one of the blue eye's strikes with the eye at power, when Storm
// draws its bolt and every scene works out the most. The gate is 0.5 ms with the ball filling a 1080p view on high:
// 0.24 ms a megapixel.
//
// And what the ball's light costs a lit surface (client/core/render/orb-light.ts): LIT full screen on a wall, with the
// light's define and without, by night with the wall in its light, past its reach, and on a map with no orb; and with
// the light but the ball out of what mirrors, which is what the mirror costs. The gate is 0.05 ms a megapixel. And the shadow the ball casts (`orbShade` there): LIT with medium's defines and with high's, by
// day, with the shadow's define and without.
//
//   bun tools/orb/cost.ts           all
//   bun tools/orb/cost.ts --light   the light and the shadow alone
import { TIERS } from "../../client/core/assets/tiers.ts";
import { ORB_FRAGMENT, OrbCast, writeOrb } from "../../client/core/render/orb.ts";
import "../../client/core/render/orb-late.ts";
import { ORB_SEEN } from "../../client/core/render/orb-light.ts";
import { FRAME, FRAME_FLOATS, ORB_AT } from "../../client/core/render/packet.ts";
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
  writeOrb(f, [SITE], [BLUE], STRIKE, 23, 0, 0, 0, null, 0, 30, which);
  f[FRAME.eyeHeight] = 10;
  return [...f];
}

/** The second of the blue eye's cycle at which it strikes hardest, the eye at power: found, so it stays one if the eye's clock is retimed. */
const STRIKE = ((): number => {
  const f = new Float32Array(FRAME_FLOATS);
  let best = 0, at = 0;
  for (let seconds = 360; seconds < 480; seconds += 0.02) {
    writeOrb(f, [SITE], [BLUE], seconds, 23, 0, 0, 0, null, 0, 30, 3);
    if (f[ORB_AT + 23]! > best) [best, at] = [f[ORB_AT + 23]!, seconds];
  }
  if (best < 0.5) throw new Error("the blue eye does not strike in its cycle");
  return at;
})();
/** Metres across the screen at each view, and the pixels a puck (0.4 m) then spans by the program's own measure. */
const VIEWS = [["near", 64], ["mid", 320], ["far", 16000]] as const;

/** A wall full screen, facing the eye from `uSpan.x` metres ahead of it, as the sky's timing page has LIT's: plain grey, with no finish, facade or wear. */
const WALL = `#version 300 es
uniform vec2 uSpan;
out vec3 vRel, vOwn;
out vec2 vFace;
flat out vec3 vColor;
flat out vec4 vFinish;
flat out float vShare;
flat out int vSurface, vFixture, vMade, vFacade;
flat out vec2 vPlace;
flat out uint vEdges;
void main() {
  vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vRel = vec3(at.x * 3.0, at.y * 2.0 - 0.5, 5.0) * uSpan.x / 5.0;
  gl_Position = vec4(at, 0.5, 1.0);
  vColor = vec3(0.5);
  vOwn = vRel;
  vFace = at;
  vFinish = vec4(0.0);
  vShare = 0.0;
  vSurface = vFixture = vMade = 0;
  vFacade = -1;
  vPlace = vec2(0.0);
  vEdges = 0u;
}`;

/** The frame block at an hour, Core held, the eye at the ball's foot with its back to it, or on a map with no orb. */
function wallFrame(hour: number, orb: boolean, mirror = true): number[] {
  const f = new Float32Array(FRAME_FLOATS);
  skyFrame(hour, theSky(), f);
  postFrame(f, TIERS[2]!, hour, 1080);
  writeOrb(f, orb ? [{ ...SITE, z: -90 }] : [], [BLUE], 380.6, hour, 0, 0, 0, null, 0, 30, 2);
  new OrbCast().step(f, 0);
  if (!mirror) f.fill(0, ORB_SEEN, ORB_SEEN + 4);
  f[FRAME.eyeHeight] = 10;
  return [...f];
}

const chrome = findChrome();
if (!chrome) throw new Error("no Chrome to measure in");
const matrix = [...look(0, 0, 1)];
const scenes = process.argv.includes("--light") ? [] : TIERS.flatMap((tier) => {
  const text = PROGRAMS.orb!(tier, "rgba", false, tier.post !== null);
  return ORB_SCENES.flatMap((scene, which) => VIEWS.map(([where, span]) => ({ name: `${tier.name} ${scene} ${where}`, vertex: SKIN, fragment: withDefines(text.fragment, text.defines), samplers: {}, frame: frame(which), matrix, uniforms: { uSpan: [span, 0] } })));
});
if (scenes.length > 0 && scenes[0]!.fragment.indexOf(ORB_FRAGMENT.slice(-200)) < 0) throw new Error("the program's text is not the orb's");
// LIT with no define but the light's, and with all of high's: each with the light and without, so the two differ by it alone.
const lit = PROGRAMS.flat!(TIERS[2]!, "rgba", false, true), LIGHT = "#define ORB_LIGHT\n";
if (!lit.defines.includes(LIGHT)) throw new Error("high does not light by the orb");
const KINDS = [["plain", ""], ["high", lit.defines.replace(LIGHT, "")]] as const;
// The ball in what mirrors has no define: "no mirror" is the same text with the mirror's lane empty, as ?off=orbmirror has it.
const CASES = [["off", false, true, 40, true], ["on, lit", true, true, 40, true], ["on, past its reach", true, true, 900, true], ["on, no orb", true, false, 40, true], ["on, no mirror", true, true, 40, false]] as const;
const walls = KINDS.flatMap(([kind, defines]) => CASES.map(([name, on, orb, metres, mirror]) => ({ name: `${kind} ${name}`, vertex: withDefines(WALL, defines), fragment: withDefines(lit.fragment, (on ? LIGHT : "") + defines), samplers: lit.samplers, frame: wallFrame(23, orb, mirror), matrix, uniforms: { uSpan: [metres, 0] } })));
if (!walls[1]!.fragment.includes("void orbSees(") || walls[0]!.fragment.includes(LIGHT)) throw new Error("the wall's texts are not LIT with the light and without");
// The shadow: LIT with a tier's defines, with the shadow's and without, at ten in the morning.
const SHADE = "#define ORB_SHADE\n";
const SHADED = [TIERS[1]!, TIERS[2]!].flatMap((tier) => {
  const text = PROGRAMS.flat!(tier, "rgba", false, tier.post !== null);
  if (!text.defines.includes(SHADE)) throw new Error(`${tier.name} does not take the orb's shadow`);
  return ([["off", false, true], ["on", true, true], ["on, no orb", true, false]] as const).map(([name, on, orb]) => ({ name: `shade ${tier.name} ${name}`, vertex: withDefines(WALL, text.defines), fragment: withDefines(text.fragment, on ? text.defines : text.defines.replace(SHADE, "")), samplers: text.samplers, frame: wallFrame(10, orb), matrix, uniforms: { uSpan: [40, 0] } }));
});
if (!SHADED[1]!.fragment.includes("return mapShadow(rel, normal) * orbShade(rel);") || SHADED[0]!.fragment.includes(SHADE)) throw new Error("the wall's texts are not LIT with the shadow and without");
const t = await timeRuns(chrome, [...scenes, ...walls, ...SHADED]);
if (scenes.length > 0) console.log(`full screen at 1,024 square on ${t.renderer}, ${t.timer ? "by timer query" : "by the clock"}, in ms a megapixel, at second ${STRIKE.toFixed(2)} of the eye's cycle (${VIEWS.map(([where, span]) => `${where}: a puck ${(0.4 / ((span / 1024) * Math.SQRT2)).toFixed(2)} pixels`).join("; ")}):`);
for (const tier of scenes.length > 0 ? TIERS : []) {
  console.log(`  ${tier.name}`);
  for (const scene of ORB_SCENES) console.log(`    ${scene.padEnd(8)} ${VIEWS.map(([where]) => `${where} ${(t[`${tier.name} ${scene} ${where}`] as number).toFixed(3)}`).join("  ")}`);
}
console.log(`the ball's light on a lit wall, LIT full screen at 1,024 square on ${t.renderer}, ${t.timer ? "by timer query" : "by the clock"}, in ms a megapixel (the gate is 0.05 more than off):`);
for (const [kind] of KINDS) {
  const off = t[`${kind} off`] as number;
  console.log(`  LIT with ${kind === "plain" ? "no other define" : "high's defines"}`);
  for (const [name] of CASES) {
    const ms = t[`${kind} ${name}`] as number;
    console.log(`    ${name.padEnd(20)} ${ms.toFixed(4)}${name === "off" ? "" : `  ${ms >= off ? "+" : ""}${(ms - off).toFixed(4)}`}`);
  }
}
console.log("the ball's shadow on a lit wall, the same, by day:");
for (const tier of [TIERS[1]!, TIERS[2]!]) {
  const off = t[`shade ${tier.name} off`] as number;
  console.log(`  LIT with ${tier.name}'s defines`);
  for (const name of ["off", "on", "on, no orb"]) {
    const ms = t[`shade ${tier.name} ${name}`] as number;
    console.log(`    ${name.padEnd(20)} ${ms.toFixed(4)}${name === "off" ? "" : `  ${ms >= off ? "+" : ""}${(ms - off).toFixed(4)}`}`);
  }
}
process.exit(0);
