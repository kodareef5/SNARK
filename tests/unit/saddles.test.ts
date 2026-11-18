// A saddle drawn on its creature, both ways (D491): from what an asset folder declares, through the conversion and the
// pack, to what the scene draws, on the sample raptor with saddles made in code (tests/fixtures/saddles.ts); and a rider
// drawn in its seat's whole frame.
import { expect, test } from "bun:test";
import { artTest } from "../fixtures/needs-art.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_ONE_BONE, DRAW_SKINNED, DRAW_TEXTURED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene, bodySeed } from "../../client/core/render/scene.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { creaturePose } from "../../shared/anim/creature.ts";
import { B_HIPS, B_PROP_L, B_PROP_R, HUMAN_BONES, SLOT_FEET, SLOT_HANDS, type Socket } from "../../shared/anim/human.ts";
import { defaultLook, LOOK_BYTES, setRegion } from "../../shared/anim/look.ts";
import { RiderGrips } from "../../shared/anim/rider-grips.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { SEAT_FLOATS, seatFrame } from "../../shared/anim/seat.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import { INSTANCE_BYTES, parsePack, type Pack } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import type { Seat } from "../../shared/sim/seats.ts";
import { STANCE_CROUCH } from "../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ACT_SWING, HOLD_HANDS } from "../../shared/sim/weapon.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { convertModel, packOf, repack, type Built } from "../../tools/art/build.ts";
import { checkAsset } from "../../tools/art/check.ts";
import type { CreatureAsset } from "../../tools/art/spec.ts";
import { encodePng } from "../../tools/pack/image.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { buildPack, unpackMeshes } from "../../tools/pack/write.ts";
import { corePack, frozenPack } from "../fixtures/pack.ts";
import { RAPTOR, SADDLE, SADDLED, SADDLE_OBJECT, WORN, saddleAsset, saddleGlb, saddledFrozenPack, type Ways } from "../fixtures/saddles.ts";
import { tubeGlb, tubePictures, writeGlb } from "../fixtures/textured.ts";
import { coreRegistry } from "../fixtures/world.ts";

const built = (): Built => ({ meshes: [], rigs: [], clips: [], lines: [], warnings: [], faults: [] });

