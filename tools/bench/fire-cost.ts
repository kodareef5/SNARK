// What fire costs a GPU (planning/workstreams/rocket.md), measured as a supply drop's light was (tools/supply/cost.ts):
// each fragment text drawn full screen at 1,024 square in Chrome on this machine's GPU, blended, by timer query, seven
// rounds, the median, in ms a megapixel. The capsule's jet is timed in the same run, as what the two are held to: a
// flame to 1.2 times it and a fireball's lobe to twice. The cards a blast adds among the small details are timed so too.
//
// With `--blast` it then says what a rocket's blast 8 m off adds to a frame of 1,920 by 1,080 on medium: the blast is
// played headless, each frame's fire and cards are measured in pixels as the card would fill them, every one whole and
// none hidden, and each kind's pixels are priced at its ms a megapixel. It is a sum of measured parts and not a frame
// timed in the game. The GPU benchmark also triggers a blast in the browser (`tools/bench/gpu.ts`).
//
//   bun tools/bench/fire-cost.ts [--blast]

import { tierOf } from "../../client/core/assets/tiers.ts";
import { airFrame } from "../../client/core/render/atmosphere.ts";
import { FIRE_FLAME, FIRE_LOBE, LOBE_STEPS } from "../../client/core/render/fire-light.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_GLOW, DETAIL_SCORCH, DETAIL_SMOKE, DRAW_BLEND, DRAW_DETAILS, DRAW_FIRE, FRAME, FRAME_FLOATS, type FramePacket } from "../../client/core/render/packet.ts";
import { PROGRAMS, withDefines } from "../../client/core/render/programs.ts";
import { skyFrame, theSky } from "../../client/core/render/sky.ts";
import { GLOW_JET, packEffect } from "../../client/core/render/supply-light.ts";
import { DROP_GLOW } from "../../content/street-finishes.ts";
import { findChrome } from "../chrome.ts";
import { look, timeRuns } from "../probe-lit/sky.ts";

/** The flame may cost this many times the capsule's jet, and a lobe this many. */
export const FLAME_MOST = 1.2;
export const LOBE_MOST = 2;

/** A triangle over the whole screen for the surface program, as tools/supply/cost.ts has it. */
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

/**
 * A triangle over the whole screen for the fire program: across it the face turns from edge-on toward the eye and away
 * again. A flame runs up it from its nozzle to its tip; a lobe's noise is six cells across it.
 */
const FACE = `#version 300 es
uniform vec4 uEffect, uFlatA;
uniform vec2 uFlatB;
out vec2 vUv;
out float vFacing, vLift;
out vec3 vLight;
flat out vec4 vA;
flat out vec2 vB;
void main() {
  vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vLift = 1.0;
  vUv = uEffect.x > 0.5 ? at * 3.0 + 8.0 : at * 0.5 + 0.5;
  vFacing = 1.0 - 0.9 * abs(at.x);
  vLight = vec3(1.2, 1.1, 1.0);
  vA = uFlatA;
  vB = uFlatB;
  gl_Position = vec4(at, 0.0, 1.0);
}`;

/**
 * A triangle over the whole screen for the details' program: one card's face, 14 m off and 8 m across, of the flags,
 * grey and share shown that `uCard` says, as a see-through draw has it.
 */
export const CARD = `#version 300 es
uniform vec4 uCard;
out vec3 vRel, vBulge;
out vec2 vUv, vCorner;
flat out vec3 vA, vB, vNormal, vLens;
flat out float vShows, vGrey, vFloor, vHalf, vShade;
flat out uint vFlags;
void main() {
  vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vRel = vec3(at.x * 8.0, at.y * 8.0 + 2.0, 14.0);
  // The screen is one card from corner to corner, so a megapixel of it costs what a megapixel of cards does.
  vCorner = at;
  vBulge = vec3(vCorner, 0.0);
  vShade = 1.0;
  vUv = (at * 0.4 + 0.5) / 4.0;
  vA = vec3(0.3);
  vB = vec3(0.5, 0.3, 0.3);
  vNormal = vec3(0.0, 0.0, -1.0);
  vLens = vec3(0.0);
  vShows = uCard.z;
  vGrey = uCard.y;
  vFloor = -100.0;
  vHalf = 4.0;
  vFlags = uint(uCard.x);
  gl_Position = vec4(at, 0.0, 1.0);
}`;

