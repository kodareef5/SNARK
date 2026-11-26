// Garments drawn over the body (characters.ts `dress`): a worn garment's cut is one more instance on the body's bones at
// its body slot's level, and hides the zones it covers only while it is drawn. Armour on its slot wins. Every wearer of
// one cut at one level is one draw. Its regions 1, 4 and 5 take the slot's dye over its edition's colours over its own.

import { expect } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_RANGED, DRAW_SKINNED, DRAW_TEXTURED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { LOOK_BYTES, LOOK_SEX, defaultLook } from "../../shared/anim/look.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent, withContent, type Registry } from "../../shared/content/registry.ts";
import { hashBytes } from "../../shared/hash.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { GEAR_COUNT, GEAR_WORN, WORN_FIELDS, WORN_LENGTH } from "../../shared/sim/entities.ts";
import { asTextured } from "../../tools/bench/base.ts";
import { provingView, type ProvingView } from "../../tools/snap.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { test } from "../fixtures/needs-art.ts";

const EXTRA: Def[] = [
  { type: "item", class: "garment", id: "test:uncooked_tee", stack: 1, color: 15, garment: { slot: "top", covers: [2, 3], cut: "no_such_cut" } },
] as Def[];
let game: { reg: Registry; pack: Uint8Array } | null = null;
const gameOf = (): { reg: Registry; pack: Uint8Array } => (game ??= { reg: withContent(compileContent(CORE_CONTENT).registry!, EXTRA), pack: corePackBytes() });

/** What a body wears: wardrobe slot by name, each an item id with its edition and dye; armour by body slot. */
interface Dress {
  top?: string;
  bottom?: string;
  outer?: string;
  shoes?: string;
  armor?: (string | null)[];
  edition?: number;
  dye?: number;
}
const SLOTS = ["top", "bottom", "outer", "shoes"] as const;

/** `count` survivors 6 m ahead on medium, men and women by turns, all standing alike, in `dress`. */
function crowd(dress: Dress, count = 2, hook = true): ProvingView {
  const g = gameOf();
  const view = provingView(320, 180, undefined, undefined, undefined, g);
  const { scene, cam, remote, hf, reg } = view;
  scene.assets.tier = tierOf("medium");
  scene.viewHeight = 1080;
  asTextured(scene);
  [cam.yaw, cam.pitch, cam.fovY, cam.aspect] = [Math.PI, -0.1, (70 * Math.PI) / 180, 16 / 9];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.62;
  remote.count = count;
  for (let n = 0; n < count; n++) {
    const look = defaultLook();
    look[LOOK_SEX] = n % 2;
    // In rows on an arc 6 m off, so every body is at one level.
    const a = (n / Math.max(1, count - 1) - 0.5) * 0.9;
    [remote.id[n], remote.kind[n], remote.flags[n], remote.anim[n], remote.hasLook[n], remote.yaw[n]] = [2000 + n, reg.index.get("core:survivor")!, 1, 0, 1, 0];
    [remote.x[n], remote.z[n]] = [cam.x + Math.sin(Math.PI + a) * 6, cam.z + Math.cos(Math.PI + a) * 6];
    remote.y[n] = hf.heightAt(remote.x[n]!, remote.z[n]!);
    remote.look.set(look, n * LOOK_BYTES);
    remote.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    dress.armor?.forEach((piece, k) => void (remote.gear[n * GEAR_COUNT + GEAR_WORN + k] = piece ? reg.index.get(piece)! : 0));
    remote.wardrobe.fill(0, n * WORN_LENGTH, (n + 1) * WORN_LENGTH);
    let any = false;
    SLOTS.forEach((slot, k) => {
      const item = dress[slot] ? reg.index.get(dress[slot]!)! : 0;
      if (item === 0) return;
      any = true;
      remote.wardrobe.set([item, dress.edition ?? 0, dress.dye ?? 0], n * WORN_LENGTH + k * WORN_FIELDS);
    });
    remote.hasWardrobe[n] = hook && any ? 1 : 0;
  }
  return view;
}

function settled(view: ProvingView): FramePacket {
  let p = view.scene.build(view.cam, view.remote);
  for (let f = 0; f < 6; f++) p = view.scene.build(view.cam, view.remote);
  return p;
}

interface Draw {
  mesh: string;
  lod: number;
  instances: number;
  first: number;
  triangles: number;
}

/**
 * The bodies' draws, the garments' apart, and the rest as a sorted list of each draw's mesh, level, flags, instances and
 * run of indices: the order draws are made in is the renderer's to choose.
 */