/** Calls `work` with a folder of its own and removes it after. */
function scratch<T>(work: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "snark-saddles-"));
  try {
    return work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `spec` converted from `glb` as an asset folder for the raptor would be. */
function convert(glb: Uint8Array, spec: CreatureAsset): Built {
  return scratch((dir) => {
    writeFileSync(join(dir, "raptor.glb"), glb);
    const out = built();
    convertModel({ id: RAPTOR, name: "raptor", dir, file: join(dir, "raptor.snpk"), spec }, join(dir, "raptor.glb"), out);
    return out;
  });
}

test("an asset names a worn saddle and a saddled model, and the build makes each a mesh of its own on the body's rig, with its own levels and colours", () => {
  const pack = frozenPack();
  const raptor = unpackMeshes(pack).find((m) => m.id === RAPTOR)!;
  // The frozen raptor's zones and its seat, fitted to its trunk, which the saddle lies on.
  const trunk = ["Body", "Back", "Hips", "Torso", "Shoulders"];
  const fitted: Partial<CreatureAsset> = {
    zones: [
      { zone: "torso", on: "Body", from: "Tail1", to: "Shoulders", covers: [...trunk, "BackLeg.L", "BackLeg.R", "FrontLeg.L", "FrontLeg.R"] },
      { zone: "torso", on: "Neck", from: "Neck", to: "Head", covers: ["Neck"] },
      { zone: "legL", on: "BackUpLeg.L", from: "BackUpLeg.L", to: "BackFoot.L", covers: ["BackUpLeg.L", "BackLowLeg.L", "BackFoot.L"] },
    ],
    sockets: [{ name: "seat", bone: "Torso", of: trunk, at: "top" }],
  };
  const bare = convert(saddleGlb(pack, false), { ...saddleAsset("both"), worn: undefined, saddled: undefined, ...fitted });
  const both = convert(saddleGlb(pack), { ...saddleAsset("both"), ...fitted });
  expect([bare.faults, both.faults, both.warnings]).toEqual([[], [], []]);
  expect(both.meshes.map((m) => [m.id, m.skeleton, m.rig])).toEqual([[RAPTOR, "dino", RAPTOR], [WORN, "dino", RAPTOR], [SADDLED, "dino", RAPTOR]]);
  // The bare body is what it was without them: the objects the two ways name are theirs, so the zones and the seat are
  // fitted to the body alone, and serve the saddled model as they are.
  const [body, worn, saddled] = both.meshes as [typeof raptor, typeof raptor, typeof raptor];
  expect(body.lods.map((l) => l.indices.length)).toEqual(bare.meshes[0]!.lods.map((l) => l.indices.length));
  expect(body.lods[0]!.indices.length).toBe(raptor.lods[0]!.indices.length);
  expect([both.rigs[0]!.caps, both.rigs[0]!.sockets]).toEqual([bare.rigs[0]!.caps, bare.rigs[0]!.sockets]);
  expect(both.rigs[0]!.names).toEqual(pack.header.rigs.find((r) => r.id === RAPTOR)!.names);
  // The worn saddle is five boxes on the Torso bone, which carries the seat, in its own two colours: nothing in ARK dyes a
  // saddle. Too few triangles to be worth a coarser level, it has one, drawn at every level of the body.
  const torso = both.rigs[0]!.names!.indexOf("Torso");
  expect([worn.lods.length, worn.lods[0]!.indices.length / 3, [...new Set(worn.lods[0]!.bones)]]).toEqual([1, 60, [torso]]);
  expect([...new Set(worn.lods[0]!.colors)].every((c) => c < REGION_BASE)).toBe(true);
  expect(new Set(worn.lods[0]!.colors).size).toBe(2);
  // The saddled model is the raptor and a red box saddle: its regions dyed as the body's, its saddle in colours of its own,
  // with levels made to the raptor's budgets.
  expect(saddled.lods[0]!.indices.length / 3).toBe(raptor.lods[0]!.indices.length / 3 + 60);
  const colours = new Set(saddled.lods[0]!.colors);
  expect([[REGION_BASE, REGION_BASE + 1, REGION_BASE + 2].every((c) => colours.has(c)), [...colours].filter((c) => c < REGION_BASE).length]).toEqual([true, 2]);
  expect([...colours].some((c) => worn.lods[0]!.colors.includes(c))).toBe(false);
  expect(saddled.lods.length).toBe(raptor.lods.length);
  saddled.lods.forEach((l, level) => expect(l.indices.length / 3).toBeLessThanOrEqual(level === 0 ? Infinity : raptor.lods[level - 1]!.indices.length));
  expect(both.lines.filter((l) => l.startsWith("core:")).map((l) => l.split(": ")[0])).toEqual([WORN, SADDLED]);

  // What it names and the model lacks, or names twice, is a fault, and nothing is written.
  const lacking = convert(saddleGlb(pack, false), saddleAsset("both"));
  expect(lacking.faults).toEqual([`${WORN}: the model has no skinned mesh object named "${SADDLE_OBJECT}"`, `${SADDLED}: the model has no skinned mesh object named "Velociraptor_saddled"`]);
  const twice = convert(saddleGlb(pack), { ...saddleAsset("both"), worn: [...saddleAsset("worn").worn!, ...saddleAsset("worn").worn!] });
  expect(twice.faults).toEqual([`worn: the saddle "${SADDLE}" is named twice`, `the mesh object "${SADDLE_OBJECT}" is named twice among the worn saddles and the saddled model`, `${WORN}: the model has no skinned mesh object named "${SADDLE_OBJECT}"`]);
});

test("a worn saddle with pictures of its own is drawn with them at its finer levels, made to its own budgets, and keeps them through a repack, a split and the check", () => {
  scratch((root) => {
    // The tube, and a collar on its upper bone: its horn ring again as an object of its own, drawn with the horn's pictures.
    const dir = join(root, "t/creatures/tube");
    mkdirSync(join(dir, "tex"), { recursive: true });
    for (const [role, picture] of Object.entries(tubePictures())) writeFileSync(join(dir, "tex", `${role}.png`), encodePng(picture));
    const glb = parseGlb(tubeGlb());
    const gltf = glb.json as { nodes: Record<string, unknown>[]; meshes: { primitives: unknown[] }[]; scenes: { nodes: number[] }[] };
    gltf.meshes.push({ primitives: [gltf.meshes[0]!.primitives[1]!] });
    gltf.nodes.push({ name: "Collar", mesh: 1, skin: 0 });
    gltf.scenes[0]!.nodes.push(gltf.nodes.length - 1);
    writeFileSync(join(root, "tube.glb"), writeGlb(gltf, glb.data));
    const horn = { base: "tex/base.png", tint: [0.9, 0.8, 0.55] as const, twoSided: true };
    const spec: CreatureAsset = {
      kind: "creature", source: { scripts: [] }, scale: 1, skeleton: { id: "tube", root: "lower" }, zones: [], sockets: [], clips: [], feet: [], gaits: {},
      regions: [{ name: "one", sample: 8 }, { name: "two", sample: 7 }, { name: "three", sample: 14 }, { name: "four", sample: 6 }],
      materials: { hide: { base: "tex/base.png", normal: "tex/normal.png", packed: "tex/mro.png", regions: { mask: "tex/mask.png", mask2: "tex/mask2.png" } }, horn },
      budgets: { triangles: [512, 256, 128, 64], texture: { top: 64, megabytes: 1 } },
      flat: 2,
      worn: [{ item: "t:collar", object: "Collar", materials: { horn }, budgets: { triangles: [128, 64, 32] }, flat: 1 }],
    };
    const asset = { id: "t:tube", name: "tube", dir, file: join(dir, "tube.snpk"), spec };
    const out = built();
    convertModel(asset, join(root, "tube.glb"), out);
    expect([out.faults, out.meshes.map((m) => m.id)]).toEqual([[], ["t:tube", "t:collar/worn"]]);
    const collar = out.meshes[1]!;
    // Its own plan: its finest level with the horn's surface, then flat levels to its own budgets, on the tube's bones.
    expect([collar.flat, collar.lods.map((l) => l.uvs !== undefined), collar.materials!.map((m) => m.id), collar.skeleton, collar.rig]).toEqual([1, [true, false, false], ["t:tube/horn"], "tube", "t:tube"]);
    collar.lods.forEach((l, level) => expect(l.indices.length / 3).toBeLessThanOrEqual(spec.worn![0]!.budgets.triangles[level]!));
    // A material given twice with other pictures is a fault.
    const other = built();
    convertModel({ ...asset, spec: { ...spec, worn: [{ ...spec.worn![0]!, materials: { horn: { ...horn, twoSided: false } } }] } }, join(root, "tube.glb"), other);
    expect(other.faults).toEqual([`material "horn" is given twice, with other pictures`]);

    // Its levels are made again to its own plan, the split keeps its surface, and the check holds it to its own budgets.
    const file = packOf(out);
    const again = unpackMeshes(parsePack(repack(file, true, asset))).find((m) => m.id === "t:collar/worn")!;
    expect([again.flat, again.lods.map((l) => l.indices.length)]).toEqual([1, collar.lods.map((l) => l.indices.length)]);
    const { manifest } = splitPack(file, "t");
    expect(manifest.meshes.find((m) => m.id === "t:collar/worn")!.levels.map((l) => l.sections !== undefined)).toEqual([true, false, false]);
    const report = checkAsset(asset, parsePack(file));
    expect(report.meshes.map((m) => [m.levels.map((l) => l.budget)])).toEqual([[[512, 256, 128, 64]], [[128, 64, 32]]]);
  });
});

/** The chunks of a .glb: its JSON and its accessors' data in order, to be written again. */
function parseGlb(bytes: Uint8Array): { json: Record<string, unknown>; data: [Float32Array | Uint8Array | Uint16Array | Uint32Array, string][] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as { accessors: { bufferView: number; componentType: number; count: number; type: string }[]; bufferViews: { byteOffset: number; byteLength: number }[] } & Record<string, unknown>;
  const bin = bytes.subarray(28 + length);
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>;
  const data = json.accessors.map((a): [Float32Array | Uint8Array | Uint16Array | Uint32Array, string] => {
    const v = json.bufferViews[a.bufferView]!;
    const raw = bin.slice(v.byteOffset, v.byteOffset + v.byteLength);
    const n = a.count * size[a.type]!;
    const array = a.componentType === 5126 ? new Float32Array(raw.buffer, 0, n) : a.componentType === 5125 ? new Uint32Array(raw.buffer, 0, n) : a.componentType === 5123 ? new Uint16Array(raw.buffer, 0, n) : new Uint8Array(raw.buffer, 0, n);
    return [array, a.type];
  });
  const { accessors: _a, bufferViews: _v, buffers: _b, asset: _s, ...rest } = json;
  return { json: rest, data };
}

/** A flat world with the raptor's saddles of `ways` in the pack, seen on `tier` from (32, 1.6, 20) along +z. */
function stage(ways: Ways | Pack, tier = "medium", nativeHands = false) {
  const reg = coreRegistry();
  let pack = typeof ways === "string" ? saddledFrozenPack(ways) : ways;
  if (nativeHands) {
    const bodies = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk",import.meta.url))));
    const ids = new Set(bodies.header.meshes.map(m => m.id)), rigs = new Set(bodies.header.rigs.map(r => r.id));
    pack = parsePack(buildPack([...unpackMeshes(pack).filter(m => !ids.has(m.id)),...unpackMeshes(bodies)],pack.palette,pack.clips.clips,[...pack.header.rigs.filter(r => !rigs.has(r.id)),...bodies.header.rigs]));
  }
  const dims = { chunksX: 2, chunksZ: 2 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const scene = new Scene({ dims, hf, structs }, reg, pack);
  scene.assets.tier = tierOf(tier);
  scene.viewHeight = 720;
  scene.hour = 12;
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.aspect] = [32, 1.6, 20, 16 / 9];
  const remote = new RemoteSample();
  const st = new AnimState();
  const kind = (id: string): number => reg.index.get(id)!;
  return {
    reg, pack, scene, cam, remote, st, kind,
    /** A body, at rest unless `state` sets it, wearing `saddle` if given. Returns its index among the remote entities. */
    place(id: string, x: number, z: number, saddle = "", state: (s: AnimState) => void = () => {}): number {
      const n = remote.count++;
      [remote.id[n], remote.kind[n], remote.x[n], remote.y[n], remote.z[n], remote.yaw[n], remote.flags[n]] = [100 + n, kind(id), x, 0, z, Math.PI / 2, 1];
      remote.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
      if (saddle) remote.gear[n * GEAR_COUNT + GEAR_WORN] = kind(saddle);
      st.unpack(0);
      state(st);
      remote.anim[n] = st.pack();
      remote.cue[n] = st.packCue();
      return n;
    },
    frame(): FramePacket {
      scene.now += 1000 / 60;
      return scene.build(cam, remote);
    },
  };
}

/** Each body's meshes a frame draws in the view: the mesh's id and the level drawn, its first bone, and whether it is rigid, by entity. */
function drawn(p: FramePacket, pack: Pack): Map<number, { mesh: string; lod: number; bone: number; rigid: boolean }[]> {
  const u16 = new Uint16Array(p.transient.buffer, p.transient.byteOffset, p.transient.byteLength >> 1);
  const out = new Map<number, { mesh: string; lod: number; bone: number; rigid: boolean }[]>();
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== TRANSIENT_BUFFER || (p.drawFlags[d]! & DRAW_SKINNED) === 0) continue;
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
      const list = out.get(p.transientIds[i]!) ?? out.set(p.transientIds[i]!, []).get(p.transientIds[i]!)!;
      const one = { mesh: pack.header.meshes[p.drawMesh[d]!]!.id, lod: p.drawLod[d]!, bone: u16[i * 10 + 6]!, rigid: (p.drawFlags[d]! & DRAW_ONE_BONE) !== 0 };
      // A draw across medium's two depth ranges is listed in each.
      if (!list.some((o) => o.mesh === one.mesh && o.bone === one.bone)) list.push(one);
    }
  }
  return out;
}

