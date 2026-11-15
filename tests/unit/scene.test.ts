// The scene drawing with materials: what it asks of the asset library, what it puts in a frame packet, and what the
// software rasterizer makes of the packet.
import { expect, test } from "bun:test";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import type { AssetRequest } from "../../client/core/assets/port.ts";
import { DRAW_BLEND, DRAW_CUTOUT, DRAW_NEAR, DRAW_ONE_BONE, DRAW_PLAIN, DRAW_SIZED, DRAW_SKINNED, DRAW_TEXTURED, DRAW_TWO_SIDED, SIZE_REGION, TRANSIENT_BUFFER, stepOf, type FramePacket } from "../../client/core/render/packet.ts";
import type { Cutouts, OwnBody } from "../../client/core/render/scene.ts";
import { Falling } from "../../client/core/rubble.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { hashBytes } from "../../shared/hash.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { PICK_ENTITY, PICK_STRUCTURE } from "../../tools/snap/raster.ts";
import { SIZE_UNITS, nodeForms, scatterNodes } from "../../shared/world/nodes.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { NodeChanges, type FarNodeSource } from "../../client/core/render/farnodes.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { buildPack, type SourceLod } from "../../tools/pack/write.ts";
import { CLUB, H, PANEL, POST, SHARD, TUBE_SADDLE, W, sceneRegistry, sceneSet, sceneWorld } from "../fixtures/sceneworld.ts";
import { TUBE, TUBE_RIG, tubeClips, tubeMesh } from "../fixtures/textured.ts";

type World = ReturnType<typeof sceneWorld>;
const BODY = DRAW_SKINNED | DRAW_PLAIN;
/** Yaw, in a structure's units, of a piece that faces the camera. */
const FACING = 32768;

/** What a frame draws of a mesh, a row a draw: its level, flags and instances, and for a draw with a material that and its run of indices. */
function drawn(w: World, p: FramePacket, id: string): number[][] {
  return w.draws(p, id).map((d) => [p.drawLod[d]!, p.drawFlags[d]!, p.drawInstances[d]!, ...((p.drawFlags[d]! & DRAW_TEXTURED) === 0 ? [] : [p.drawMaterial[d]!, p.drawFirstIndex[d]!, p.drawIndexCount[d]!])]);
}

const textured = (p: FramePacket, d: number): boolean => (p.drawFlags[d]! & DRAW_TEXTURED) !== 0;
const material = (w: World, id: string): number => w.manifest.materials!.findIndex((m) => m.id === id);

/** Everything a renderer reads of a frame but its texture work, hashed onto `h`. */
function hashPacket(p: FramePacket, h: number): number {
  const add = (a: ArrayBufferView, n = a.byteLength): void => void (h = hashBytes(new Uint8Array(a.buffer, a.byteOffset, n), h));
  const count = (...n: number[]): void => add(Float64Array.from(n));
  for (const a of [p.viewProj, p.nearViewProj, p.sky, p.sun]) add(a);
  count(p.camX, p.camY, p.camZ, p.light, p.fogStart, p.fogEnd, p.skipped, p.dropped, p.triangles, p.drawCount, p.tileCount, p.transientCount, p.boneCount);
  for (const a of [p.drawMesh, p.drawLod, p.drawSlot, p.drawBuffer, p.drawFirst, p.drawInstances, p.drawFlags]) add(a, p.drawCount * a.BYTES_PER_ELEMENT);
  add(p.drawOffset, p.drawCount * 12);
  add(p.tiles, p.tileCount * 16);
  add(p.tileOrigin, p.tileCount * 8);
  add(p.transient, p.transientCount * INSTANCE_BYTES);
  add(p.transientIds, p.transientCount * 4);
  add(p.bones, p.boneCount * 48);
  for (const u of p.uploads) {
    count(u.buffer);
    add(u.data);
    add(u.slots);
  }
  for (const u of p.assetUploads) {
    count(u.slot, u.mesh, u.level, u.indexCount, u.indexBytes, u.of ?? -1, u.skinAt ?? -1);
    add(u.data);
  }
  count(...p.drops, -1, ...p.assetDrops);
  return h;
}

