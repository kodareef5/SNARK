// The light an orb casts by night: its colour (client/core/render/orb.ts OrbCast), its halo
// (client/core/render/passes/orb.ts), and what the lit programs work out (client/core/render/orb-light.ts): the sphere
// light, the ball in what mirrors, and the shadow it casts.
import { expect, test } from "bun:test";
import { TIERS, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { effectsOff, packetWithout, tierWithout } from "../../client/core/passes.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { ORB_CAST, OrbCast, orbMean, orbNight, orbPick, orbScene, writeOrb } from "../../client/core/render/orb.ts";
import "../../client/core/render/orb-late.ts";
import { LIT_TERRAIN_FRAGMENT } from "../../client/core/render/glsl.ts";
import { ORB_COLOUR, ORB_MIRROR_GLSL, ORB_REACH, ORB_SEEN, ORB_SEES_GLSL, ORB_SHADE_GLSL, ORB_SHADE_LENGTH, ORB_SHADE_SOFT, orbCast, orbMirror, orbReach, orbSees, orbShade } from "../../client/core/render/orb-light.ts";
import { CAST_AT, DETAIL, DETAIL_FLOATS, DETAIL_GLOW, DRAW_DETAILS, DRAW_ORB, FRAME, FRAME_FLOATS, FramePacket, ORB_AT, ORB_LANES } from "../../client/core/render/packet.ts";
import { postFrame } from "../../client/core/render/post.ts";
import { PROGRAMS, withDefines } from "../../client/core/render/programs.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { skyFrame, theSky } from "../../client/core/render/sky.ts";
import { STREET_GLSL, streetMirror } from "../../client/core/render/street-finish.ts";
import { StreetReflections } from "../../client/core/render/street-reflections.ts";
import { lit } from "../../client/core/render/surface.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { nodeForms } from "../../shared/world/nodes.ts";
import { ORB_SCENES, orbCollider, type OrbSite } from "../../shared/world/orb.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { TideEyeSite } from "../../shared/world/tide-eye.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { boxMesh, buildPack } from "../../tools/pack/write.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { compileErrors, linkErrors } from "../fixtures/glsl.ts";
import { sceneRegistry } from "../fixtures/sceneworld.ts";

const RATE = 30;
const SITE: OrbSite = { name: "Sphere", x: 1000, y: 0, z: 1000, yaw: 9000, radius: 78, centre: 34 };
const BLUE: TideEyeSite = { name: "Sphere", x: 1000, y: 0, z: 1210, yaw: 0, color: "blue", radius: 28 };
const NIGHT = 23, NOON = 12;
/** Moments that take each scene through what it follows, as the screen's own tests have them. */
const MOMENTS: readonly (readonly [seconds: number, hour: number])[] = [[362, 12], [371.5, 23], [380, 23], [383.7, 6], [440, 18.2], [475.9, 0], [3.3, 9]];

/** A lit frame's block at `hour` with scene `which` held, the eye (x, y, z) from the ball's foot; `sites` none for a map with no orb. */
function block(which: number, hour: number, seconds = 380, gain = 1, x = 0, y = 2, z = -400, sites: readonly OrbSite[] = [SITE]): Float32Array {
  const frame = new Float32Array(FRAME_FLOATS);
  skyFrame(hour, theSky(), frame);
  postFrame(frame, tierOf("high"), hour, 1080);
  writeOrb(frame, sites, [BLUE], seconds, hour, SITE.x + x, SITE.y + y, SITE.z + z, null, Math.round(seconds * RATE), RATE, which, gain);
  return frame;
}

/** The cast colour of a block as light after exposure, as a still clock takes it: the whole mean at once. */
function castOf(frame: Float32Array): number[] {
  new OrbCast().step(frame, 0);
  return [0, 1, 2].map((c) => frame[ORB_COLOUR + c]! * frame[FRAME.exposure]!);
}

test("the cast colour is the screen's mean over the ball, by its level", () => {
  const seen = [0, 0, 0], mean = [0, 0, 0], dense = 12000;
  for (let which = 0; which < ORB_SCENES.length; which++) {
    for (const [seconds, hour] of MOMENTS) {
      const f = block(which, hour, seconds), sum = [0, 0, 0];
      // A dense reading at a pixel's footprint from across the street, at directions that are not the mean's.
      for (let i = 0; i < dense; i++) {
        const y = 1 - (2 * (i + 0.5)) / dense, r = Math.sqrt(1 - y * y), a = i * 2.39996323 + 0.7, x = r * Math.cos(a), z = r * Math.sin(a);
        const scene = orbPick(f, x, y, z);
        orbScene(seen, f, scene, x, y, z, scene === f[ORB_AT + 8] ? f[ORB_AT + 6]! : f[ORB_AT + 7]!, 0.004);
        for (let c = 0; c < 3; c++) sum[c]! += seen[c]! / dense;
      }
      orbMean(mean, f);
      // Core's light is in thin cracks, which a hundred-odd directions read to a tenth; a fifth is the bound.
      for (let c = 0; c < 3; c++) expect(Math.abs(mean[c]! - sum[c]!), `${ORB_SCENES[which]} at ${seconds} s, ${hour} h: ${mean} against ${sum}`).toBeLessThan(0.2 * Math.max(...sum));
    }
  }
  // In the lanes it is that mean by the level, the night and ORB_CAST, as light before exposure.
  const f = block(2, NIGHT);
  orbMean(mean, f);
  const cast = castOf(f);
  expect(orbNight(f[FRAME.exposure]!, 0)).toBe(1);
  for (let c = 0; c < 3; c++) expect(cast[c]!).toBeCloseTo(mean[c]! * f[ORB_AT + 11]! * ORB_CAST, 4);
  expect(Math.max(...cast)).toBeGreaterThan(0.2);
});

test("the colour follows a new scene smoothly, at any frame rate, and reaches it", () => {
  for (const ms of [1000 / 60, 1000 / 144, 50]) {
    const cast = new OrbCast(), from = block(2, NIGHT), to = block(4, NIGHT), frame = new Float32Array(FRAME_FLOATS);
    const a = castOf(block(2, NIGHT)), b = castOf(block(4, NIGHT)), gap = Math.max(...a.map((v, c) => Math.abs(v - b[c]!)));
    expect(gap).toBeGreaterThan(0.2);
    frame.set(from);
    cast.step(frame, 1000);
    let last = [0, 1, 2].map((c) => frame[ORB_COLOUR + c]! * frame[FRAME.exposure]!), most = 0;
    for (let c = 0; c < 3; c++) expect(last[c]!).toBeCloseTo(a[c]!, 4);
    // The scene is another from one frame to the next, as an admin's setting makes it.
    for (let now = 1000 + ms; now < 3000; now += ms) {
      frame.set(to);
      cast.step(frame, now);
      const next = [0, 1, 2].map((c) => frame[ORB_COLOUR + c]! * frame[FRAME.exposure]!);
      for (let c = 0; c < 3; c++) most = Math.max(most, Math.abs(next[c]! - last[c]!));
      last = next;
    }
    // No frame moves it more than its ease allows of the whole way: a seventh at 60 a second, a third at 20.
    expect(most, `${ms} ms a frame`).toBeLessThan(gap * (1.05 - Math.exp(-ms / 150)) + 1e-4);
    for (let c = 0; c < 3; c++) expect(last[c]!).toBeCloseTo(b[c]!, 3);
  }
});

test("the colour is nothing with no orb or no gain, at once", () => {
  const cast = new OrbCast(), frame = new Float32Array(FRAME_FLOATS);
  frame.set(block(2, NIGHT));
  cast.step(frame, 0);
  expect(Math.max(...cast.shown)).toBeGreaterThan(0.05);
  // The gain at nothing: dark on the next frame, with no tail.
  frame.set(block(2, NIGHT, 380, 0));
  cast.step(frame, 16);
  expect([...frame.subarray(ORB_COLOUR, ORB_COLOUR + 3), ...cast.shown]).toEqual([0, 0, 0, 0, 0, 0]);
  // A map with no orb: its lanes stay empty.
  frame.set(block(2, NIGHT, 380, 1, 0, 2, -400, []));
  cast.step(frame, 32);
  expect(frame.subarray(ORB_AT, ORB_AT + ORB_LANES * 4).every((v) => v === 0)).toBe(true);
  expect([...cast.shown]).toEqual([0, 0, 0]);
});

test("by day the cast light is nothing beside its night's", () => {
  for (let which = 0; which < ORB_SCENES.length; which++) {
    const night = Math.max(...castOf(block(which, NIGHT)));
    expect(night, ORB_SCENES[which]).toBeGreaterThan(0.1);
    expect(Math.max(...castOf(block(which, NOON))), ORB_SCENES[which]).toBe(0);
    // An hour after sunrise and before sunset, a hundredth at the most.
    for (const hour of [7, 17]) expect(Math.max(...castOf(block(which, hour))), `${ORB_SCENES[which]} at ${hour}`).toBeLessThan(0.01 * night);
  }
  // Low poly has no exposure: its halo and pool go by the sun's height.
  expect([orbNight(0, 0.5), orbNight(0, -0.5)]).toEqual([0, 1]);
  expect(orbNight(1, -0.5)).toBe(0);
});

let made: Pack | null = null;
/** The core's grey boxes with a box each for the shell and the plinth, as large as the art's. */
const pack = (): Pack => (made ??= parsePack(buildPack([...grayboxMeshes(CORE_CONTENT), { id: "core:orb/shell", lods: [boxMesh([78, 78, 78], 12)] }, { id: "core:orb/plinth", lods: [boxMesh([80, 3, 80], 5)] }], defaultPalette())));

/** A flat map, its ground at 0, with the ball on it or none, drawn on `tier`. */
function world(tier: Tier, orbs: readonly OrbSite[] | null = [SITE]) {
  const reg = sceneRegistry(), dims = { chunksX: 64, chunksZ: 64 };
  const hf = new Heightfield(dims, TERRAIN_CELL, 0, 1 / 64);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const scene = new Scene({ dims, hf, structs, ...(orbs ? { orbs } : {}), tideEyes: [BLUE] }, reg, pack());
  scene.assets.tier = tier;
  scene.plainSky = true;
  scene.hour = NIGHT;
  scene.eyeSeconds = 380;
  scene.orbOnly = 2;
  const cam = new Camera();
  cam.aspect = 160 / 90;
  scene.viewHeight = 90;
  /** The camera `metres` south of the ball's axis and `up` over the ground, looking at it. */
  const from = (metres: number, up = 2, pitch = 0.05): Camera => {
    cam.x = SITE.x;
    cam.y = up;
    cam.z = SITE.z - metres;
    cam.pitch = pitch;
    return cam;
  };
  return { scene, from, hf };
}

/** The frame's draws of an orb's meshes, and of its cards: the details' draws that hold light with no surface. */
function orbDraws(scene: Scene, p: FramePacket): { meshes: number; cards: number; glows: number } {
  let meshes = 0, cards = 0, glows = 0;
  for (let d = 0; d < p.drawCount; d++) {
    if ((p.drawFlags[d]! & DRAW_DETAILS) === 0) {
      if ((p.drawFlags[d]! & DRAW_ORB) !== 0 || scene.assets.manifest.meshes[p.drawMesh[d]!]!.id.startsWith("core:orb/")) meshes++;
      continue;
    }
    let holds = false;
    for (let n = p.drawFirst[d]!; n < p.drawFirst[d]! + p.drawInstances[d]!; n++) if (((p.detailWords[n * DETAIL_FLOATS + DETAIL.misc]! >>> 8) & 255) === DETAIL_GLOW) holds = true;
    if (holds) cards++;
  }
  for (let n = 0; n < p.detailCount; n++) if (((p.detailWords[n * DETAIL_FLOATS + DETAIL.misc]! >>> 8) & 255) === DETAIL_GLOW) glows++;
  return { meshes, cards, glows };
}

test("the halo adds one draw, and none by day, switched off or with no orb", () => {
  for (const name of ["lowpoly", "medium", "high"]) {
    const { scene, from } = world(tierOf(name));
    for (const metres of [100, 250, 330, 384, 420, 500, 700, 1500, 3000]) {
      const p = scene.build(from(metres), null), { meshes, cards, glows } = orbDraws(scene, p);
      // One card across the view at one depth, so in one depth range: one draw at any distance.
      expect([cards, glows], `${name} from ${metres} m`).toEqual([1, 1]);
      // The gate is five draws: shell and plinth, each in both ranges where it lies across the split, and the halo.
      expect(meshes + cards, `${name} from ${metres} m`).toBeLessThanOrEqual(5);
    }
    const lit = scene.build(from(250), null).drawCount;
    scene.orbGlow = false;
    const off = scene.build(from(250), null);
    expect(orbDraws(scene, off)).toEqual({ meshes: 2, cards: 0, glows: 0 });
    expect(lit - off.drawCount).toBe(1);
    scene.orbGlow = true;
    scene.hour = NOON;
    expect(orbDraws(scene, scene.build(from(250), null)).glows).toBe(0);
    scene.hour = NIGHT;
    scene.orbGain = 0;
    expect(orbDraws(scene, scene.build(from(250), null)).glows).toBe(0);
    const none = world(tierOf(name), null);
    expect(orbDraws(none.scene, none.scene.build(none.from(250), null))).toEqual({ meshes: 0, cards: 0, glows: 0 });
  }
});

test("the halo lies about the ball's middle and grows through the haze", () => {
  const { scene, from } = world(tierOf("medium"));
  const halo = (metres: number): { at: number[]; half: number; shows: number } => {
    const p = scene.build(from(metres, 30), null);
    for (let n = 0; n < p.detailCount; n++) {
      const o = n * DETAIL_FLOATS, misc = p.detailWords[o + DETAIL.misc]!;
      if (((misc >>> 8) & 255) !== DETAIL_GLOW) continue;
      return { at: [p.details[o]!, p.details[o + 1]!, p.details[o + 2]!], half: Math.hypot(p.details[o + DETAIL.along]!, p.details[o + DETAIL.along + 1]!, p.details[o + DETAIL.along + 2]!), shows: (misc >>> 16) & 255 };
    }
    throw new Error("no halo");
  };
  const near = halo(400), far = halo(4000);
  expect(near.at).toEqual([0, SITE.centre - 30, 400]);
  expect(near.half).toBeGreaterThan(2 * SITE.radius);
  expect(far.half).toBeGreaterThan(1.3 * near.half);
  expect(far.shows).toBeGreaterThan(2 * near.shows);
  expect(near.shows).toBeGreaterThan(0);
});

/** A block at `hour` with the colour stepped, so its lanes hold the cast light and what a mirror shows. */
function seenBlock(which: number, hour: number, gain = 1, sites: readonly OrbSite[] = [SITE]): Float32Array {
  const f = block(which, hour, 380, gain, 0, 2, -300, sites);
  new OrbCast().step(f, 0);
  return f;
}

test("a mirror shows the ball where its ray meets it, by day too, exact at any distance", () => {
  const sky = [0.01, 0.02, 0.03], mean = [0, 0, 0];
  for (const hour of [NIGHT, NOON]) {
    const f = seenBlock(2, hour), e = f[FRAME.exposure]!, ball = [...f.subarray(ORB_SEEN, ORB_SEEN + 3)];
    // What it shows is the screen's mean light, before exposure: by night the cast light without its gain.
    orbMean(mean, f);
    for (let c = 0; c < 3; c++) expect(ball[c]! * e).toBeCloseTo(mean[c]! * f[ORB_AT + 11]!, 4);
    if (hour === NIGHT) for (let c = 0; c < 3; c++) expect(ball[c]!).toBeCloseTo(f[ORB_COLOUR + c]! / ORB_CAST, 12);
    else expect([...f.subarray(ORB_COLOUR, ORB_COLOUR + 3)]).toEqual([0, 0, 0]);
    expect(f[ORB_SEEN + 3]).toBe(1);
    // From points near and far, a ray to the ball's middle shows the ball whole, and one well past its outline the sky.
    for (const [x, y, z] of [[0, 0, 0], [40, -1, 200], [-3000, 50, -5000], [0, 300, 290]] as const) {
      const d = [f[ORB_AT]! - x, f[ORB_AT + 1]! - y, f[ORB_AT + 2]! - z], far = Math.hypot(...d), to = d.map((v) => v / far), seen = [...sky];
      if (far <= SITE.radius) continue;
      orbMirror(seen, f, to, x, y, z, 0.05, 1);
      for (let c = 0; c < 3; c++) expect(seen[c]!).toBeCloseTo(ball[c]!, 12);
      // Turned aside by twice the angle the ball's outline is seen at, and a little: nothing of it.
      const turn = 2 * Math.asin(SITE.radius / far) + 0.2, flat = Math.hypot(to[1]!, to[2]!), across = [0, -to[2]! / flat, to[1]! / flat];
      const aside = to.map((v, c) => v * Math.cos(turn) + across[c]! * Math.sin(turn)), beside = [...sky];
      orbMirror(beside, f, aside, x, y, z, 0.05, 1);
      expect(beside).toEqual(sky);
      // The ball behind the mirror's ray: nothing of it.
      const back = [...sky];
      orbMirror(back, f, to.map((v) => -v), x, y, z, 0.05, 1);
      expect(back).toEqual(sky);
      // A surface that mirrors by half shows half of it.
      const half = [...sky];
      orbMirror(half, f, to, x, y, z, 0.05, 0.5);
      for (let c = 0; c < 3; c++) expect(half[c]!).toBeCloseTo((ball[c]! + sky[c]!) / 2, 12);
    }
  }
});

test("the ball's outline in a mirror is soft by the surface's roughness and never steps", () => {
  const f = seenBlock(2, NIGHT), ball = f[ORB_SEEN]!, d = [f[ORB_AT]!, f[ORB_AT + 1]!, f[ORB_AT + 2]!], far = Math.hypot(...d);
  /** The share of the ball a mirror of `rough` shows along a ray `angle` off the way to its middle. */
  const share = (angle: number, rough: number): number => {
    const flat = Math.hypot(d[0]!, d[2]!), up = Math.atan2(d[1]!, flat) + angle, round = Math.atan2(d[0]!, d[2]!), seen = [0, 0, 0];
    orbMirror(seen, f, [Math.sin(round) * Math.cos(up), Math.sin(up), Math.cos(round) * Math.cos(up)], 0, 0, 0, rough, 1);
    return seen[0]! / ball;
  };
  const outline = Math.asin(SITE.radius / far);
  /** The angle over which the share falls from nine tenths to a tenth, walking out across the outline. */
  const edge = (rough: number): number => {
    let last = 1, from = NaN, to = NaN;
    for (let angle = 0; angle < outline + 0.6; angle += 0.0001) {
      const now = share(angle, rough);
      expect(now).toBeLessThanOrEqual(last + 1e-12);
      expect(last - now).toBeLessThan(0.05);
      if (Number.isNaN(from) && now <= 0.9) from = angle;
      if (Number.isNaN(to) && now <= 0.1) to = angle;
      last = now;
    }
    expect(last).toBe(0);
    return to - from;
  };
  const polished = edge(0.05), dull = edge(0.5);
  expect(polished).toBeLessThan(0.05);
  expect(dull).toBeGreaterThan(3 * polished);
  // A mirror polished smooth shows all of it inside the outline; a dull one, wider than the ball, shows it dimmer.
  expect(share(0, 0.05)).toBe(1);
  expect(share(0, 1)).toBeLessThan(1);
  expect(share(0, 1)).toBeGreaterThan(0.3);
});

test("a mirror shows a dark ball with its screen off, and no ball with none or when off", () => {
  const sky = [0.01, 0.02, 0.03], to = (f: Float32Array): number[] => {
    const d = [f[ORB_AT]!, f[ORB_AT + 1]!, f[ORB_AT + 2]!], far = Math.hypot(...d) || 1;
    return d.map((v) => v / far);
  };
  // The gain at nothing: the ball hides the sky behind it.
  const dark = seenBlock(2, NIGHT, 0), seen = [...sky];
  orbMirror(seen, dark, to(dark), 0, 0, 0, 0.05, 1);
  expect(seen).toEqual([0, 0, 0]);
  // No orb: the lane is empty and the sky is as it was.
  const bare = seenBlock(2, NIGHT, 1, []);
  expect([...bare.subarray(ORB_SEEN, ORB_SEEN + 4)]).toEqual([0, 0, 0, 0]);
  const same = [...sky];
  orbMirror(same, bare, [0, 0, 1], 0, 0, 0, 0.05, 1);
  expect(same).toEqual(sky);
  // `orbmirror` empties the lane in a built frame, and low poly, which mirrors nothing, never fills it.
  for (const [name, fills] of [["medium", true], ["lowpoly", false]] as const) {
    const { scene, from } = world(tierOf(name)), p = scene.build(from(300), null);
    expect(p.frame[ORB_SEEN + 3], name).toBe(fills ? 1 : 0);
    packetWithout(p, effectsOff("orbmirror"));
    expect([...p.frame.subarray(ORB_SEEN, ORB_SEEN + 4)]).toEqual([0, 0, 0, 0]);
    expect(p.frame[ORB_AT + 3]).toBe(SITE.radius);
  }
  // One branch in the text, on the lane a map with no orb leaves empty, and every lit program has it by the light's text.
  expect(ORB_MIRROR_GLSL.match(/\bif\b/g)).toEqual(["if"]);
  expect(ORB_MIRROR_GLSL).toContain("if (fOrb[7].w <= 0.0) return seen;");
  expect(STREET_GLSL).toContain("original = orbMirror(original, ray, rel, rough, mask);");
  expect(STREET_GLSL).not.toContain("fOrb");
});

test("wet ground at street level mirrors the ball with no car by, in the terrain program", () => {
  // The ground's program mirrors the ball over the sky it mirrors, whatever its roughness under 1.
  expect(LIT_TERRAIN_FRAGMENT).toContain("vec3 mirrored = orm.y >= 1.0 ? vec3(0.0) : orbMirror(worldSharp ? skyFrom(r) : skyLight(r), r, vRel, orm.y, 1.0);");
  for (const tier of TIERS) {
    if (!tier.lit) continue;
    const text = PROGRAMS.terrain!(tier, "rgba", false, tier.post !== null), fragment = withDefines(text.fragment, text.defines);
    expect(fragment).toContain("vec3 orbMirror(vec3 seen, vec3 ray, vec3 rel, float rough, float share) {");
    expect(compileErrors(fragment), tier.name).toEqual([]);
  }
  // An eye 1.7 m over a wet street 300 m south of the ball, looking along it: the ground between, seen at a glance,
  // mirrors the ball's lower half where the mirrored ray climbs to it, and the sky nearer the eye and beside the ball.
  const f = block(4, NIGHT, 380, 1, 0, 1.7, -300), sky = [1e-8, 2e-8, 4e-8], wet = 0.25;
  new OrbCast().step(f, 0);
  const ball = [...f.subarray(ORB_SEEN, ORB_SEEN + 3)];
  expect(Math.max(...ball)).toBeGreaterThan(10 * Math.max(...sky));
  /** What the ground `ahead` metres before the eye and `side` metres across mirrors: the view's ray turned up off level ground. */
  const mirrored = (ahead: number, side: number): number[] => {
    const l = Math.hypot(side, 1.7, ahead), seen = [...sky];
    orbMirror(seen, f, [side / l, 1.7 / l, ahead / l], side, -1.7, ahead, wet, 1);
    return seen;
  };
  // 150 m ahead the mirrored ray meets the ball 0.6 degrees up: the screen's light, many times the sky's.
  for (let c = 0; c < 3; c++) expect(mirrored(150, 0)[c]!).toBeCloseTo(ball[c]!, 9);
  // 3 m ahead the ray climbs at 30 degrees and passes over it; 150 m ahead and 150 m aside it passes beside it.
  expect(mirrored(3, 0)).toEqual(sky);
  expect(mirrored(150, 150)).toEqual(sky);
  // Dry asphalt, rough, shows a dim smear of it, not nothing.
  const dry = [...sky];
  orbMirror(dry, f, [0, 1.7 / Math.hypot(1.7, 150), 150 / Math.hypot(1.7, 150)], 0, -1.7, 150, 0.9, 1);
  expect(dry[2]!).toBeGreaterThan(sky[2]!);
  expect(dry[2]!).toBeLessThan(ball[2]!);
});

const reg = compileContent(CORE_CONTENT).registry!;
/**
 * A street with a car to hold the shared picture, 2 m north of the camera, and the ball `away` metres north of it by
 * night: the block, the orb's lanes and colour and then the picture, each frame. `gain` is the screen's, by the frame's time.
 */
function street(away: number, gain: (now: number) => number = () => 1) {
  const dims = { chunksX: 2, chunksZ: 2 }, forms = nodeForms(reg);
  const land = { nodes: new StructureStore(dims, forms.halfX, forms.halfY, forms.halfZ, null, forms.parts), dims, hf: new Heightfield(dims, 4, 0, 1), structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
  const cam = new Camera();
  cam.x = cam.z = 40;
  cam.y = 1.6;
  cam.update();
  const capture = new StreetReflections(reg, defaultPalette(), forms), p = new FramePacket(), cars = new RemoteSample();
  p.tier = tierOf("high");
  p.lit = true;
  const car = (n: number, x: number, z: number): void => {
    cars.count = Math.max(cars.count, n + 1);
    cars.id[n] = 900 + n;
    cars.kind[n] = reg.index.get("core:compact")!;
    cars.x[n] = x;
    cars.z[n] = z;
    cars.colors[n * 6] = 41 + n;
  };
  car(0, 40, 42);
  const site: OrbSite = { ...SITE, x: 40, z: 40 + away };
  const cast = new OrbCast();
  const tick = (now: number): FramePacket => {
    skyFrame(NIGHT, theSky(), p.frame);
    postFrame(p.frame, p.tier, NIGHT, 1080);
    writeOrb(p.frame, [site], [BLUE], 380, NIGHT, cam.x, cam.y, cam.z, null, 380 * RATE, RATE, 2, gain(now));
    cast.step(p.frame, now);
    capture.frame(p, cam, land, cars, new Set(), now);
    return p;
  };
  /** What the car's paint mirrors along a ray, a unit vector, at the picture's own eye, as light after exposure less the gloss's gain. */
  const mirrors = (ray: readonly number[]): number[] => {
    const out = new Float64Array([0.001, 0.002, 0.004].map((v) => v / p.frame[FRAME.exposure]!));
    streetMirror(out, p, ray, p.frame[FRAME.reflection]!, p.frame[FRAME.reflection + 1]!, p.frame[FRAME.reflection + 2]!, 0.05, 1);
    return [...out].map((v) => (v * p.frame[FRAME.exposure]!) / (1 + p.frame[FRAME.streetLook]!));
  };
  return { tick, car, land, cam, site, p, mirrors };
}

test("a car's paint mirrors the ball from the first frame, and what stands nearer covers it", () => {
  const s = street(300), p = s.tick(0), e = p.frame[FRAME.exposure]!;
  // The way from the picture's eye, which is the car, to the ball's upper half, over a car's roof.
  const d = [s.site.x - 40, s.site.y + s.site.centre + 50 - 1.6 - p.frame[FRAME.reflection + 1]!, s.site.z - 42], far = Math.hypot(...d), to = d.map((v) => v / far);
  const ball = [...p.frame.subarray(ORB_SEEN, ORB_SEEN + 3)].map((v) => v * e);
  expect(ball[0]!).toBeGreaterThan(0.1);
  // Before the picture has faded in, and once it has: the screen's mean light, with no picture of it to wait for.
  expect(p.frame[FRAME.reflection + 3]).toBe(0);
  for (let c = 0; c < 3; c++) expect(s.mirrors(to)[c]!).toBeCloseTo(ball[c]!, 6);
  s.tick(250);
  expect(p.frame[FRAME.reflection + 3]).toBe(1);
  for (let c = 0; c < 3; c++) expect(s.mirrors(to)[c]!).toBeCloseTo(ball[c]!, 6);
  // A second car 6 m toward the ball stands in the picture, before the ball: the paint mirrors the car there, not the ball.
  s.car(1, 40, 48);
  s.tick(500);
  s.tick(1000);
  const level = [0, 0, 1], behind = s.mirrors(level);
  expect(behind[0]!).toBeLessThan(0.2 * ball[0]!);
  // Over the car's roof the ball shows as before.
  for (let c = 0; c < 3; c++) expect(s.mirrors(to)[c]!).toBeCloseTo(ball[c]!, 6);
});

test("the orb's own colliders are not in the street's picture, and a wall by the shell is", () => {
  // The picture's car stands 12 m from the ball's skin: the shell's pieces are near enough to be in the picture.
  const collider = reg.defs.findIndex((d) => d !== undefined && d !== null && orbCollider(d.id)), wall = reg.index.get("core:zruin_zmass8_steel")!;
  expect(collider).toBeGreaterThan(0);
  expect(reg.halfY[collider]).toBeGreaterThan(1);
  const to = [0, 0.2, 1].map((v) => v / Math.hypot(0.2, 1));
  const shown = (kind: number): { mirrored: number[]; ball: number[] } => {
    const s = street(SITE.radius + 14);
    // A piece 10 m north of the camera, between the car and the ball, standing 16 m tall.
    if (kind > 0) for (const y of [4, 12]) s.land.structs.add(kind, 40, y, 50, 0, 0, 1);
    s.tick(0);
    const p = s.tick(250);
    return { mirrored: s.mirrors(to), ball: [...p.frame.subarray(ORB_SEEN, ORB_SEEN + 3)].map((v) => v * p.frame[FRAME.exposure]!) };
  };
  const open = shown(0), piece = shown(collider), walled = shown(wall);
  for (let c = 0; c < 3; c++) expect(open.mirrored[c]!).toBeCloseTo(open.ball[c]!, 6);
  // A collider of the ball is drawn as nothing: the mirror shows the ball through it.
  expect(piece.mirrored).toEqual(open.mirrored);
  // A wall is a wall, however near the shell it stands.
  expect(walled.mirrored[0]!).toBeLessThan(0.2 * open.ball[0]!);
});

test("turning the orb off leaves a parked car's mirrored ground as it was, every frame", () => {
  // The screen goes dark 400 ms in, between two pictures, in a street where nothing else changes.
  const s = street(300, (now) => (now < 400 ? 1 : 0));
  const down = [0.6, -0.5, 0.3].map((v) => v / Math.hypot(0.6, 0.5, 0.3)), d = [0, SITE.centre - 1, 298], far = Math.hypot(...d), to = d.map((v) => v / far);
  let least = Infinity, most = 0, lit = 0, dark = 0;
  for (let now = 0; now <= 1500; now += 1000 / 60) {
    const p = s.tick(now);
    if (now < 300) continue;
    const ground = s.mirrors(down)[0]!;
    least = Math.min(least, ground);
    most = Math.max(most, ground);
    // The ball itself goes dark at once in the mirror, as it does on the screen.
    if (p.frame[ORB_AT + 11]! > 0) lit = Math.max(lit, s.mirrors(to)[0]!);
    else dark = Math.max(dark, s.mirrors(to)[0]!);
  }
  expect(least).toBeGreaterThan(0);
  expect(most / least).toBeLessThan(1.001);
  expect(lit).toBeGreaterThan(0.1);
  expect(dark).toBe(0);
});

test("the sphere light is strongest at the skin and gone at its reach", () => {
  const f = block(2, NIGHT, 380, 1, 0, 2, -400), cx = f[ORB_AT]!, cy = f[ORB_AT + 1]!, cz = f[ORB_AT + 2]!;
  /** A point `metres` from the skin toward the eye's side, level with the middle, facing the ball. */
  const facing = (metres: number): number => orbReach(f, cx, cy, cz - SITE.radius - metres, 0, 0, 1);
  expect(facing(0)).toBeCloseTo(1, 6);
  let last = 1;
  for (const metres of [5, 20, 60, 150, 300, 390]) {
    const now = facing(metres);
    expect(now).toBeLessThan(last);
    expect(now).toBeGreaterThan(0);
    last = now;
  }
  // By the square of the distance from its middle near it, and nothing from its reach on.
  expect(facing(SITE.radius) / (1 - (SITE.radius / ORB_REACH) ** 2) ** 2).toBeCloseTo(0.25, 6);
  expect([facing(ORB_REACH), facing(ORB_REACH + 1), facing(5000)]).toEqual([0, 0, 0]);
  // By how much of the ball a face sees: nothing turned away, and edge on still the share its angular size gives.
  const at = cz - SITE.radius - 40, size = SITE.radius / (SITE.radius + 40);
  expect(orbReach(f, cx, cy, at, 0, 0, -1)).toBe(0);
  expect(orbReach(f, cx, cy, at, 0, 1, 0) / orbReach(f, cx, cy, at, 0, 0, 1)).toBeCloseTo(size / (1 + size), 6);
  expect(orbReach(f, cx, cy, at, 0, Math.sin(Math.PI / 3), 0.5) / orbReach(f, cx, cy, at, 0, 0, 1)).toBeCloseTo((0.5 + size) / (1 + size), 6);
  // The ground takes most at the foot, where the ball stands highest over it.
  const ground = (metres: number): number => orbReach(f, cx, cy - SITE.centre, cz - metres, 0, 1, 0);
  const foot = Math.sqrt(SITE.radius ** 2 - SITE.centre ** 2);
  expect(ground(foot + 1)).toBeGreaterThan(0.3);
  for (const metres of [100, 150, 250, 400]) expect(ground(metres)).toBeLessThan(ground(metres - 20));
  // A map with no orb gives none anywhere.
  expect(orbReach(block(2, NIGHT, 380, 1, 0, 2, -400, []), 0, 0, 0, 0, 0, 1)).toBe(0);
});

test("the software render adds the orb's light where the tier takes it, not to metal", () => {
  const f = block(2, NIGHT, 380, 1, 0, 2, -200);
  new OrbCast().step(f, 0);
  const n = [0, 0, 1], v = [0, 0, -1], grey = [0.5, 0.5, 0.5], sky = [0, 0, 0], plain = new Float64Array(3), lighted = new Float64Array(3), metal = new Float64Array(3), bare = new Float64Array(3);
  const x = f[ORB_AT]!, y = f[ORB_AT + 1]!, z = f[ORB_AT + 2]! - SITE.radius - 30;
  orbSees(f, false, x, y, z, 0, 0, 1);
  expect([...orbCast]).toEqual([0, 0, 0]);
  lit(plain, grey, [1, 1, 0], n, v, f, sky);
  orbSees(f, true, x, y, z, 0, 0, 1);
  const share = orbReach(f, x, y, z, 0, 0, 1);
  expect(share).toBeGreaterThan(0.4);
  lit(lighted, grey, [1, 1, 0], n, v, f, sky);
  // What it adds is the colour by the share and the surface's own colour, with no highlight.
  for (let c = 0; c < 3; c++) expect(lighted[c]! - plain[c]!).toBeCloseTo(f[ORB_COLOUR + c]! * share * 0.5, 9);
  expect((lighted[0]! - plain[0]!) * f[FRAME.exposure]!).toBeGreaterThan(0.1);
  // Metal takes none of it, as it takes none of any light but in its highlight.
  lit(bare, grey, [1, 1, 1], n, v, f, sky);
  orbSees(f, false, x, y, z, 0, 0, 1);
  lit(metal, grey, [1, 1, 1], n, v, f, sky);
  expect([...bare]).toEqual([...metal]);
  orbCast.fill(0);
});

test("the ground takes the light on every lit tier, all else on high and ultra, in one branch", () => {
  expect(TIERS.map((t) => [t.orb.ground, t.orb.light])).toEqual([[false, false], [true, false], [true, true], [true, true]]);
  expect(tierWithout(tierOf("high"), effectsOff("orblight")).orb).toMatchObject({ light: false, ground: false });
  expect(tierWithout(tierOf("high"), effectsOff("orbglow,orbmirror")).orb).toMatchObject({ light: true, ground: true });
  // The twin's reach and lanes are the text's, and a map with no orb leaves at its first line.
  expect(ORB_SEES_GLSL).toContain(`/ ${ORB_REACH.toFixed(1)}`);
  expect(ORB_SEES_GLSL).toContain("gOrb = fOrb[6].yzw * (s * s * w * w * max((dot(normal, d) / far + s) / (1.0 + s), 0.0));");
  expect(ORB_SEES_GLSL.match(/\bif\b/g)).toEqual(["if"]);
  expect(ORB_SEES_GLSL).toContain("if (fOrb[0].w <= 0.0) return;");
  expect([ORB_COLOUR, ORB_SEEN]).toEqual([ORB_AT + 6 * 4 + 1, ORB_AT + 7 * 4]);
  for (const tier of TIERS) {
    if (!tier.lit) continue;
    for (const name of ["flat", "terrain", "terrainWindow", "far", "pulled", "seeThrough", "surface", "surfaceLayer", "details", "water", "sky"]) {
      const text = PROGRAMS[name]!(tier, "rgba", false, tier.post !== null), takes = text.defines.includes("#define ORB_LIGHT\n");
      // The ground's programs by the tier's `ground`; the sea and the dome do not light by `lit`.
      expect(takes, `${tier.name} ${name}`).toBe(name.startsWith("terrain") ? tier.orb.ground : tier.orb.light && name !== "water" && name !== "sky");
      const fragment = withDefines(text.fragment, text.defines);
      if (takes) expect(fragment).toContain("light += gOrb * albedo * (1.0 - mro.b);");
      // The same texts and samplers with the light as without: no new program and no new sampler.
      const without = PROGRAMS[name]!(tierWithout(tier, effectsOff("orblight")), "rgba", false, tier.post !== null);
      expect([without.fragment, without.vertex, without.samplers]).toEqual([text.fragment, text.vertex, text.samplers]);
      expect(without.defines).toBe(text.defines.replace("#define ORB_LIGHT\n", ""));
      if (tier.name !== "high") continue;
      const vertex = withDefines(text.vertex, text.defines);
      expect([...compileErrors(vertex), ...compileErrors(fragment), ...linkErrors(vertex, fragment)], name).toEqual([]);
    }
  }
});

test("medium lights the ground by the ball, high the plinth too; with no orb nothing changes", () => {
  const picture = (tier: Tier, orbs: readonly OrbSite[] | null, hour = NIGHT): { color: Uint8ClampedArray; p: FramePacket } => {
    const { scene, from, hf } = world(tier, orbs), raster = new Rasterizer(160, 90, pack(), hf);
    scene.hour = hour;
    scene.orbGlow = false;
    const p = scene.build(from(200, 60, -0.3), null);
    raster.render(p);
    return { color: raster.color.slice(), p };
  };
  // The ground before the ball and the plinth's top, in the view's middle column.
  const ground = (80 * 160 + 80) * 4, top = (60 * 160 + 80) * 4;
  for (const [name, plinth] of [["medium", false], ["high", true]] as const) {
    const tier = tierOf(name), plain = tierWithout(tier, effectsOff("orblight")), on = picture(tier, [SITE]), off = picture(plain, [SITE]);
    expect(on.color[ground]! - off.color[ground]!, name).toBeGreaterThan(15);
    if (plinth) expect(on.color[top]! - off.color[top]!).toBeGreaterThan(15);
    else expect(on.color[top]).toBe(off.color[top]!);
    // By day the light adds nothing.
    expect([...picture(tier, [SITE], NOON).color]).toEqual([...picture(plain, [SITE], NOON).color]);
    // With no orb the frame is the same with the light as without it, and its lanes are empty.
    const bare = picture(tier, null), bareOff = picture(plain, null);
    expect([...bare.color]).toEqual([...bareOff.color]);
    expect(bare.p.drawCount).toBe(bareOff.p.drawCount);
    expect(bare.p.detailCount).toBe(bareOff.p.detailCount);
    expect(bare.p.frame.subarray(ORB_AT, ORB_AT + ORB_LANES * 4).every((v) => v === 0)).toBe(true);
  }
});

/** A point `along` metres down the ball's shadow from its middle and `off` metres to the side of the shadow's axis, in a block's frame. */
function downLight(f: Float32Array, along: number, off: number): [number, number, number] {
  const lx = f[CAST_AT]!, ly = f[CAST_AT + 1]!, lz = f[CAST_AT + 2]!, flat = Math.hypot(lx, lz);
  // Across the light and level.
  const sx = lz / flat, sz = -lx / flat;
  return [f[ORB_AT]! - lx * along + sx * off, f[ORB_AT + 1]! - ly * along, f[ORB_AT + 2]! - lz * along + sz * off];
}

test("the ball's shadow is dark down the light from it, lit beside it, before it and past its length", () => {
  for (const hour of [9, 12, 16]) {
    const f = block(1, hour);
    expect(f[CAST_AT + 3]).toBe(1);
    // Down the light from the ball's middle, on the shadow's axis: dark from inside the ball to half the shadow's length.
    for (const along of [0, 40, 78, 150, 400, 0.5 * ORB_SHADE_LENGTH - 1]) expect(orbShade(f, ...downLight(f, along, 0)), `${hour} h, ${along} m`).toBe(0);
    // Toward the light from the ball, and well to the side of the shadow: all of the light.
    for (const along of [-79, -90, -400]) expect(orbShade(f, ...downLight(f, along, 0))).toBe(1);
    expect(orbShade(f, ...downLight(f, -79, 60))).toBe(1);
    for (const along of [100, 600]) expect(orbShade(f, ...downLight(f, along, 78 + 20))).toBe(1);
    // It fades over the second half of its length and is gone at its end.
    let last = 0;
    for (let along = 0.5 * ORB_SHADE_LENGTH; along <= ORB_SHADE_LENGTH; along += 25) {
      const now = orbShade(f, ...downLight(f, along, 0));
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(last).toBeCloseTo(1, 9);
    expect([orbShade(f, ...downLight(f, ORB_SHADE_LENGTH + 1, 0)), orbShade(f, ...downLight(f, 5000, 0))]).toEqual([1, 1]);
  }
  // On the ground at noon: dark under the ball's overhang, lit a few metres out from under it.
  const noon = block(1, 12), cx = noon[ORB_AT]!, gy = noon[ORB_AT + 1]! - SITE.centre, cz = noon[ORB_AT + 2]!;
  expect(orbShade(noon, cx, gy, cz - 72)).toBeLessThan(0.05);
  expect(orbShade(noon, cx, gy, cz - 120)).toBe(1);
  // A map with no orb: all of the light everywhere.
  const bare = block(1, 12, 380, 1, 0, 2, -400, []);
  expect([orbShade(bare, 0, 0, 0), orbShade(bare, 0, -34, 300)]).toEqual([1, 1]);
});

test("the shadow's edge is soft, never steps back, and widens down the light", () => {
  const f = block(1, 16);
  /** The metres across the edge over which the light goes from a tenth to nine tenths, walking out from the axis. */
  const edge = (along: number): number => {
    let last = -1, from = NaN, to = NaN;
    for (let off = 30; off <= 160; off += 0.05) {
      const now = orbShade(f, ...downLight(f, along, off));
      expect(now).toBeGreaterThanOrEqual(last);
      if (Number.isNaN(from) && now >= 0.1) from = off;
      if (Number.isNaN(to) && now >= 0.9) to = off;
      last = now;
    }
    expect(last).toBe(1);
    // The edge lies about the ball's outline.
    expect(from).toBeLessThan(SITE.radius);
    expect(to).toBeGreaterThan(SITE.radius);
    return to - from;
  };
  const near = edge(100), far = edge(600);
  expect(near).toBeGreaterThan(ORB_SHADE_SOFT);
  expect(near).toBeLessThan(8);
  expect(far).toBeGreaterThan(2 * near);
  // No step along the light either, from before the ball into its shadow.
  let last = 2, least = 1;
  for (let along = -90; along <= 60; along += 0.05) {
    const now = orbShade(f, ...downLight(f, along, 0));
    expect(now).toBeLessThanOrEqual(last);
    expect(last === 2 ? 0 : last - now).toBeLessThan(0.05);
    last = now;
    least = Math.min(least, now);
  }
  expect(least).toBe(0);
});

test("the shadow is the casting light's: the moon's by night, fainter at dusk, none when off", () => {
  // By night the moon owns the cascades, and the ball's shadow lies down its light.
  const night = block(1, NIGHT);
  expect(night[CAST_AT + 3]).toBeGreaterThan(0.9);
  expect(orbShade(night, ...downLight(night, 150, 0))).toBeCloseTo(1 - night[CAST_AT + 3]!, 6);
  // As much as the light casts: half a shadow where it casts by half.
  const dusk = block(1, 12);
  dusk[CAST_AT + 3] = 0.5;
  expect(orbShade(dusk, ...downLight(dusk, 150, 0))).toBe(0.5);
  dusk[CAST_AT + 3] = 0;
  expect(orbShade(dusk, ...downLight(dusk, 150, 0))).toBe(1);
  // Every tier with shadows takes it, the sea's program too, in one branch; `orbshade` takes it out and nothing else.
  expect(ORB_SHADE_GLSL.match(/\bif\b/g)).toEqual(["if"]);
  expect(ORB_SHADE_GLSL).toContain("if (fOrb[0].w <= 0.0) return 1.0;");
  expect(ORB_SHADE_GLSL).toContain(`${ORB_SHADE_LENGTH.toFixed(1)}, along)`);
  for (const tier of TIERS) {
    for (const name of ["flat", "terrain", "far", "surface", "details", "water", "sky"]) {
      const text = PROGRAMS[name]!(tier, "rgba", false, tier.post !== null), off = PROGRAMS[name]!(tierWithout(tier, effectsOff("orbshade")), "rgba", false, tier.post !== null);
      expect(text.defines.includes("#define ORB_SHADE\n"), `${tier.name} ${name}`).toBe(tier.lit && tier.shadows.size > 0 && name !== "sky");
      expect([off.fragment, off.vertex, off.samplers, off.defines]).toEqual([text.fragment, text.vertex, text.samplers, text.defines.replace("#define ORB_SHADE\n", "")]);
      if (tier.name !== "medium" || !text.defines.includes("ORB_SHADE")) continue;
      const vertex = withDefines(text.vertex, text.defines), fragment = withDefines(text.fragment, text.defines);
      expect(fragment).toContain("return mapShadow(rel, normal) * orbShade(rel);");
      expect([...compileErrors(vertex), ...compileErrors(fragment), ...linkErrors(vertex, fragment)], name).toEqual([]);
    }
  }
});

test("the software render draws the ball's shadow on the ground; with no orb nothing changes", () => {
  const picture = (tier: Tier, orbs: readonly OrbSite[] | null, hour: number): Uint8ClampedArray => {
    const { scene, from, hf } = world(tier, orbs), raster = new Rasterizer(160, 90, pack(), hf);
    scene.hour = hour;
    scene.orbOnly = 1;
    const cam = from(420, 380, -0.62);
    cam.x -= 250;
    cam.yaw = 0.5;
    raster.render(scene.build(cam, null));
    return raster.color.slice();
  };
  for (const name of ["medium", "high"]) {
    const tier = tierOf(name), plain = tierWithout(tier, effectsOff("orbshade"));
    // Late in the day the shadow lies long to the east of the ball: many of the ground's pixels are darker by it, and none lighter.
    const on = picture(tier, [SITE], 17), off = picture(plain, [SITE], 17);
    let darker = 0, lighter = 0;
    for (let i = 0; i < on.length; i += 4) {
      const d = on[i]! + on[i + 1]! + on[i + 2]! - off[i]! - off[i + 1]! - off[i + 2]!;
      if (d < -30) darker++;
      if (d > 0) lighter++;
    }
    expect(darker, name).toBeGreaterThan(300);
    expect(lighter, name).toBe(0);
    expect([...picture(tier, null, 17)]).toEqual([...picture(plain, null, 17)]);
  }
});