/**
 * Where a body stands, walked from near to far, to be drawn at every level it has on a view a twelfth as tall as the one
 * the other tests see, whose pixels are as many times larger: within the 192 m a client is sent bodies.
 */
const FAR = Array.from({ length: 85 }, (_, k) => 22 + k * 2);
const SMALL_VIEW = 60;

/** What the raptor plays, a state each: standing, walking, running, biting, in the air, knocked out (its death clip). */
const CLIPS: readonly [string, (s: AnimState, tick: number) => void][] = [
  ["idle", () => {}],
  ["walk", (s) => (s.speed = 4)],
  ["run", (s) => (s.speed = 12)],
  ["attack", (s, tick) => s.setAction(ACT_SWING, HOLD_HANDS, tick - 4)],
  ["falling", (s) => (s.grounded = false)],
  ["knocked out", (s) => (s.out = true)],
];

test("a raptor wearing its saddle is drawn with the saddle on its own bones through every clip, at every level, on low poly and medium, and in shadow; taken off, it is gone", () => {
  for (const tier of ["lowpoly", "medium", "high"]) {
    const w = stage("worn", tier);
    const id = (n: number): number => w.remote.id[n]!;
    for (const [clip, set] of CLIPS) {
      w.remote.count = 0;
      const saddled = w.place(RAPTOR, 32, 26, SADDLE, (s) => set(s, 40));
      const bare = w.place(RAPTOR, 35, 27, "", (s) => set(s, 40));
      for (let f = 0; f < 30; f++) {
        w.remote.tick = 40 + f;
        const p = w.frame();
        const seen = drawn(p, w.pack);
        // The saddle hangs on the bones the raptor's body is posed on, so it moves as the body does, at the body's level or the
        // coarsest of its own.
        const [body, saddle] = seen.get(id(saddled))!;
        expect([body!.mesh, saddle?.mesh, saddle?.bone, saddle?.lod, saddle?.rigid]).toEqual([RAPTOR, WORN, body!.bone, 0, body!.rigid]);
        expect(seen.get(id(bare))!.map((m) => m.mesh)).toEqual([RAPTOR]);
        // On the lit tiers it casts as its body does.
        if (tier !== "lowpoly" && f === 29) expect([...Array(p.casterCount).keys()].some((c) => w.pack.header.meshes[p.casterMesh[c]!]!.id === WORN)).toBe(true);
      }
      expect([clip, w.scene.characters.posed]).toEqual([clip, 2]);
    }
    // From near to far the body takes each of its levels, and the saddle, of one level, is drawn with it at every one.
    w.scene.viewHeight = SMALL_VIEW;
    w.remote.count = 0;
    const far = w.place(RAPTOR, 32, 26, SADDLE);
    const levels = new Set<number>();
    for (const z of FAR) {
      w.remote.z[far] = z;
      const [body, saddle] = drawn(w.frame(), w.pack).get(id(far))!;
      levels.add(body!.lod);
      expect([saddle?.mesh, saddle?.bone]).toEqual([WORN, body!.bone]);
    }
    expect([...levels]).toEqual(tier === "lowpoly" ? [1, 2, 3, 4] : [0, 1, 2, 3, 4]);
    // Taken off, it is no longer drawn.
    w.remote.z[far] = 26;
    w.remote.gear[far * GEAR_COUNT + GEAR_WORN] = 0;
    expect(drawn(w.frame(), w.pack).get(id(far))!.map((m) => m.mesh)).toEqual([RAPTOR]);
  }
});