test("a scene streamed over a slow, lossy link draws with no material the card lacks, and ends pixel-equal to the scene with everything on the card", () => {
  // A creature and a survivor with a club in its hand, both seen from the side, the tube standing on no bones and
  // again as a loose thing, three panels, a fourth falling, a fifth about to be built, a shard of one lying tilted, and
  // the viewer's own body, looking out of its head with a club of its own.
  const fill = (w: World): void => {
    w.place(TUBE, 32, 23.2, { colors: [8, 7, 14, 6], yaw: Math.PI / 2 });
    w.place("core:survivor", 30.6, 23, { held: CLUB, yaw: Math.PI / 2 });
    w.place(POST, 33.4, 24, { colors: [9, 9, 9, 9] });
    w.remote.anim[w.place(SHARD, 36, 24.5, { y: 2.2, yaw: 0 })] = 12 << 12;
    w.scene.own = { kind: w.kind("core:survivor"), x: 32, y: -0.42, z: 20, yaw: 0, state: new AnimState(), tick: 0, firstPerson: true, colors: new Uint8Array(6), look: null, gear: Uint16Array.of(w.kind(CLUB), 0, 0, 0, 0, 0), id: 7 };
    for (let i = 0; i < 3; i++) w.structs.add(w.kind(PANEL), 30 + i * 2, 0, 26, FACING, 0, 1);
    w.scene.things = [{ mesh: w.mesh(TUBE), x: 38, y: 0, z: 29, level: -1 }];
    const falling = (w.scene.falling = new Falling(w.reg.halfY, () => 0));
    falling.count = 1;
    [falling.kind[0], falling.x[0], falling.y[0], falling.z[0], falling.yaw[0]] = [w.kind(PANEL), 27.5, 1.5, 25.5, FACING];
    Object.assign(w.scene.ghost, { kind: w.kind(PANEL), x: 28.5, y: 0, z: 24.5, yaw: FACING, color: 9 });
  };
  const whole = sceneWorld();
  fill(whole);
  for (let f = 0; f < 6; f++) whole.frame();
  const slow = sceneWorld({ latencyMs: 120, bytesPerSecond: 60e3, loss: 0.25, seed: 2 });
  fill(slow);

  // The first frame has the boot pack alone. Everything is there, flat, the tube at the finer of the levels in the pack.
  let p = slow.frame();
  expect([p.drawCount, p.skipped, p.texUploads.length]).toEqual([18, 0, 0]);
  for (let d = 0; d < p.drawCount; d++) expect(textured(p, d)).toBe(false);
  expect(drawn(slow, p, TUBE)).toEqual([[1, 0, 1], [1, BODY, 1], [1, 0, 1]]);
  const before = slow.raster.color.slice();
  expect(before).not.toEqual(whole.raster.color);

  // `frame` throws at a draw with a material whose surface, base colour or masks the card lacks, and at a level drawn
  // with some of its sections. So does the rasterizer. In any frame a level of a mesh is drawn flat wherever it is
  // drawn, or with its materials wherever it is.
  const meshes = [TUBE, CLUB, PANEL];
  const [first, last] = [meshes.map(() => 0), meshes.map(() => 0)];
  for (let f = 1; f < 70; f++) {
    p = slow.frame();
    meshes.forEach((id, k) => {
      const opaque = slow.draws(p, id).filter((d) => (p.drawFlags[d]! & DRAW_BLEND) === 0);
      const flat = opaque.filter((d) => !textured(p, d));
      for (const d of flat) expect(opaque.some((other) => textured(p, other) && p.drawLod[other] === p.drawLod[d])).toBe(false);
      if (flat.length > 0) last[k] = f + 1;
      else first[k] ||= f;
    });
  }
  // Each mesh turned to its materials once, some seconds in, and stayed. Requests were lost on the way.
  expect(first).toEqual(last);
  expect(first.every((f) => f > 5 && f < 70)).toBe(true);
  const { stats, flying } = slow.scene.assets.residency;
  expect([stats.failed > 1, stats.dead, flying, slow.card.textures.size]).toEqual([true, 0, 0, 6]);

  // The last frame: a draw for each section, with its material, its run of indices and what the material's flags ask.
  const [hide, horn, wood, plank, lattice] = ["test:tube/hide", "test:tube/horn", "test:club/wood", PANEL, `${PANEL}/lattice`].map((id) => material(slow, id));
  // The standing panels, the shard, which is on a bone of its own, and the falling panel are drawn with their
  // materials, their cut-out lattices after every opaque draw. The one about to be built is see-through, and flat.
  const planks = (pieces: number, flags = 0): number[] => [0, flags | DRAW_TEXTURED, pieces, plank, 0, 3];
  const lattices = (pieces: number, flags = 0): number[] => [0, flags | DRAW_TEXTURED | DRAW_TWO_SIDED | DRAW_CUTOUT, pieces, lattice, 3, 3];
  expect(drawn(slow, p, PANEL)).toEqual([planks(3), planks(1, BODY), planks(1), lattices(3), lattices(1, BODY), lattices(1), [0, DRAW_BLEND, 1]]);
  // The post is the tube on no bones and the creature is the tube on its own, both now at its finest level. The loose
  // thing is far enough off for the second.
  const tube = (flags: number, level = 0): number[][] => [[level, flags | DRAW_TEXTURED, 1, hide, 0, 1152 >> (level * 2)], [level, flags | DRAW_TEXTURED | DRAW_TWO_SIDED, 1, horn, 1152 >> (level * 2), 384 >> (level * 2)]];
  expect(drawn(slow, p, TUBE)).toEqual([...tube(0), ...tube(BODY), ...tube(0, 1)]);
  // What is held hangs on the hand's bone as it did, and the viewer's own is drawn last, over everything. The bodies
  // they hang on have no materials, and are drawn flat.
  expect(drawn(slow, p, CLUB)).toEqual([[0, BODY | DRAW_TEXTURED, 1, wood, 0, 36], [0, BODY | DRAW_NEAR | DRAW_TEXTURED, 1, wood, 0, 36]]);
  expect(drawn(slow, p, "core:mannequin/torso")).toEqual([[0, BODY, 1], [0, BODY | DRAW_NEAR, 1]]);
  expect(textured(p, p.drawCount - 1)).toBe(true);
  expect(slow.raster.color).toEqual(whole.raster.color);
  expect(slow.raster.color).not.toEqual(before);
  // The creature, the survivor and the post are in the picture, and so are what has no id (the shard, the loose
  // thing and the falling panel) and the standing panels.
  const seen = (kind: number, id: number): number => slow.raster.pickKind.reduce((n, k, i) => n + (k === kind && (id < 0 || slow.raster.pickId[i] === id) ? 1 : 0), 0);
  expect([seen(PICK_ENTITY, 100) > 100, seen(PICK_ENTITY, 101) > 100, seen(PICK_ENTITY, 102) > 100, seen(PICK_ENTITY, 0) > 600, seen(PICK_STRUCTURE, -1) > 600]).toEqual([true, true, true, true, true]);
});

