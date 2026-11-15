// A saddle drawn on its creature, both ways (D491): from what an asset folder declares, through the conversion and the
// pack, to what the scene draws, on the sample raptor with saddles made in code (tests/fixtures/saddles.ts); and a rider
// drawn in its seat's whole frame.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_ONE_BONE, DRAW_SKINNED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene, bodySeed } from "../../client/core/render/scene.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { creaturePose } from "../../shared/anim/creature.ts";
import { B_HIPS } from "../../shared/anim/human.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { SEAT_FLOATS, seatFrame } from "../../shared/anim/seat.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
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
import { unpackMeshes } from "../../tools/pack/write.ts";
import { frozenPack } from "../fixtures/pack.ts";
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
  // Some of the raptor's own zones and its seat (assets/source/core/creatures/dino.ts), fitted to its trunk, which the saddle lies on.
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
function stage(ways: Ways, tier = "medium") {
  const reg = coreRegistry();
  const pack = saddledFrozenPack(ways);
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