test("a raptor that has a saddled model is drawn as it in place of its body while it wears any saddle, on the same bones, at each of its own levels, and the worn saddle is not drawn over it", () => {
  for (const ways of ["saddled", "both"] as const) {
    for (const tier of ["lowpoly", "medium"]) {
      const w = stage(ways, tier);
      for (const [, set] of CLIPS) {
        w.remote.count = 0;
        const n = w.place(RAPTOR, 32, 26, SADDLE, (s) => set(s, 40));
        for (let f = 0; f < 10; f++) {
          w.remote.tick = 40 + f;
          expect(drawn(w.frame(), w.pack).get(w.remote.id[n]!)!.map((m) => m.mesh)).toEqual([SADDLED]);
        }
      }
      w.scene.viewHeight = SMALL_VIEW;
      w.remote.count = 0;
      const n = w.place(RAPTOR, 32, 26, SADDLE);
      const levels = new Set<number>();
      for (const z of FAR) {
        w.remote.z[n] = z;
        levels.add(drawn(w.frame(), w.pack).get(w.remote.id[n]!)![0]!.lod);
      }
      expect([...levels]).toEqual(tier === "lowpoly" ? [1, 2, 3, 4] : [0, 1, 2, 3, 4]);
      w.remote.z[n] = 26;
      w.remote.gear[n * GEAR_COUNT + GEAR_WORN] = 0;
      expect(drawn(w.frame(), w.pack).get(w.remote.id[n]!)!.map((m) => m.mesh)).toEqual([RAPTOR]);
    }
  }
});