test("a step's cut-out draws come after all its opaque ones; as they were made, before them all and none are a switch away, and the first three draw the same picture", () => {
  // Rows of panels, the nearer hiding the farther, a creature among them and one past the split. Panels are structures,
  // made before the bodies, so as made a panel's lattice comes before the creatures.
  const w = sceneWorld({}, { split: 30 });
  for (let i = 0; i < 12; i++) w.structs.add(w.kind(PANEL), 27 + (i % 4) * 3, 0, 25 + Math.floor(i / 4) * 4, FACING, 0, 1);
  w.place(TUBE, 33, 27, { yaw: Math.PI / 2 });
  w.place(TUBE, 32, 60, { yaw: Math.PI / 2 });
  for (let f = 0; f < 8; f++) w.frame();
  const shot = (cutouts: Cutouts) => {
    w.scene.cutouts = cutouts;
    const p = w.frame();
    const draws = Array.from({ length: p.drawCount }, (_, d) => ({ step: stepOf(p, d), cut: (p.drawFlags[d]! & DRAW_CUTOUT) !== 0, what: [p.drawSlot[d], p.drawBuffer[d], p.drawFirst[d], p.drawFlags[d], p.drawMaterial[d], p.drawPass[d]].join() }));
    return { draws, picture: w.raster.color.slice() };
  };
  const [made, last, first] = [shot("made"), shot("last"), shot("first")];
  /** Whether some draw of a step that is cut out, or not, comes before one of the same step that is not, or is. */
  const before = (draws: typeof made.draws, cut: boolean): boolean => draws.some((a, i) => a.cut === cut && draws.slice(i + 1).some((b) => b.step === a.step && b.cut !== cut));
  expect([made.draws.some((d) => d.cut), before(made.draws, true), before(made.draws, false)]).toEqual([true, true, true]);
  expect([before(last.draws, true), before(first.draws, false)]).toEqual([false, false]);
  for (const o of [last, first]) {
    expect(o.draws.map((d) => d.step)).toEqual(made.draws.map((d) => d.step).sort((a, b) => a - b));
    expect(o.draws.map((d) => d.what).sort()).toEqual(made.draws.map((d) => d.what).sort());
    expect(o.picture).toEqual(made.picture);
  }
  // Left out, the cut-outs are the only draws missing.
  const none = shot("none");
  expect(none.draws.map((d) => d.what).sort()).toEqual(made.draws.filter((d) => !d.cut).map((d) => d.what).sort());
  expect(none.picture).not.toEqual(made.picture);
});