export interface FireCost {
  renderer: string;
  timer: boolean;
  /** ms a megapixel of each run, by its name. */
  ms: Record<string, number>;
}

/** Times the jet, the flame, and a lobe with the noise and with bands, on medium and with a light target on high. */
export async function fireCost(): Promise<FireCost> {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome to measure in");
  const f = new Float32Array(FRAME_FLOATS);
  skyFrame(16, theSky(), f);
  airFrame(f, theSky(), 16, 0, 0, 0, 4000, 1, false);
  f[FRAME.eyeHeight] = 10;
  const frame = [...f];
  const matrix = [...look(0, (14 * Math.PI) / 180, 1)];
  const medium = tierOf("medium"), high = tierOf("high");
  const surface = PROGRAMS.surfaceUndyedWhole!(high, "rgba");
  const fire = (name: string, tier: typeof medium, light: boolean, noise: number, kind: number, a: number[], b: number[]): Record<string, unknown> => {
    const text = PROGRAMS.fire!({ ...tier, bursts: { ...tier.bursts, noise } }, "rgba", false, light);
    // A lobe's soot's shade and its heat are its draw's.
    return { name, vertex: FACE, fragment: withDefines(text.fragment, text.defines), samplers: {}, frame, matrix, uniforms: { uEffect: [kind, 1.1, 0.04, 1], uFlatA: a, uFlatB: b, uFrom: [0] } };
  };
  const details = PROGRAMS.details!(medium, "rgba", false, false);
  const card = (name: string, flags: number, grey: number): Record<string, unknown> => ({ name, vertex: CARD, fragment: withDefines(details.fragment, details.defines), samplers: details.samplers, frame, matrix, uniforms: { uCard: [flags, grey, 0.7, 0], uBlend: [1], uCells: [4], uFrom: [0] } });
  // A flame at full power a moment after it lit; a lobe a third through its life, when fire, soot and edge all show.
  const flame = [1, 0.3, 0.37, 0.2], lobe = [0.35, 1, 0.37, 0];
  const runs = [
    { name: "jet", vertex: TUBE, fragment: surface.fragment, samplers: surface.samplers, frame, matrix, uniforms: { uTube: [GLOW_JET, 3], uStreetMaterial: [DROP_GLOW], uEffect: [12, 0xf03838, 1, packEffect(6, false, 3)], uFrom: [0] } },
    fire("flame", medium, false, 1, FIRE_FLAME, flame, [1.1, 0.9]),
    fire("flame, light target", high, true, 2, FIRE_FLAME, flame, [1.1, 0.9]),
    // Medium reads one octave of the noise, high and ultra two, low poly and a phone none.
    fire("lobe", medium, false, 1, FIRE_LOBE, lobe, [0, 0]),
    fire("lobe, two octaves", high, true, 2, FIRE_LOBE, lobe, [0, 0]),
    fire("lobe, bands", medium, false, 0, FIRE_LOBE, lobe, [0, 0]),
    // A puff of smoke, a length of a rope of it eight times as long as wide, and a scorch.
    card("smoke card", DETAIL_SMOKE, 16 / 255),
    card("rope card", DETAIL_SMOKE, 128 / 255),
    card("scorch card", DETAIL_SCORCH, 1),
    // A puff of dust from the atlas, lit: flat shape 1 with the lit and puff flags.
    card("dust card", 1 | 8 | 16, 0.8),
    card("glow card", DETAIL_GLOW, 6 / 16),
    // Low poly's details text, for its link alone.
    ((flat) => ({ name: "links, low poly details", vertex: CARD, fragment: withDefines(flat.fragment, flat.defines), samplers: flat.samplers, frame, matrix, uniforms: { uCard: [DETAIL_SMOKE, 1, 0.7, 0], uBlend: [1], uFrom: [0] } }))(PROGRAMS.details!(tierOf("lowpoly"), "rgba")),
    // The lit details' own two texts, whose vertex text looks a puff of smoke's shadow up: for their link alone.
    ...[["links, medium details", medium], ["links, high details", high]].map(([name, tier]) => {
      const text = PROGRAMS.details!(tier as typeof medium, "rgba");
      return { name: name as string, vertex: withDefines(text.vertex, text.defines), fragment: withDefines(text.fragment, text.defines), samplers: text.samplers, frame, matrix, uniforms: { uCells: [4], uBlend: [1], uFrom: [0] } };
    }),
    // The program's own two texts, which only a card can say link: with no mesh bound they draw nothing, and their times say nothing.
    ...[["links, medium", medium, false], ["links, high", high, true], ["links, low poly", tierOf("lowpoly"), false]].map(([name, tier, light]) => {
      const text = PROGRAMS.fire!(tier as typeof medium, "rgba", false, light as boolean);
      return { name: name as string, vertex: withDefines(text.vertex, text.defines), fragment: withDefines(text.fragment, text.defines), samplers: {}, frame, matrix, uniforms: { uEffect: [FIRE_LOBE, 0, 0, 0], uFrom: [0] } };
    }),
  ];
  const t = await timeRuns(chrome, runs);
  return { renderer: String(t.renderer), timer: Boolean(t.timer), ms: Object.fromEntries(runs.map((r) => [r.name, t[r.name as string] as number])) };
}