test("a rider is drawn in its seat's whole frame: it leans as the raptor's back does through a bite, and sits where the seat is", () => {
  for (const tier of ["lowpoly", "medium"]) {
    const w = stage("worn", tier);
    const mount = w.place(RAPTOR, 32, 26, SADDLE);
    const rider = w.place("core:survivor", 32, 26, "", (s) => (s.stance = STANCE_CROUCH));
    w.remote.seat[rider] = w.remote.id[mount]! + 1;
    w.remote.tick = 200;
    const anim = w.scene.characters.creature(w.kind(RAPTOR))!;
    const rig = anim.rig;
    const st = new AnimState();
    const frame = new Float64Array(SEAT_FLOATS);
    let leant = 0;
    let local: number[] | null = null;
    // Through the bite, the rider's own pose held still, its hips are fixed in the seat's frame and turn as the seat does.
    for (let k = 0; k < 27; k++) {
      st.unpack(0);
      st.setAction(ACT_SWING, HOLD_HANDS, 200 - k);
      w.remote.anim[mount] = st.pack();
      const p = w.frame();
      st.seed = bodySeed(w.remote.id[mount]!);
      creaturePose(anim, st, 200, rig.a, null);
      solve(rig, rig.a, rig.solved);
      seatFrame(rig.solved, rig.sockets.get("seat")!, 32 - w.cam.x, -w.cam.y, 26 - w.cam.z, Math.PI / 2, frame);
      const bodies = drawn(p, w.pack).get(w.remote.id[rider]!)!;
      const at = (bodies[0]!.bone + B_HIPS) * 12;
      const b = p.bones;
      // The hips' turn and place, in the seat's frame: the seat's turn undone from both.
      const f = (r: number, c: number): number => frame[3 + r * 3 + c]!;
      const inSeat = [0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => [0, 1, 2].reduce((sum, q) => sum + f(q, r) * (b[at + q * 4 + c]! - (c === 3 ? frame[q]! : 0)), 0)));
      local ??= inSeat;
      inSeat.forEach((v, i) => expect(v).toBeCloseTo(local![i]!, 4));
      // How far the seat's up leans from straight up.
      leant = Math.max(leant, Math.acos(Math.min(1, f(1, 1))));
    }
    // The raptor's back pitches through its bite, and the rider with it.
    expect((leant * 180) / Math.PI).toBeGreaterThan(3);
  }
});


test("thinning reserves each fitted rider profile and shares only identical profiles before final host posing", () => {
  const w = stage("worn"), ch = w.scene.characters;
  const rig = ch.creature(w.kind(RAPTOR))!.rig, saddle = w.kind(SADDLE);
  const on = rig.sockets.get("seat")!;
  for (const [name, x, y, z] of [["palm_l", -.19, .31, .27], ["palm_r", .19, .31, .27], ["ankle_l", -.42, -.4, .38], ["ankle_r", .42, -.4, .38]] as const) {
    (rig.sockets as Map<string, Socket>).set(name, { bone: on.bone, x: on.x + x, y: on.y + y, z: on.z + z });
  }
  const contacts = { hands: ["palm_l", "palm_r"], feet: ["ankle_l", "ankle_r"] } as const;
  const seat = w.reg.saddleSeats[saddle]![0]!;
  (w.reg.saddleSeats as (readonly Seat[] | null)[])[saddle] = [{ ...seat, rider: contacts }, { ...seat, rider: contacts }];
  const hosts: number[] = [];
  for (let k = 0; k < 2; k++) hosts.push(w.place(RAPTOR, 30 + k * 4, 32, SADDLE));
  for (let k = 0; k < 4; k++) {
    const i = w.place("core:survivor", 30, 32);
    w.remote.seat[i] = w.remote.id[hosts[k % 2]!]! + 1;
    w.remote.seatSlot[i] = k % 2 + 1;
  }
  // Each of two fitted seat profiles needs a HUMAN stand-in, plus the two still-posed hosts and four rigid instances.
  // A generic seated cache undercounted the second profile and stopped thinning too soon, dropping a rider on submission.
  const budget = 2 * HUMAN_BONES + 2 * ch.bones(w.kind(RAPTOR)) + 4;
  w.scene.assets.tier = { ...w.scene.assets.tier, bones: budget };
  for (let frame = 0; frame < 2; frame++) {
    const p = w.frame(), bodies = drawn(p, w.pack);
    expect(p.dropped).toBe(0);
    expect(p.boneCount).toBeLessThanOrEqual(budget);
    for (let k = 2; k < 6; k++) expect(bodies.has(w.remote.id[k]!)).toBe(true);
    expect([...bodies.values()].filter(parts => parts[0]!.rigid).length).toBeGreaterThan(1);
  }
});