test("a body drawn with its materials and the same body drawn flat agree in mean colour, as near as the palette and the two ways of lighting allow", () => {
  /** The mean colour of the pixels a body covers, seen from its side three metres off, bent as it idles. */
  const mean = (colors: readonly number[], tier: Partial<Tier>, flat: boolean): number[] => {
    const w = sceneWorld({}, tier);
    w.place(TUBE, 32, 23, { colors, yaw: Math.PI / 2 });
    let p = w.frame();
    for (let f = 0; f < 4; f++) p = w.frame();
    expect([p.drawLod[0], textured(p, 0)]).toEqual([0, !flat]);
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < W * H; i++) {
      if (w.raster.pickKind[i] !== PICK_ENTITY) continue;
      for (let c = 0; c < 3; c++) sum[c]! += w.raster.color[i * 4 + c]!;
      n++;
    }
    expect(n).toBeGreaterThan(400);
    return sum.map((s) => s / n);
  };
  // The flat colours come no nearer the pictures than 12 of 255 a channel with four dyes and 17 with one (D154), and
  // the two ways of lighting differ by up to 7 off mid grey (D155). On the lit tiers, where LIT lights the flat body as
  // SURFACE lights a fully rough one, measured here: 13 and 10 under the graded noon sky (15 and 16 when the flat body
  // was drawn as low poly).
  for (const [colors, within] of [[[8, 7, 14, 6], 12 + 7], [[9, 9, 9, 9], 17 + 7]] as const) {
    const [drawn, flat] = [mean(colors, {}, false), mean(colors, { texture: 0 }, true)];
    for (let c = 0; c < 3; c++) expect(Math.abs(drawn[c]! - flat[c]!)).toBeLessThan(within);
  }
});

test("a wall of one piece whose material tiles is the same two draws at 10 pieces and at 1,000", () => {
  const wall = (pieces: number, draw: boolean): { w: World; p: FramePacket } => {
    const w = sceneWorld();
    // Rows of 25, one behind another, all in one chunk. The camera stands before the first ten.
    w.cam.x = 17;
    for (let i = 0; i < pieces; i++) w.structs.add(w.kind(PANEL), 8 + (i % 25) * 2, 0, 30 + Math.floor(i / 25) * 0.8, FACING, 0, 1);
    let uploads = 0;
    let p = w.frame(100, draw);
    for (let f = 0; f < 5; f++) uploads += (p = w.frame(100, draw)).uploads.length;
    // The instances went to the card once, in the first frame, and not again when the piece turned to its materials.
    expect(uploads).toBe(0);
    return { w, p };
  };
  const [few, many] = [wall(10, true), wall(1000, false)];
  const [plank, lattice] = [material(few.w, PANEL), material(few.w, `${PANEL}/lattice`)];
  for (const [{ w, p }, pieces] of [[few, 10], [many, 1000]] as const) {
    expect(drawn(w, p, PANEL)).toEqual([[0, DRAW_TEXTURED, pieces, plank, 0, 3], [0, DRAW_TEXTURED | DRAW_TWO_SIDED | DRAW_CUTOUT, pieces, lattice, 3, 3]]);
    expect([p.drawCount, p.dropped]).toEqual([2, 0]);
  }
  expect(many.p.triangles - few.p.triangles).toBe(990 * 2);
  // The picture is laid a metre wide on a piece two metres wide. The mesh says so, the packet need not, and the row is drawn.
  expect(few.w.manifest.meshes[few.w.mesh(PANEL)]!.uv).toEqual([0, 0, 2, 2]);
  expect(few.w.raster.pickKind.filter((kind) => kind === PICK_STRUCTURE).length).toBeGreaterThan(600);
});

test("a body that steps back to a level whose surface has not come keeps its materials: the finer level is drawn until it has", () => {
  const w = sceneWorld();
  // The surface of the tube's second level is asked for and does not come until it is let through.
  const surface = w.manifest.meshes.reduce((sum, m) => sum + m.levels.length, 0) + w.scene.assets.residency.slot(w.mesh(TUBE), 1);
  const held: AssetRequest[] = [];
  const ask = w.port.request.bind(w.port);
  w.port.request = (r) => (r.slot === surface ? void held.push(r) : ask(r));
  const body = w.place(TUBE, 32, 23, { colors: [8, 7, 14, 6] });
  let p = w.frame();
  for (let f = 0; f < 5; f++) p = w.frame();
  const [hide, horn] = [material(w, "test:tube/hide"), material(w, "test:tube/horn")];
  const flags = BODY | DRAW_TEXTURED;
  const finest = [[0, flags, 1, hide, 0, 1152], [0, flags | DRAW_TWO_SIDED, 1, horn, 1152, 384]];
  expect(drawn(w, p, TUBE)).toEqual(finest);
  // Eight metres off the second level is wanted. The card has it, flat, from the boot pack.
  w.remote.z[body] = 28;
  for (let f = 0; f < 5; f++) expect(drawn(w, w.frame(), TUBE)).toEqual(finest);
  expect(held.length).toBe(1);
  w.port.request = ask;
  ask(held[0]!);
  for (let f = 0; f < 3; f++) p = w.frame();
  expect(drawn(w, p, TUBE)).toEqual([[1, flags, 1, hide, 0, 288], [1, flags | DRAW_TWO_SIDED, 1, horn, 288, 96]]);
});