/** The pixels a frame's fire and blended cards would fill, each whole, in megapixels by kind, for a view `width` by `height`. */
export function burning(p: FramePacket, fovY: number, width: number, height: number): { lobe: number; flame: number; smoke: number; dust: number; glow: number; scorch: number } {
  const out = { lobe: 0, flame: 0, smoke: 0, dust: 0, glow: 0, scorch: 0 };
  const screen = (width * height) / 1e6;
  // Pixels a metre at a metre.
  const focal = height / (2 * Math.tan(fovY / 2));
  const view = new DataView(p.transient.buffer, p.transient.byteOffset, p.transient.byteLength);
  for (let d = 0; d < p.drawCount; d++) {
    const flags = p.drawFlags[d]!;
    if ((flags & DRAW_FIRE) !== 0) {
      for (let k = 0; k < p.drawInstances[d]!; k++) {
        const at = (p.drawFirst[d]! + k) * 20;
        const far = Math.max(0.5, Math.hypot(view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)));
        if (p.drawEffect[d * 4]! > 0.5) out.lobe += Math.min(screen, (Math.PI * (view.getUint16(at + 12, true) / LOBE_STEPS) ** 2 * focal * focal) / (far * far) / 1e6);
        else out.flame += Math.min(screen, (((p.transient[at + 17]! / 32) ** 2 * 0.4 * focal * focal) / (far * far)) / 1e6);
      }
    } else if ((flags & DRAW_DETAILS) !== 0 && (flags & DRAW_BLEND) !== 0) {
      for (let k = 0; k < p.drawInstances[d]!; k++) {
        const o = (p.drawFirst[d]! + k) * DETAIL_FLOATS, f = p.details;
        const far = Math.max(0.5, Math.hypot(f[o]!, f[o + 1]!, f[o + 2]!));
        // The card's area as the eye sees it: its two half axes crossed, along the way to it.
        const nx = f[o + 4]! * f[o + 8]! - f[o + 5]! * f[o + 7]!, ny = f[o + 5]! * f[o + 6]! - f[o + 3]! * f[o + 8]!, nz = f[o + 3]! * f[o + 7]! - f[o + 4]! * f[o + 6]!;
        const area = Math.min(screen, (4 * Math.abs(nx * f[o]! + ny * f[o + 1]! + nz * f[o + 2]!) * focal * focal) / (far * far * far) / 1e6);
        const kind = (p.detailWords[o + DETAIL.misc]! >>> 8) & 255;
        if (kind === DETAIL_GLOW) out.glow += area;
        else if (kind === DETAIL_SCORCH) out.scorch += area;
        // A puff's part under its floor is behind the ground, and no pixel of it is worked out.
        else if (kind === DETAIL_SMOKE) {
          const tall = Math.abs(f[o + 4]!) + Math.abs(f[o + 7]!);
          out.smoke += area * (tall > 0 ? Math.min(1, Math.max(0, 0.5 + (f[o + 1]! - f[o + DETAIL.floor]!) / (2 * tall))) : 1);
        }
        else out.dust += area;
      }
    }
  }
  return out;
}