function drawsOf(view: ProvingView, p: FramePacket): { garments: Draw[]; body: Draw[]; hash: string; triangles: number } {
  const ids = view.scene.assets.manifest.meshes.map((m) => m.id);
  const garments: Draw[] = [], body: Draw[] = [], rows: string[] = [];
  let triangles = 0;
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== TRANSIENT_BUFFER || (p.drawFlags[d]! & DRAW_SKINNED) === 0) continue;
    const ranged = (p.drawFlags[d]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0;
    const mesh = ids[p.drawMesh[d]!]!, tris = (ranged ? p.drawIndexCount[d]! / 3 : view.scene.assets.table.tris[p.drawMesh[d]!]![p.drawLod[d]!]!) * p.drawInstances[d]!;
    const draw = { mesh, lod: p.drawLod[d]!, instances: p.drawInstances[d]!, first: p.drawFirst[d]!, triangles: tris };
    if (mesh.includes("/garment/")) {
      garments.push(draw);
      continue;
    }
    body.push(draw);
    rows.push([mesh, p.drawLod[d], p.drawFlags[d], p.drawInstances[d], ranged ? p.drawFirstIndex[d] : -1, ranged ? p.drawIndexCount[d] : -1].join(" "));
    triangles += tris;
  }
  return { garments, body, hash: rows.sort().join("\n"), triangles };
}

/** The bodies alone, `hide` hidden by hand on each. */
function bare(count: number, hide: number, armor?: (string | null)[]): ReturnType<typeof drawsOf> {
  const view = crowd({ armor }, count);
  view.scene.characters.skinHidden = () => hide;
  return drawsOf(view, settled(view));
}

const covers = (id: string): number => gameOf().reg.garmentZones[gameOf().reg.index.get(id)!]!;

test("a worn tee is drawn on each body and hides only what it covers", () => {
  const view = crowd({ top: "core:plain_tee" });
  const d = drawsOf(view, settled(view));
  expect(d.garments.map((g) => g.mesh).sort()).toEqual(["core:human_f/garment/tee", "core:human_m/garment/tee"]);
  expect(d.garments.every((g) => g.instances === 1)).toBe(true);
  const hidden = bare(2, covers("core:plain_tee"));
  expect([d.hash, d.triangles]).toEqual([hidden.hash, hidden.triangles]);
  expect(d.triangles).toBeLessThan(bare(2, 0).triangles);
});

test("a whole outfit draws a cut a garment, at the level of the body slot it lies on", () => {
  const view = crowd({ top: "core:plain_tee", bottom: "core:plain_trousers", shoes: "core:trainers" }, 1);
  const p = settled(view);
  const d = drawsOf(view, p);
  expect(d.garments.map((g) => g.mesh).sort()).toEqual(["core:human_m/garment/jeans", "core:human_m/garment/tee", "core:human_m/garment/trainers"]);
  // The trainers hide both feet, so the feet are drawn at the legs' level, into the shadows alone.
  const levelOf = (part: string): number => d.body.find((b) => b.mesh === `core:human_m/${part}`)!.lod;
  for (const [cut, part] of [["tee", "torso"], ["jeans", "legs"], ["trainers", "legs"]]) expect(d.garments.find((g) => g.mesh.endsWith(cut!))!.lod).toBe(levelOf(part!));
  const hidden = bare(1, covers("core:plain_tee") | covers("core:plain_trousers") | covers("core:trainers"));
  expect(d.hash).toBe(hidden.hash);
});

test("a body with no wardrobe draws as it did before garments", () => {
  const view = crowd({ top: "core:plain_tee" }, 2, false);
  const p = settled(view);
  const d = drawsOf(view, p);
  expect(d.garments).toEqual([]);
  const plain = crowd({}, 2);
  plain.scene.characters.wardrobe = null;
  const q = settled(plain);
  expect(d.hash).toBe(drawsOf(plain, q).hash);
  expect(hashBytes(p.transient.subarray(0, p.transientCount * INSTANCE_BYTES))).toBe(hashBytes(q.transient.subarray(0, q.transientCount * INSTANCE_BYTES)));
});

test("a garment whose cut is not made on the body hides nothing", () => {
  const view = crowd({ top: "test:uncooked_tee" });
  const d = drawsOf(view, settled(view));
  expect(d.garments).toEqual([]);
  expect(d.hash).toBe(bare(2, 0).hash);
});

test("a cut with no level here yet hides nothing until one comes", () => {
  const view = crowd({ top: "core:plain_tee" });
  const assets = view.scene.assets, level = assets.level.bind(assets);
  const ids = assets.manifest.meshes.map((m) => m.id);
  let held = false;
  assets.level = (mesh, wanted) => (!held && ids[mesh]!.includes("/garment/") ? -1 : level(mesh, wanted));
  const waiting = drawsOf(view, settled(view));
  expect(waiting.garments).toEqual([]);
  expect(waiting.hash).toBe(bare(2, 0).hash);
  held = true;
  expect(drawsOf(view, settled(view)).hash).toBe(bare(2, covers("core:plain_tee")).hash);
});