test("a body the frame has no bones to pose is drawn rigid on one bone, with its materials", () => {
  // Six bodies of two bones each, and bones for eight: the nearest two are posed and the rest stand as they were made.
  const at = [[32, 22.5], [31, 23], [33, 23.4], [30, 23.8], [34, 24.2], [32, 24.6]] as const;
  const w = sceneWorld({}, { bones: 8 });
  at.forEach(([x, z]) => w.place(TUBE, x, z, { colors: [8, 7, 14, 6] }));
  let p = w.frame();
  for (let f = 0; f < 4; f++) p = w.frame();
  const [hide, horn] = [material(w, "test:tube/hide"), material(w, "test:tube/horn")];
  const flags = BODY | DRAW_TEXTURED;
  expect(drawn(w, p, TUBE)).toEqual([
    [0, flags, 2, hide, 0, 1152], [0, flags | DRAW_TWO_SIDED, 2, horn, 1152, 384],
    [0, flags | DRAW_ONE_BONE, 4, hide, 0, 1152], [0, flags | DRAW_ONE_BONE | DRAW_TWO_SIDED, 4, horn, 1152, 384],
  ]);
  expect([p.boneCount, w.scene.characters.posed, p.dropped]).toEqual([8, 2, 0]);
  const bodies = w.raster.color.slice();
  const ids = w.raster.pickId.slice();

  // The four are drawn as the tube standing on no bones is, where they stand.
  const posts = sceneWorld();
  at.forEach(([x, z], k) => posts.place(k < 2 ? TUBE : POST, x, z, { colors: [8, 7, 14, 6] }));
  for (let f = 0; f < 5; f++) posts.frame();
  let [same, other] = [0, 0];
  for (let i = 0; i < W * H; i++) {
    if (ids[i]! < 102 && posts.raster.pickId[i]! < 102) continue;
    if (ids[i] === posts.raster.pickId[i] && [0, 1, 2].every((c) => Math.abs(bodies[i * 4 + c]! - posts.raster.color[i * 4 + c]!) <= 1)) same++;
    else other++;
  }
  expect([same > 600, other]).toEqual([true, 0]);
});

test("a thing's textures are wanted as wide as its size and its distance show them", () => {
  // Pictures 256 pixels across, on a view 720 pixels high. A grown body 8 m off shows its material 112 pixels wide,
  // and wants the 128. Newly born it is a quarter the size, and the 64 will do. The post beside it is the tube at its
  // modelled size, and what is in a hand is as far off as its body.
  const top = (place: (w: World) => void): number[] => {
    const w = sceneWorld({}, {}, sceneSet(256));
    w.scene.viewHeight = 720;
    place(w);
    for (let f = 0; f < 12; f++) w.frame(100, false);
    expect(w.scene.assets.residency.flying).toBe(0);
    return ["test:tube/base", "test:tube/mask", "test:tube/normal", `${PANEL}/base`].map((id) => w.card.textures.get(w.manifest.textures!.findIndex((t) => t.id === id))?.top ?? 0);
  };
  const young = (w: World, n: number): void => void ([w.remote.span[n], w.remote.grown[n]] = [1000, 2000]);
  expect(top((w) => w.place(TUBE, 32, 28))).toEqual([128, 128, 128, 0]);
  expect(top((w) => young(w, w.place(TUBE, 32, 28)))).toEqual([64, 64, 64, 0]);
  expect(top((w) => w.place(POST, 32, 28))).toEqual([128, 128, 128, 0]);
  expect(top((w) => w.place(POST, 32, 23.5))).toEqual([256, 256, 256, 0]);
  // A club's picture is 0.6 m of it, so a survivor 3 m off shows it 95 pixels wide. It was authored at 64.
  expect(top((w) => w.place("core:survivor", 32, 23, { held: CLUB }))).toEqual([0, 0, 0, 64]);
});

/**
 * Three hundred frames of one of everything the scene draws, on low poly, with `saddled` the nearest and the farthest
 * tube wearing the tube's saddle: their hash, what they drew and uploaded, and what the network was asked for.
 */
