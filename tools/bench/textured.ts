// Rows for a crowd drawn with materials: 500 creatures in view, each a body on bones in two sections, with their
// textures coming over a made-up link. The tube of tests/fixtures/textured.ts stands in for a creature until real ones
// are drawn this way: it has two bones where a creature has dozens, and its pictures are enlarged to 1,024.
// `bun tools/bench/textured.ts` runs these alone.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_TEXTURED, type FramePacket } from "../../client/core/render/packet.ts";
import { CUE_DEAD, CUE_DECAY_SHIFT, CUE_HURT_SHIFT } from "../../shared/anim/pose.ts";
import { STEP0_SIZE, textureBytes } from "../../shared/pack/texture.ts";
import { sceneSet, sceneWorld } from "../../tests/fixtures/sceneworld.ts";
import { TUBE } from "../../tests/fixtures/textured.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const BODIES = 500;
const PIXELS = 1024;
const VIEW_HEIGHT = 1080;
const FRAME_MS = 1000 / 60;
const MB = 1048576;

/** A herd in rows 3 m apart that widen with the view, a metre between bodies, the nearest row 3 m from the camera. */
function herd(w: ReturnType<typeof sceneWorld>): number {
  const { cam } = w;
  [cam.x, cam.y, cam.z, cam.aspect] = [64, 1.7, 4, 16 / 9];
  const wide = Math.tan(cam.fovY / 2) * cam.aspect * 0.85;
  let nearest = Infinity;
  for (let row = 1, n = 0; n < BODIES; row++) {
    const across = Math.floor(row * 3 * wide);
    for (let k = -across; k <= across && n < BODIES; k++, n++) {
      w.place(TUBE, cam.x + k, cam.z + row * 3, { colors: [8, 7, 14, 6], yaw: n });
      nearest = Math.min(nearest, Math.hypot(k, cam.y, row * 3));
    }
  }
  return nearest;
}

export function benchTextured(section: Section, record: Row): void {
  section(`Client frame build (headless): ${BODIES} creatures in view drawn with materials, the two-bone tube standing in`);
  const tier = tierOf("medium");
  const set = sceneSet(PIXELS);
  const w = sceneWorld({ latencyMs: 50, bytesPerSecond: 2.5e6, keep: true }, tier, set);
  const { scene, cam, remote } = w;
  scene.viewHeight = VIEW_HEIGHT;
  const nearest = herd(w);
  const tube = w.mesh(TUBE);
  /** The bodies a frame draws flat. */
  const flat = (p: FramePacket): number => {
    let bodies = BODIES;
    for (let d = 0; d < p.drawCount; d++) if (p.drawMesh[d] === tube && (p.drawFlags[d]! & DRAW_TEXTURED) !== 0 && p.drawFirstIndex[d] === 0) bodies -= p.drawInstances[d]!;
    return bodies;
  };

  // The step wanted of the tube's textures is the first as wide as its material is shown on the nearest body (D153).
  const shown = (set.manifest.materials!.find((m) => m.id === `${TUBE}/hide`)!.span * VIEW_HEIGHT) / (2 * Math.tan(cam.fovY / 2) * nearest);
  let top = STEP0_SIZE;
  while (top < shown && top < Math.min(tier.texture, PIXELS)) top *= 2;
  const textures = set.manifest.textures!.filter((t) => t.id.startsWith(TUBE));
  const wanted = textures.reduce((sum, t) => sum + textureBytes("rgba", t.role, top), 0);

  // From nothing, over 20 Mbit/s with 50 ms delay.
  const r = scene.assets.residency;
  let [drawnAt, settledAt, mostRows] = [-1, -1, 0];
  for (let f = 0; f < 60 * 60 && settledAt < 0; f++) {
    remote.tick = f / 2;
    const p = w.frame(FRAME_MS, false);
    mostRows = Math.max(mostRows, p.texUploads.reduce((sum, u) => sum + u.data.length, 0));
    if (drawnAt < 0 && flat(p) === 0) drawnAt = w.now();
    if (drawnAt >= 0 && r.flying === 0 && textures.every((t) => w.card.textures.get(set.manifest.textures!.indexOf(t))?.top === top)) settledAt = w.now();
  }
  record("the nearest of them", nearest, "m");
  record("every body drawn with its materials after", (drawnAt < 0 ? Infinity : drawnAt) / 1000, "s", 1.5);
  record("its textures as wide as that shows them after", (settledAt < 0 ? Infinity : settledAt) / 1000, "s");
  record("texture bytes wanted, five textures of one species", wanted / MB, "MB");
  record("texture bytes held", r.texLedger / MB, "MB", Math.ceil((wanted / MB) * 1000) / 1000);
  record("bytes fetched for all of it, levels and surfaces too", r.stats.fetched / MB, "MB");
  record("most texture bytes put on the card in one frame", mostRows / MB, "MB", tier.uploadBytes / MB);
  record("texture bytes put on the card in all, over those held", texturesUp(w) / Math.max(1, r.texLedger), "");

  // Standing there, the camera turning a little.
  const built: number[] = [];
  let packet = scene.packet;
  let rows = 0;
  for (let f = 0; f < 300; f++) {
    cam.yaw = Math.sin(f / 30) * 0.02;
    remote.tick += 0.5;
    scene.now += FRAME_MS;
    const t = performance.now();
    packet = scene.build(cam, remote);
    built.push(performance.now() - t);
    rows += packet.texUploads.length + packet.assetUploads.length;
  }
  built.sort((a, b) => a - b);
  const at = (q: number): number => built[Math.min(built.length - 1, Math.floor(built.length * q))]!;
  record("frame build with them, median", at(0.5), "ms", 1.2);
  record("frame build with them, 99th percentile", at(0.99), "ms", 2.4);
  record("draw calls", packet.drawCount, "", 60);
  record("bodies posed", scene.characters.posed, "");
  record("bones", packet.boneCount, "");
  record("triangles submitted", packet.triangles, "", 850000);
  record("uploads in those 300 frames", rows, "", 0);
  record("bodies drawn flat", flat(packet), "", 0);

  // The same herd at the same levels with no textures to be had, which is what materials add to a frame.
  const plain = sceneWorld({}, { ...tier, texture: 0 }, set);
  plain.scene.viewHeight = VIEW_HEIGHT;
  herd(plain);
  for (let f = 0; f < 10; f++) plain.frame(FRAME_MS, false);
  const without: number[] = [];
  for (let f = 0; f < 300; f++) {
    plain.cam.yaw = Math.sin(f / 30) * 0.02;
    plain.remote.tick += 0.5;
    const t = performance.now();
    plain.scene.build(plain.cam, plain.remote);
    without.push(performance.now() - t);
  }
  without.sort((a, b) => a - b);
  record("frame build, the same herd drawn flat, median", without[150]!, "ms");
  record("draw calls for it", plain.scene.packet.drawCount, "");
  layered(section, record, at(0.5));
}