test("armour on a garment's body slot is drawn in its place, and the skin under it as armour leaves it", () => {
  const armor = [null, "core:cloth_shirt", null, null, null];
  const view = crowd({ top: "core:plain_tee", bottom: "core:plain_trousers", armor });
  const d = drawsOf(view, settled(view));
  // The shirt wins the torso; the jeans are still drawn on the legs.
  expect(d.garments.map((g) => g.mesh).sort()).toEqual(["core:human_f/garment/jeans", "core:human_m/garment/jeans"]);
  expect(d.hash).toBe(bare(2, covers("core:plain_trousers"), armor).hash);
});

test("a tee under a hoodie that covers all it does is left out", () => {
  const view = crowd({ top: "core:plain_tee", outer: "core:hoodie" }, 1);
  expect(drawsOf(view, settled(view)).garments.map((g) => g.mesh)).toEqual(["core:human_m/garment/hoodie"]);
  const apron = crowd({ top: "core:plain_tee", outer: "core:apron" }, 1);
  expect(drawsOf(apron, settled(apron)).garments.map((g) => g.mesh).sort()).toEqual(["core:human_m/garment/apron", "core:human_m/garment/tee"]);
});

test("200 wearers of one cut are the draws of one", () => {
  const one = crowd({ top: "core:plain_tee", bottom: "core:plain_trousers" }, 1);
  const many = crowd({ top: "core:plain_tee", bottom: "core:plain_trousers" }, 200);
  // Every body a man, so each cut is one mesh.
  for (let n = 0; n < 200; n++) many.remote.look[n * LOOK_BYTES + LOOK_SEX] = 0;
  const a = drawsOf(one, settled(one)), b = drawsOf(many, settled(many));
  // One draw for each cut at each level the crowd is drawn at, as for one body at one level.
  expect(a.garments.length).toBe(2);
  const keys = b.garments.map((g) => `${g.mesh} ${g.lod}`);
  expect(new Set(keys).size).toBe(keys.length);
  for (const cut of ["tee", "jeans"]) expect(b.garments.filter((g) => g.mesh.endsWith(cut)).reduce((n, g) => n + g.instances, 0)).toBe(200);
});

/** The palette bytes of each garment instance drawn. */
function garmentBytes(view: ProvingView): number[][] {
  const p = settled(view);
  return drawsOf(view, p).garments.flatMap((g) => Array.from({ length: g.instances }, (_, k) => [...p.transient.subarray((g.first + k) * INSTANCE_BYTES + 14, (g.first + k) * INSTANCE_BYTES + 20)]));
}

test("a garment's regions take its slot's dye over its edition's colours over its own", () => {
  const own = gameOf().reg.defs[gameOf().reg.index.get("core:plain_tee")!]!.color;
  const plain = garmentBytes(crowd({ top: "core:plain_tee" }, 1))[0]!;
  expect([plain[1], plain[2], plain[4], plain[5]]).toEqual([own, 0, own, own]);
  const edition = crowd({ top: "core:plain_tee", edition: 7 }, 1);
  edition.scene.characters.edition = (id, out) => id === 7 && (out.set([30, 0, 32]), true);
  const e = garmentBytes(edition)[0]!;
  expect([e[1], e[4], e[5]]).toEqual([30, own, 32]);
  const dyed = crowd({ top: "core:plain_tee", edition: 7, dye: 50 | (51 << 16) }, 1);
  dyed.scene.characters.edition = (id, out) => id === 7 && (out.set([30, 31, 32]), true);
  dyed.scene.characters.printByte = (id) => (id === 7 ? 9 : 0);
  const d = garmentBytes(dyed)[0]!;
  expect([d[1], d[2], d[4], d[5]]).toEqual([50, 9, 31, 51]);
  // An edition this client does not know is drawn plain.
  const unknown = crowd({ top: "core:plain_tee", edition: 8 }, 1);
  unknown.scene.characters.edition = (id, out) => id === 7 && (out.set([30, 31, 32]), true);
  expect(garmentBytes(unknown)[0]).toEqual(plain);
});

test("armour takes its slot's dye where its pieces have colour regions", () => {
  const armor = [null, "core:cloth_shirt", null, null, null];
  const view = crowd({ armor }, 1);
  const shirt = (v: ProvingView): number[] => {
    const p = settled(v), ids = v.scene.assets.manifest.meshes.map((m) => m.id);
    for (let d = 0; d < p.drawCount; d++) if (p.drawBuffer[d] === TRANSIENT_BUFFER && ids[p.drawMesh[d]!]!.includes("armor/cloth/torso")) return [...p.transient.subarray(p.drawFirst[d]! * INSTANCE_BYTES + 14, p.drawFirst[d]! * INSTANCE_BYTES + 20)];
    return [];
  };
  const before = shirt(view);
  view.scene.characters.armorDye = (_id, slot) => (slot === 1 ? 60 | (61 << 8) : 0);
  const after = shirt(view);
  expect([after[1], after[4], after[5]]).toEqual([60, 61, before[5]]);
  expect([after[0], after[2], after[3]]).toEqual([before[0], before[2], before[3]]);
});