function lowPoly(saddled: boolean) {
  // The chunk ahead and to the right is past the near node field, and holds trees and palms placed from the map.
  const wood = (hf: Heightfield, reg: Registry): FarNodeSource => {
    const dims = hf.dims;
    const kinds = ["core:tree", "core:palm"].map((id) => reg.index.get(id)!);
    const nodes = scatterNodes(dims, hf, 7, 24, nodeForms(reg), (x, z) => (x >= CHUNK_SIZE && z >= CHUNK_SIZE ? kinds : null));
    return { nodes, held: (chunk) => chunk !== 3, gone: () => undefined, changes: new NodeChanges(dims) };
  };
  const w = sceneWorld({ latencyMs: 40, bytesPerSecond: 150e3, loss: 0.7, seed: 1 }, tierOf("lowpoly"), undefined, wood);
  const { scene, cam, remote, structs, nodes, kind } = w;
  w.hf.seaLevel = -0.5;
  // One of everything the scene draws: pieces in two chunks, nodes near and far, bodies of both kinds, one young, one
  // riding, things in hands, a rigid creature, an arrow where it landed, the viewer's own body, beams, a ghost, falling
  // pieces and loose things.
  for (let i = 0; i < 10; i++) structs.add(kind(PANEL), 22 + i * 2, 0, 34, 0, 0, 1);
  for (let i = 0; i < 6; i++) structs.add(kind(i % 2 ? "core:wall" : "core:foundation"), 58 + i * 3, 1.5, 40, 16384 * i, 0, 1);
  // Nodes stand on their base, each at a size of its kind and turned.
  for (let i = 0; i < 4; i++) nodes.add(w.form(i % 2 ? "core:tree" : "core:rock", i * 5), 20 + i * 9, 0, 46, i * 9000, 0, 1);
  for (let i = 0; i < 8; i++) w.place(TUBE, 24 + i * 2.5, 23 + i * 5, { colors: [8, 7, 14, 6], yaw: i, saddle: saddled && (i === 0 || i === 7) ? TUBE_SADDLE : undefined });
  [remote.span[3], remote.grown[3]] = [1000, 800];
  w.place("core:survivor", 30, 24, { held: CLUB });
  const looked = w.place("core:survivor", 33, 27, { held: "core:hatchet", colors: [3, 4, 5] });
  remote.hasLook[looked] = 1;
  remote.seat[w.place("core:survivor", 36, 30)] = remote.id[0]! + 1;
  w.place("core:grazer", 28, 31);
  w.place(POST, 34, 29);
  remote.anim[w.place("core:arrow_stuck", 31, 22)] = 9 << 12;
  const own: OwnBody = { kind: kind("core:survivor"), x: 32, y: 0, z: 19, yaw: 0, state: new AnimState(), tick: 0, firstPerson: false, colors: new Uint8Array(6), look: null, gear: Uint16Array.of(kind(CLUB), 0, 0, 0, 0, 0), id: 7 };
  scene.own = own;
  scene.beams.push(40, 0, 50, 70, 0, 60);
  Object.assign(scene.ghost, { kind: kind(PANEL), x: 31, y: 0, z: 25, color: 9 });
  const falling = (scene.falling = new Falling(w.reg.halfY, () => 0));
  falling.count = 2;
  [falling.kind[0], falling.x[0], falling.y[0], falling.z[0], falling.kind[1], falling.x[1], falling.y[1], falling.z[1]] = [kind(PANEL), 29, 2, 28, kind("core:wall"), 35, 3, 29];
  scene.things = [{ mesh: w.mesh(TUBE), x: 26, y: 0, z: 36, level: -1 }, { mesh: w.mesh("core:crate"), x: 38, y: 0.5, z: 33, level: -1 }];

  let hash = 0;
  let [draws, rigid, uploads] = [0, 0, 0];
  const worn: number[] = [];
  for (let f = 0; f < 300; f++) {
    cam.yaw = Math.sin(f / 40) * 0.7;
    cam.z = 20 + f / 30;
    cam.pitch = -0.1 + Math.cos(f / 25) * 0.1;
    remote.tick = own.tick = f / 2;
    scene.hour = 6 + f / 30;
    own.firstPerson = f >= 150;
    // A piece is added, and later the frame has bones for few of the bodies.
    if (f === 100) structs.add(kind(PANEL), 42, 0, 34, 0, 0, 1);
    if (f === 200) scene.assets.tier = { ...tierOf("lowpoly"), bones: 40 };
    const p = w.frame(1000 / 60, false);
    hash = hashPacket(p, hash);
    draws += p.drawCount;
    uploads += p.assetUploads.length;
    for (const d of w.draws(p, `${TUBE_SADDLE}/worn`)) worn[p.drawLod[d]!] = (worn[p.drawLod[d]!] ?? 0) + p.drawInstances[d]!;
    for (let d = 0; d < p.drawCount; d++) {
      expect(textured(p, d)).toBe(false);
      if ((p.drawFlags[d]! & DRAW_ONE_BONE) !== 0) rigid++;
    }
    expect([p.texUploads.length, p.texDrops.length, p.assetUploads.filter((u) => u.of !== undefined).length, p.skipped, p.dropped]).toEqual([0, 0, 0, 0, 0]);
  }
  return { hash, draws, rigid, uploads, worn, log: w.port.log, post: scene.assets.residency.slot(w.mesh(TUBE), 0), texLedger: scene.assets.residency.texLedger };
}