test("seated footwear and look changes refit the actual native sole, including distant footwear cache reservations", () => {
  const w = stage("worn"), ch = w.scene.characters, saddle = w.kind(SADDLE), rig = ch.creature(w.kind(RAPTOR))!.rig;
  const on = rig.sockets.get("seat")!;
  for (const [name,x,y,z] of [["palm_l",.19,.31,.27],["palm_r",-.19,.31,.27],["ankle_l",.42,-.26,.38],["ankle_r",-.42,-.26,.38],["knee_l",.48,-.08,.27],["knee_r",-.48,-.08,.27],["sole_l",.42,-.373,.51],["sole_r",-.42,-.373,.51]] as const) {
    (rig.sockets as Map<string,Socket>).set(name,{bone:on.bone,x:on.x+x,y:on.y+y,z:on.z+z});
  }
  const seat = w.reg.saddleSeats[saddle]![0]!;
  (w.reg.saddleSeats as (readonly Seat[]|null)[])[saddle] = [{...seat,rider:{hands:["palm_l","palm_r"],feet:["ankle_l","ankle_r"],knees:["knee_l","knee_r"],soles:{sockets:["sole_l","sole_r"],half:[.15,.13]}}}];
  const host = w.place(RAPTOR,32,26,SADDLE), rider = w.place("core:survivor",32,26), meshList = unpackMeshes(w.pack);
  w.remote.seat[rider] = w.remote.id[host]!+1; w.remote.seatSlot[rider] = 1;
  w.remote.hasLook[rider] = 1; const look = defaultLook(); w.remote.look.set(look,rider*LOOK_BYTES);
  for (const [boots,footSize] of [["",0],["core:hide_boots",1],["core:cloth_boots",-1],["",1]] as const) {
    setRegion(look,15,footSize); w.remote.look.set(look,rider*LOOK_BYTES);
    w.remote.gear[rider*GEAR_COUNT+GEAR_WORN+SLOT_FEET] = boots ? w.kind(boots) : 0;
    // Test the very next frame: the pose-rate scheduler must not reuse an old fit when equipment/look changes.
    const p = w.frame(), visible = drawn(p,w.pack), body = visible.get(w.remote.id[host]!)![0]!, feet = visible.get(w.remote.id[rider]!)!.find(m => m.mesh.endsWith("/feet"))!;
    expect(feet.rigid).toBe(false);
    expect(feet.mesh.includes(boots ? boots.includes("hide") ? "/hide/" : "/cloth/" : "/armor/")).toBe(!!boots);
    const support = rig.sockets.get("sole_l")!, b = (body.bone+support.bone)*12, joint = support.bone*3;
    const sx = rig.rest[joint]!+support.x, sy = rig.rest[joint+1]!+support.y, sz = rig.rest[joint+2]!+support.z;
    // The host's own submitted bones define the physical platform, so this also catches stale host-relative fitting.
    const platform = [0,1,2].map(axis => p.bones[b+axis*4]!*sx+p.bones[b+axis*4+1]!*sy+p.bones[b+axis*4+2]!*sz+p.bones[b+axis*4+3]!);
    const up = [p.bones[b+1]!,p.bones[b+5]!,p.bones[b+9]!];
    const lod = meshList.find(m => m.id === feet.mesh)!.lods[0]!;
    let lowest = Infinity;
    for (let v = 0; v < lod.positions.length/3; v++) {
      const k = (feet.bone+lod.bones![v]!)*12, x=lod.positions[v*3]!, y=lod.positions[v*3+1]!, z=lod.positions[v*3+2]!;
      const point = [0,1,2].map(axis => p.bones[k+axis*4]!*x+p.bones[k+axis*4+1]!*y+p.bones[k+axis*4+2]!*z+p.bones[k+axis*4+3]!);
      lowest = Math.min(lowest,point.reduce((sum,value,axis) => sum+(value-platform[axis]!)*up[axis]!,0));
    }
    expect(Math.abs(lowest)).toBeLessThan(.00001);
  }
  const profile = saddle*17+1, st = new AnimState(), bare = new Uint16Array(GEAR_COUNT), hide = new Uint16Array(GEAR_COUNT);
  hide[GEAR_WORN+SLOT_FEET] = w.kind("core:hide_boots");
  expect(ch.standInBones(w.kind("core:survivor"),null,0,st,true,false,profile,bare)).toBe(HUMAN_BONES);
  expect(ch.standInBones(w.kind("core:survivor"),null,0,st,true,false,profile,hide)).toBe(HUMAN_BONES);
  expect(ch.standInBones(w.kind("core:survivor"),null,0,st,true,false,profile,hide)).toBe(0);
  const riders = [rider];
  for (const boots of ["core:hide_boots","core:cloth_boots",""]) {
    const mount = w.place(RAPTOR,30+riders.length,28,SADDLE), seated = w.place("core:survivor",30,28);
    w.remote.seat[seated] = w.remote.id[mount]!+1; w.remote.seatSlot[seated] = 1;
    w.remote.gear[seated*GEAR_COUNT+GEAR_WORN+SLOT_FEET] = boots ? w.kind(boots) : 0; riders.push(seated);
  }
  // Shared rigid mount pose, three footwear-specific HUMAN poses, four host roots and four rider roots.
  const budget = ch.bones(w.kind(RAPTOR))+3*HUMAN_BONES+8;
  w.scene.assets.tier = {...w.scene.assets.tier,bones:budget};
  for (let frame = 0; frame < 2; frame++) {
    const p = w.frame(), visible = drawn(p,w.pack);
    expect(p.dropped).toBe(0); expect(p.boneCount).toBeLessThanOrEqual(budget);
    for (const seated of riders) expect(visible.has(w.remote.id[seated]!)).toBe(true);
    expect(riders.filter(i => visible.get(w.remote.id[i]!)![0]!.rigid).length).toBeGreaterThan(1);
  }
});