/**
 * The same herd with a hurt and decay layer on the tube, unhurt, and then with its forty nearest hurt or dead: three
 * in four at a hurt stage and one in four a corpse at a decay stage, each drawn with its layer. `before` is the frame
 * build of the herd above.
 */
function layered(section: Section, record: Row, before: number): void {
  section(`Client frame build (headless): the same herd with hurt and decay layers, none hurt and then ${HURT} of the nearest hurt or dead`);
  const tier = tierOf("medium");
  const set = sceneSet(PIXELS, true);
  const layer = set.manifest.textures!.findIndex((t) => t.role === "layer");
  const run = (cues: (i: number) => number): { median: number; p: FramePacket; held: boolean; layered: number } => {
    const w = sceneWorld({}, tier, set);
    w.scene.viewHeight = VIEW_HEIGHT;
    herd(w);
    for (let i = 0; i < BODIES; i++) w.remote.cue[i] = cues(i);
    for (let f = 0; f < 120; f++) w.frame(FRAME_MS, false);
    const times: number[] = [];
    let p = w.scene.packet;
    for (let f = 0; f < 300; f++) {
      w.cam.yaw = Math.sin(f / 30) * 0.02;
      w.remote.tick += 0.5;
      w.scene.now += FRAME_MS;
      const t = performance.now();
      p = w.scene.build(w.cam, w.remote);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    let drawn = 0;
    for (let d = 0; d < p.drawCount; d++) if (p.drawLayer[d]! > 0) drawn++;
    return { median: times[150]!, p, held: w.card.textures.has(layer), layered: drawn };
  };
  const none = run(() => 0);
  record("none hurt: frame build, median (the herd with no layers above)", none.median, "ms", Math.max(1.2, before * 1.5));
  record("none hurt: draws with a layer; its texture on the card", none.layered + (none.held ? 1 : 0), "", 0);
  const some = run((i) => (i >= HURT ? 0 : i % 4 === 3 ? CUE_DEAD | (((i >> 2) & 3) << CUE_DECAY_SHIFT) : ((i % 4) + 1) << CUE_HURT_SHIFT));
  record(`${HURT} hurt or dead: frame build, median`, some.median, "ms", 1.2);
  record(`${HURT} hurt or dead: draw calls, against none hurt`, some.p.drawCount - none.p.drawCount, "");
  record(`${HURT} hurt or dead: draws with a layer`, some.layered, "");
  record("the layer's texture bytes held", some.held ? textureBytes("rgba", "layer", Math.min(tier.texture, PIXELS)) / MB : 0, "MB");
}

/** The nearest bodies of the herd that are hurt or dead in `layered`. */
const HURT = 40;

/** Bytes of every copy of a texture the card was sent whole. */
function texturesUp(w: ReturnType<typeof sceneWorld>): number {
  return w.card.made.reduce((sum, [t, top]) => sum + textureBytes("rgba", w.manifest.textures![t]!.role, top), 0);
}

if (import.meta.main) {
  benchTextured(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