test("low poly asks for no surface and no texture, draws nothing with a material, and its packets are what they were", () => {
  const { hash, draws, rigid, uploads, log, post, texLedger, worn } = lowPoly(false);
  // All it asked the network for was the finest level of the tube, for the post, no more urgently than it ever did,
  // and again when the request was lost.
  expect(log).toEqual([`17 ask ${post} 0.0000`, `1167 ask ${post} 0.0000`, `2733 ask ${post} 0.0000`]);
  // The far wood is about a draw a frame, every mesh of a tile in one, and the pulled draws' three levels are uploads in
  // place of the palm's last level.
  expect([draws, rigid, uploads, texLedger, worn]).toEqual([7900, 767, 23, 0, []]);
  // Taken from the scene as it was before it drew anything with a material. A change here changes what low poly draws.
  // It was 3323304581 before the dodo's grey box joined the pack, which numbers the meshes after it one on, 289722570
  // before the palette was refitted and the horn's flat colour became 177, and 3173910610 until a loose thing's up
  // turned from down to up: negating that column of its bone gives that hash again. It was 57387346 until draw flags took
  // 16 bits each, and hashed a byte each it was that still; then 2089007614 until the nodes here were turned and sized,
  // stood on their bases and were drawn sized, and seven more kinds' grey boxes numbered the meshes after the tree's on;
  // then 1755989135 until three more kinds' grey boxes did the same, and 3019125801 until the dodo was drawn as its
  // model, so that its grey box left this pack. It was 946480213 until low poly's sun stood where the lit tiers' does
  // and the far wood was drawn (D260): the sun alone gives 1662333099, and less the far wood's draws, buffers and the
  // palm's level, every frame is as with the sun alone but for the first frame's level uploads, where the tree's comes
  // first, since the far wood draws it before the near store does. It was 133088346 until the trees grew at the art's sizes:
  // the palm from 0.85 to 1.15 of its model, not 0.8 to 1.25 (with the tree at 0.85 to 1.2 as well, 1199806411); the elder
  // oak a kind of its own, whose grey box numbers the meshes after it on (3610121629); and the common tree a young oak from
  // 0.4 to 0.75, at which the far wood is two draws fewer over the 300 frames. It was 3057706620 until the limestone grew
  // at 0.8 to 1.25 of its models, not 0.6 to 1.5: the two rocks here are the first of its six at the first and the eleventh
  // of its sizes, drawn as the kind's grey box in this pack. Its variants and its footing alone leave it as it was. It was
  // 1700240194 until far nodes were drawn as rows of an atlas, every mesh of a tile in one draw (DRAW_PULLED), each
  // instance naming its row: the far wood's draws, its instances' bytes and order, and the levels uploaded moved, the
  // palm's last level for the pulled draws' three. The hand-over band (hand.ts) alone leaves it as it was: every node
  // here stands within 152 m, and with the band past the near field it is this again. It was 4087841682 until the common
  // tree grew at 0.85 to 1.15 of its models, not 0.4 to 0.75, and the 300 frames took two draws more: the sizes alone give
  // it, and its four young variants and the elders' boxes alone leave it as it was. It was 3734161494 until the pack held
  // four meshes more, numbered after or among the others: the wooden club, the slingshot and its stone (2299377612 with
  // those alone) and the grey box of feces lying (3294409758 with that alone). The draws, the triangles and the uploads
  // are as they were. It was 4244515908 until Miami's ruin blocks took mesh numbers of their own, then 1069497684 until
  // the pack held the mortar and pestle's grey box (content/items/stations.ts); without it and sparkpowder it is that again.
  // It was 543691550 until the pack held the smoke and poison clouds' boxes, which are never drawn (render/clouds.ts draws
  // a cloud as puffs); without the two grenades, their clouds and the poison's buff (content/items/explosives.ts) it is that again.
  // It was 828002586 until Miami's third round of ruins added 160 static box definitions, which take mesh numbers before
  // the grey boxes'; the draws, triangles and uploads are as they were.
  // It was 3699520576 until the pack held the obelisk's and its terminal's grey boxes (content/terminals.ts); without them,
  // and the proving ground's obelisk, it is that again.
  // It was 1227352852 until the sloped statics' grey boxes (content/slopes.ts) took mesh numbers; without them it is that again.
  // It was 3382680890 until San Francisco's 8 m solid (zmass8, content/ruins.ts) added eight static boxes the same way.
  // It was 3260333166 until the pack held the sleeping bag's and the bunk bed's grey boxes; without those two it is that again.
  // It was 3479987675 until the pteranodon's grey box (content/creatures/pteranodon.ts) took a mesh number; without the
  // pteranodon and its beach entry it is that again.
  // It was 1901866876 until the oil rock's, crystal's, obsidian rock's and clam's grey boxes (content/items/nodes.ts) took
  // mesh numbers (the eleven the proving ground lists do not move it); without those four kinds it is that again.
  expect(hash).toBe(2385450423);

  // The same scene with a saddle on the nearest and the farthest tube (FL5). Each is drawn on its tube's bones, rigid with
  // it when the frame has no bones to pose it, at its tube's level or, where the tube is drawn coarser, at the coarsest of
  // its own two: low poly draws nothing finer than a mesh's second level. Its one draw where it is seen is all that is
  // new, with its level's one upload; the network is asked for nothing more, as the boot file holds both its levels. The
  // pin moved only for this: without the saddles it is the hash above.
  const saddled = lowPoly(true);
  expect(saddled.log).toEqual(log);
  expect([saddled.draws - draws, saddled.rigid - rigid, saddled.uploads - uploads, saddled.texLedger, saddled.worn[0] ?? 0, saddled.worn[1]]).toEqual([273, 97, 1, 0, 0, 273]);
  // It was 1277817829 until the four resource nodes' grey boxes took mesh numbers; without those four kinds it is that again.
  expect(saddled.hash).toBe(3184345957);
});