artTest("actual glove, look and forearm alignment changes update seated draws and reserve every rigid footwear/glove pair", () => {
  const w=stage("worn","medium",true),ch=w.scene.characters,saddle=w.kind(SADDLE),rig=ch.creature(w.kind(RAPTOR))!.rig,on=rig.sockets.get("seat")!;
  for(const [name,x,y,z]of [["palm_l",.19,.31,.27],["palm_r",-.19,.31,.27],["ankle_l",.42,-.26,.38],["ankle_r",-.42,-.26,.38],["sole_l",.42,-.373,.51],["sole_r",-.42,-.373,.51]]as const)
    (rig.sockets as Map<string,Socket>).set(name,{bone:on.bone,x:on.x+x,y:on.y+y,z:on.z+z});
  const seat=w.reg.saddleSeats[saddle]![0]!;
  (w.reg.saddleSeats as (readonly Seat[]|null)[])[saddle]=[{...seat,rider:{hands:["palm_l","palm_r"],feet:["ankle_l","ankle_r"],soles:{sockets:["sole_l","sole_r"],half:[.15,.13]},grips:{radius:.017,span:[-.12,.13]}}}];
  const host=w.place(RAPTOR,32,26,SADDLE),rider=w.place("core:survivor",32,26),look=defaultLook(),native=w.pack.header.rigs.find(r=>r.id==="human_m")!,cache=new RiderGrips();
  w.remote.seat[rider]=w.remote.id[host]!+1;w.remote.seatSlot[rider]=1;w.remote.hasLook[rider]=1;
  const point=(p:FramePacket,bone:number,x:number,y:number,z:number)=>[0,1,2].map(a=>{const k=bone*12+a*4;return p.bones[k]!*x+p.bones[k+1]!*y+p.bones[k+2]!*z+p.bones[k+3]!;});
  let originalArm:Float32Array<ArrayBuffer>|null=null,alignedArm:Float32Array<ArrayBuffer>|null=null;
  for(const [glove,size,alignment]of [["",0,0],["",0,75],["",0,0],["core:cloth_gloves",1,75],["core:hide_gloves",-1,75],["",1,75]]as const){
    const current=w.reg.saddleSeats[saddle]![0]!;
    (w.reg.saddleSeats as (readonly Seat[]|null)[])[saddle]=[{...current,rider:{...current.rider!,grips:{...current.rider!.grips!,forearmAlignment:alignment}}}];
    setRegion(look,11,size);w.remote.look.set(look,rider*LOOK_BYTES);w.remote.gear[rider*GEAR_COUNT+GEAR_WORN+SLOT_HANDS]=glove?w.kind(glove):0;
    const p=w.frame(),visible=drawn(p,w.pack),hostPart=visible.get(w.remote.id[host]!)![0]!,hand=visible.get(w.remote.id[rider]!)!.find(m=>m.mesh.endsWith("/hands"))!;
    if(!glove&&size===0){
      const arm=p.bones.slice((hand.bone+8)*12,(hand.bone+9)*12);
      if(!originalArm)originalArm=arm;else if(alignment){expect(arm).not.toEqual(originalArm);alignedArm=arm;}else{expect(alignedArm).not.toBeNull();expect(arm).toEqual(originalArm);}
    }
    expect(hand.rigid).toBe(false);expect(hand.mesh.includes(glove?glove.includes("hide")?"/hide/":"/cloth/":"/armor/")).toBe(!!glove);
    const fit=cache.update(native.grips!.find(g=>g.mesh===hand.mesh)!,look,.017,-.12,.13)!;expect(fit).not.toBeNull();
    for(const side of [0,1]){
      const socket=rig.sockets.get(side?"palm_r":"palm_l")!,bone=hostPart.bone+socket.bone,j=socket.bone*3;
      const bar=point(p,bone,rig.rest[j]!+socket.x,rig.rest[j+1]!+socket.y,rig.rest[j+2]!+socket.z),prop=side?B_PROP_R:B_PROP_L;
      const grasp=point(p,hand.bone+prop,native.rest[prop*3]!,native.rest[prop*3+1]!,native.rest[prop*3+2]!);
      for(let axis=0;axis<3;axis++){
        let relative=0;for(let a=0;a<3;a++)relative+=(grasp[a]!-bar[a]!)*p.bones[bone*12+a*4+axis]!;
        expect(relative).toBeCloseTo(axis===0?(side?-1:1)*fit[side*6]!:axis===2?fit[side*6+1]!:0,5);
      }
    }
  }
  // The same seat with all real footwear/glove combinations must reserve nine distinct neutral fits before thinning.
  const riders=[rider];w.remote.gear[rider*GEAR_COUNT+GEAR_WORN+SLOT_HANDS]=0;
  for(let duplicate=0;duplicate<2;duplicate++)for(const boots of ["","core:cloth_boots","core:hide_boots"])for(const glove of ["","core:cloth_gloves","core:hide_gloves"]){
    if(!duplicate&&!boots&&!glove)continue;
    const mount=w.place(RAPTOR,30+riders.length*.3,28,SADDLE),seated=w.place("core:survivor",30,28);
    w.remote.seat[seated]=w.remote.id[mount]!+1;w.remote.seatSlot[seated]=1;
    w.remote.gear[seated*GEAR_COUNT+GEAR_WORN+SLOT_FEET]=boots?w.kind(boots):0;w.remote.gear[seated*GEAR_COUNT+GEAR_WORN+SLOT_HANDS]=glove?w.kind(glove):0;riders.push(seated);
  }
  const budget=ch.bones(w.kind(RAPTOR))+9*HUMAN_BONES+36;w.scene.assets.tier={...w.scene.assets.tier,bones:budget};
  for(let frame=0;frame<2;frame++){
    const p=w.frame(),visible=drawn(p,w.pack);expect(p.dropped).toBe(0);expect(p.boneCount).toBeLessThanOrEqual(budget);
    for(const seated of riders)expect(visible.has(w.remote.id[seated]!)).toBe(true);
    expect(riders.filter(i=>visible.get(w.remote.id[i]!)![0]!.rigid).length).toBeGreaterThan(1);
  }
});