/** A rocket's blast 8 m off on medium, played headless: what its fire and cards add to a frame of 1,920 by 1,080, by `cost`, at its peak and four seconds on. */
async function blastFrame(cost: FireCost): Promise<boolean> {
  const { provingView } = await import("../snap.ts");
  const { blastSeed } = await import("../../shared/net/rockets.ts");
  const [W, H] = [1920, 1080];
  const view = provingView(64, 36);
  const { scene, cam, remote, hf } = view;
  scene.assets.tier = tierOf("medium");
  scene.viewHeight = H;
  remote.count = 0;
  const [x, z] = [236, 372];
  [cam.x, cam.z] = [x, z - 8];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.7;
  cam.aspect = W / H;
  cam.pitch = 0.1;
  const ms = (p: FramePacket): { all: number; parts: ReturnType<typeof burning> } => {
    const b = burning(p, cam.fovY, W, H);
    return { all: b.lobe * cost.ms.lobe! + b.flame * cost.ms.flame! + b.smoke * cost.ms["smoke card"]! + b.dust * cost.ms["dust card"]! + b.glow * cost.ms["glow card"]! + b.scorch * cost.ms["scorch card"]!, parts: b };
  };
  const step = (): FramePacket => {
    scene.now += 1000 / 60;
    remote.tick = scene.now * 0.03;
    return scene.build(cam, remote);
  };
  for (let k = 0; k < 4; k++) step();
  const before = ms(scene.packet).all;
  const from = scene.now;
  scene.blasts.burst(2, x, hf.heightAt(x, z), z, 0, 1, 0, 7.5, 1, 0, blastSeed(1, x, 0, z), from);
  let peak = { all: 0, parts: ms(scene.packet).parts }, at = 0, after = 0, lies = 0, fill = 0;
  while (scene.now < from + 4000) {
    const now = ms(step());
    if (now.all > peak.all) [peak, at] = [now, scene.now - from];
    fill = Math.max(fill, scene.packet.detailFill);
    // Its scorch lies on the ground for half a minute, as a tyre's mark does, and is told apart.
    lies = now.parts.scorch * cost.ms["scorch card"]!;
    after = now.all - lies;
  }
  const peakFits = peak.all - before <= 1;
  const settled = after - before <= 0.05;
  const mp = (v: number): string => v.toFixed(2);
  console.log(`a rocket's blast 8 m off, medium, ${W} by ${H} (${((W * H) / 1e6).toFixed(2)} megapixels), every lobe counted whole and every card for what of it is over the ground:`);
  console.log(`  before it                      ${before.toFixed(3)} ms`);
  console.log(`  at its peak, ${String(Math.round(at)).padStart(4)} ms in        ${peak.all.toFixed(3)} ms  (megapixels: lobes ${mp(peak.parts.lobe)}, smoke ${mp(peak.parts.smoke)}, dust ${mp(peak.parts.dust)}, glow ${mp(peak.parts.glow)}, scorch ${mp(peak.parts.scorch)})${peakFits ? "" : "  MISS (at most 1 ms added)"}`);
  console.log(`  four seconds on                ${after.toFixed(3)} ms${settled ? "" : "  MISS (back to before)"}`);
  console.log(`  its scorch, which stays        ${lies.toFixed(3)} ms`);
  console.log(`  the ledger's fill at most      ${fill.toFixed(3)} screens (the tier's ${scene.assets.tier.details.fill})`);
  return peakFits && settled;
}

if (import.meta.main) {
  const cost = await fireCost();
  console.log(`full screen at 1,024 square on ${cost.renderer}, blended, ${cost.timer ? "by timer query" : "by the clock"}, in ms a megapixel:`);
  const jet = cost.ms.jet!;
  let passed = jet > 0 && Number.isFinite(jet);
  for (const [name, ms] of Object.entries(cost.ms)) {
    if (name.startsWith("links")) continue;
    const most = name === "jet" || name.endsWith("card") ? 0 : name.startsWith("flame") ? FLAME_MOST : LOBE_MOST;
    const fits = most === 0 || ms / jet <= most;
    if (!fits) passed = false;
    console.log(`  ${name.padEnd(22)} ${ms.toFixed(4)}${most ? `  ${(ms / jet).toFixed(2)} times the jet (at most ${most})${fits ? "" : "  MISS"}` : ""}`);
  }
  console.log(`  the fire program's own texts link on it, as medium, high with a light target and low poly have them, and the details' texts as each has them`);
  if (process.argv.includes("--blast") && !(await blastFrame(cost))) passed = false;
  process.exit(passed ? 0 : 1);
}