test("a sized draw at the size a mesh was made draws as it always did, flat and with materials; at another size it is that much larger", () => {
  /** Pieces turned several ways, drawn again as sized draws whose instances carry `size`, and what the rasterizer made of each. */
  const pictures = (tier: Partial<Tier>, size: number): [Uint8ClampedArray, Uint8ClampedArray, number] => {
    const [plain, sized] = [sceneWorld({}, tier), sceneWorld({}, tier)];
    for (const w of [plain, sized]) for (let i = 0; i < 3; i++) w.structs.add(w.kind(PANEL), 30 + i * 2, 0, 26, FACING + i * 7000, 0, 1);
    let flagged = 0;
    for (let f = 0; f < 8; f++) {
      plain.frame();
      const p = sized.frame(100, false);
      for (const u of p.uploads) for (let i = 0; i * INSTANCE_BYTES < u.data.length; i++) u.data[i * INSTANCE_BYTES + 14 + SIZE_REGION] = size;
      for (let d = 0; d < p.drawCount; d++) {
        if (p.drawBuffer[d] === TRANSIENT_BUFFER || (p.drawFlags[d]! & DRAW_SKINNED) !== 0) continue;
        p.drawFlags[d]! |= DRAW_SIZED;
        flagged++;
      }
      sized.raster.render(p);
    }
    expect(flagged).toBeGreaterThanOrEqual(8);
    const covered = (w: World): number => w.raster.pickKind.filter((k) => k === PICK_STRUCTURE).length;
    expect(covered(plain)).toBeGreaterThan(600);
    return [plain.raster.color, sized.raster.color, covered(sized) / covered(plain)];
  };
  for (const tier of [{}, tierOf("lowpoly")]) {
    const [plain, same] = pictures(tier, SIZE_UNITS);
    expect(same).toEqual(plain);
    const [, larger, grown] = pictures(tier, SIZE_UNITS * 1.5);
    expect(larger).not.toEqual(plain);
    expect(grown).toBeGreaterThan(1.5);
  }
});

test("a body is drawn at every level its mesh has, eight of them as well as five", () => {
  // The tube made flat with eight levels, the coarsest a long way from the finest.
  const tube = tubeMesh();
  const lods = Array.from({ length: 8 }, (_, l): SourceLod => {
    const { positions, colors, indices, bones } = tube.lods[Math.min(l, 2)]!;
    return { positions, colors, indices, bones, error: l === 0 ? undefined : 0.01 * 2 ** l };
  });
  const pack = parsePack(buildPack([{ id: TUBE, skeleton: TUBE, rig: TUBE, lods }], defaultPalette(), tubeClips(), [TUBE_RIG]));
  const reg = sceneRegistry();
  const dims = { chunksX: 2, chunksZ: 2 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const scene = new Scene({ dims, hf, structs }, reg, pack);
  const cam = new Camera();
  const remote = new RemoteSample();
  [remote.count, remote.id[0], remote.kind[0], remote.x[0], remote.y[0], remote.z[0], remote.flags[0]] = [1, 100, reg.index.get(TUBE)!, 0, 0, 0, 1];
  const level = (far: number): number => {
    [cam.x, cam.z] = [0, -far];
    const p = scene.build(cam, remote);
    return p.drawLod[[...Array(p.drawCount).keys()].find((d) => p.drawMesh[d] === pack.meshIndex.get(TUBE))!]!;
  };
  expect([level(3), level(5000)]).toEqual([0, 7]);
});

test("a loose thing is turned, not mirrored: its bone takes +Y up and keeps the handedness of the model", () => {
  const w = sceneWorld();
  const p = w.scene.packet;
  for (const [dx, dy, dz] of [[0, 0, 1], [0.6, 0, 0.8], [0, 0.6, 0.8], [0.48, -0.6, -0.64]] as const) {
    p.beginFrame();
    w.scene.characters.begin();
    expect(w.scene.characters.loose(p, w.mesh(PANEL), 0, 0, 0, dx, dy, dz, 1)).toBe(true);
    const b = p.bones;
    const det = b[0]! * (b[5]! * b[10]! - b[6]! * b[9]!) - b[1]! * (b[4]! * b[10]! - b[6]! * b[8]!) + b[2]! * (b[4]! * b[9]! - b[5]! * b[8]!);
    expect([det, b[5]! > 0]).toEqual([expect.closeTo(1, 6), true]);
  }
});