artTest("the native Parasaur saddle draws on its walking mount's rig, with a rest socket matching the model-less seat", () => {
  const pack = corePack();
  for (const tier of ["lowpoly", "medium"]) {
    const name = "parasaur";
    const w = stage(pack, tier);
    // A whole pack has geometry but no streamed pictures. Exercise the finished surface and the flat path.
    if (tier === "medium") w.scene.assets.textured = (mesh, lod) => w.scene.assets.table.sections[mesh]![lod]!.length > 0;
    const bodyId = `core:${name}`, saddleId = `core:saddle_${name}`;
    const mount = w.place(bodyId, 32, 26, saddleId, (s) => (s.speed = 4));
    const anim = w.scene.characters.creature(w.kind(bodyId))!;
    expect(anim.walkGait).not.toBeNull();
    expect(anim.runGait).not.toBeNull();
    const seat = w.reg.saddleSeats[w.kind(saddleId)]![0]!;
    const socket = anim.rig.sockets.get(seat.socket!)!;
    [socket.x, socket.y, socket.z].forEach((offset, axis) => {
      expect(anim.rig.rest[socket.bone * 3 + axis]! + offset).toBeCloseTo(seat.anchor[axis]!, 2);
    });
    const id = w.remote.id[mount]!;
    const saved = [0, 9, 0, 13, 0, 0];
    w.remote.colors.set(saved, mount * 6);
    const species = w.reg.defs[w.kind(bodyId)]!;
    if (species.type !== "species") throw new Error(bodyId);
    const flat = saved.map((c, q) => c || species.regions?.[q]?.colors[0]?.[0] || 0);
    for (let tick = 0; tick < 30; tick++) {
      w.remote.tick = tick;
      w.remote.z[mount] = 26 + tick * 0.1;
      const packet = w.frame();
      const seen = drawn(packet, pack).get(id)!;
      const draw = packet.drawMesh.subarray(0, packet.drawCount).indexOf(pack.meshIndex.get(bodyId)!);
      const at = packet.drawFirst[draw]! * INSTANCE_BYTES + 14;
      const textured = (packet.drawFlags[draw]! & DRAW_TEXTURED) !== 0;
      expect(textured).toBe(tier === "medium");
      expect([...packet.transient.subarray(at, at + 6)]).toEqual(textured ? saved : flat);
      expect([...w.remote.colors.subarray(mount * 6, mount * 6 + 6)]).toEqual(saved);
      const body = seen.find((m) => m.mesh === bodyId)!;
      const saddle = seen.find((m) => m.mesh === `${saddleId}/worn`)!;
      expect(saddle.bone).toBe(body.bone);
    }
    w.remote.gear[mount * GEAR_COUNT + GEAR_WORN] = 0;
    expect(drawn(w.frame(), pack).get(id)!.map((m) => m.mesh)).toEqual([bodyId]);
  }
});
