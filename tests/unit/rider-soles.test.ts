import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { writeBones } from "../../client/core/render/characters.ts";
import { NO_CLIPS, Pose } from "../../shared/anim/clip.ts";
import { B_FOOT_L, B_FOOT_R, B_TOE_L, B_TOE_R, HUMAN, HUMAN_BONES, SLOT_FEET } from "../../shared/anim/human.ts";
import { defaultLook, lookScales, LOOK_SEX, REGION_COUNT, setRegion } from "../../shared/anim/look.ts";
import { createMountMotion, mountPose } from "../../shared/anim/mount.ts";
import { fitRiderControls, RIDER_FEET, RIDER_HANDS, RIDER_KNEES, RIDER_SOLES, RIDER_TARGET_FLOATS } from "../../shared/anim/rider-controls.ts";
import { RiderSoles, soleOffsets } from "../../shared/anim/rider-soles.ts";
import { Solved, solve, zoneHit } from "../../shared/anim/skeleton.ts";
import { AnimState, HumanAnim } from "../../shared/anim/pose.ts";
import { raySeated } from "../fixtures/seated-ray.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { EntityRecord } from "../../server/records.ts";
import { SeatedSoles } from "../../server/rider-soles.ts";
import { orderPack } from "../../tools/pack/order.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { buildPack, unpackMeshes } from "../../tools/pack/write.ts";
import { fromArt, test } from "../fixtures/needs-art.ts";
import { coreRegistry } from "../fixtures/world.ts";

const original = fromArt(() => parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk", import.meta.url)))));
const bytes = fromArt(() => buildPack(unpackMeshes(original).filter(m => m.id.endsWith("/feet")), original.palette, [], original.header.rigs));
const pack = fromArt(() => parsePack(bytes)), meshes = fromArt(() => unpackMeshes(pack));
const motion = createMountMotion();
function targets(stego = false, footX = .27): Float64Array {
  const out = new Float64Array(RIDER_TARGET_FLOATS);
  out[0] = RIDER_HANDS | RIDER_FEET | RIDER_KNEES | RIDER_SOLES;
  const points = stego ? [[.17,.31,.27],[footX,-.49,.30],[.36,-.1,.36],[footX,-.565,.4305]] : [[.19,.31,.27],[.42,-.26,.38],[.48,-.08,.27],[.42,-.373,.51]];
  for (let group = 0; group < 4; group++) for (let side = 0; side < 2; side++) {
    const at = 1 + group * 6 + side * 3, p = points[group]!;
    out[at] = p[0]! * (side ? -1 : 1); out[at+1] = p[1]! + .55; out[at+2] = p[2]!;
  }
  out[25] = stego ? .115 : .15; out[26] = stego ? .10 : .13;
  return out;
}
function looks(): Uint8Array[] {
  const values = [-1,0,1].map(v => new Array<number>(REGION_COUNT).fill(v));
  for (let region = 0; region < REGION_COUNT; region++) for (const value of [-1,1]) values.push(Array.from({ length: REGION_COUNT }, (_, r) => r === region ? value : -value));
  for (const width of [-1,1]) for (let corner = 0; corner < 16; corner++) {
    const row = new Array<number>(REGION_COUNT).fill(width);
    [8,11,12,19].forEach((region, bit) => row[region] = corner & (1 << bit) ? 1 : -1); values.push(row);
  }
  return values.map(row => { const look = defaultLook(); row.forEach((v,i) => setRegion(look,i,v)); return look; });
}

test("native quantized sole witnesses survive repack, cache ordering and boot-only streaming without fine geometry", () => {
  const source = structuredClone(original.header.rigs);
  expect(pack.header.rigs.flatMap(r => r.soles ?? []).length).toBe(6);
  const twice = parsePack(buildPack(unpackMeshes(pack), pack.palette, [], pack.header.rigs));
  expect(twice.header.rigs).toEqual(pack.header.rigs);
  const split = splitPack(orderPack(bytes), "feet", { boot: () => false });
  const boot = parsePack(split.files.find(f => f.role === "boot")!.bytes);
  expect(boot.header.rigs).toEqual(pack.header.rigs);
  expect(boot.header.meshes.length).toBe(0);
  expect(original.header.rigs).toEqual(source);
});

test("actual native barefoot and boot vertices contact finite saddle treads across male/female mixed extremes without cuff penetration", () => {
  let worstResidual = 0, lowest = Infinity, gap = 0, outside = 0, samples = 0;
  for (const rig of pack.header.rigs) for (const support of rig.soles!) {
    const rest = Float32Array.from(rig.rest), lod = meshes.find(m => m.id === support.mesh)!.lods[0]!;
    for (const look of looks()) for (const points of [targets(), targets(true), targets(true,.29)]) {
      const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES), scale = new Float32Array(HUMAN_BONES*3), offsets = new Float64Array(6);
      lookScales(look, scale); expect(soleOffsets(support.points, rest, scale, offsets)).toBe(true);
      mountPose(motion, {role:"ride",tick:0,startTick:0,durationTicks:1}, pose); solve(HUMAN,pose,solved,rest,scale);
      const hips = solved.pos.slice(0,3), root = pose.root.slice();
      worstResidual = Math.max(worstResidual, fitRiderControls(pose,solved,rest,scale,points,true,undefined,offsets));
      expect(solved.pos.slice(0,3)).toEqual(hips); expect(pose.root).toEqual(root);
      const rows = new Float32Array(HUMAN_BONES*12); writeBones(rows,0,solved,rest,scale,0,0,0,0);
      const min = [Infinity,Infinity], witness = [0,0];
      for (let vertex = 0; vertex < lod.positions.length/3; vertex++) {
        const bone = lod.bones![vertex]!, k = bone*12, x = lod.positions[vertex*3]!, y = lod.positions[vertex*3+1]!, z = lod.positions[vertex*3+2]!;
        const px = rows[k]!*x+rows[k+1]!*y+rows[k+2]!*z+rows[k+3]!;
        const py = rows[k+4]!*x+rows[k+5]!*y+rows[k+6]!*z+rows[k+7]!;
        const pz = rows[k+8]!*x+rows[k+9]!*y+rows[k+10]!*z+rows[k+11]!;
        const side = px < 0 ? 1 : 0, at = 19+side*3;
        // Every vertex, including all calf/cuff geometry, stays above this support plane.
        lowest = Math.min(lowest, py-points[at+1]!);
        if (py < min[side]!) { min[side] = py; witness[side] = bone; }
        if (bone === B_FOOT_L || bone === B_FOOT_R || bone === B_TOE_L || bone === B_TOE_R) {
          if (Math.abs(py-points[at+1]!) < .00001) outside = Math.max(outside, Math.abs(px-points[at]!)-points[25]!, Math.abs(pz-points[at+2]!)-points[26]!);
        }
      }
      for (let side = 0; side < 2; side++) {
        gap = Math.max(gap, Math.abs(min[side]!-points[20+side*3]!));
        expect([B_FOOT_L,B_FOOT_R,B_TOE_L,B_TOE_R]).toContain(witness[side]);
      }
      samples++;
    }
  }
  expect(samples).toBe(1422); expect(worstResidual).toBeLessThan(.00001);
  expect(lowest).toBeGreaterThan(-.00001); expect(gap).toBeLessThan(.00001); expect(outside).toBeLessThan(.00001);
});

test("seated look and footwear changes invalidate calibration; missing data and absent sole opt-in preserve ankle fitting", () => {
  const rig = pack.header.rigs[0]!, rest = Float32Array.from(rig.rest), cache = new RiderSoles(), look = defaultLook();
  const bare = rig.soles!.find(s => !s.mesh.includes("armor"))!, boots = rig.soles!.find(s => s.mesh.includes("hide"))!;
  const a = cache.update(bare.points,rest,look)!.slice(), revision = cache.revision;
  cache.update(bare.points,rest,look); expect(cache.revision).toBe(revision);
  setRegion(look,15,1); const b = cache.update(bare.points,rest,look)!.slice(); expect(cache.revision).toBe(revision+1); expect(b).not.toEqual(a);
  const c = cache.update(boots.points,rest,look)!.slice(); expect(cache.revision).toBe(revision+2); expect(c).not.toEqual(b);
  expect(cache.update(null,rest,look)).toBeNull();
  const run = (points:Float64Array, offsets:Float64Array|null) => {
    const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES);
    mountPose(motion,{role:"ride",tick:0,startTick:0,durationTicks:1},pose); solve(HUMAN,pose,solved,rest);
    const error = fitRiderControls(pose,solved,rest,null,points,true,undefined,offsets); return {pose,solved,error};
  };
  const ankle = targets(); ankle[0]! &= ~RIDER_SOLES;
  expect(run(targets(),null).pose.rot).toEqual(run(ankle,c).pose.rot);
  const bad = targets(); bad[19] = 5;
  const rejected = run(bad,c); expect(rejected.error).toBe(Infinity);
  expect(rejected.solved.pos[B_FOOT_L*3+1]).toBeCloseTo(bad[8]!,5);
});

test("authoritative seated sole correction resolves real sex and worn content bindings and updates on equipment/look changes", () => {
  const reg = coreRegistry(), soles = new SeatedSoles(reg,pack.header.rigs), rec = new EntityRecord(1,reg.index.get("core:survivor")!), gear = new Uint16Array(GEAR_COUNT);
  rec.look = defaultLook();
  const a = soles.of(rec,gear)!.slice(); expect(a.length).toBe(6);
  gear[GEAR_WORN+SLOT_FEET] = reg.index.get("core:hide_boots")!;
  const b = soles.of(rec,gear)!.slice(); expect(b).not.toEqual(a);
  rec.look[LOOK_SEX] = 1; setRegion(rec.look,15,-1);
  const c = soles.of(rec,gear)!.slice(); expect(c).not.toEqual(b);
  const rig = pack.header.rigs.find(r => r.id === "human_f")!, rest = Float32Array.from(rig.rest), scale = new Float32Array(HUMAN_BONES*3), expected = new Float64Array(6);
  lookScales(rec.look,scale); soleOffsets(rig.soles!.find(s => s.mesh.includes("hide"))!.points,rest,scale,expected);
  expect(c).toEqual(expected);
  expect(new SeatedSoles(reg,[]).of(rec,gear)).toBeNull();
  const uncalibrated = structuredClone(pack.header.rigs);
  uncalibrated.find(r => r.id === "human_f")!.soles!.find(s => s.mesh.includes("hide"))!.points = [];
  expect(new SeatedSoles(reg,uncalibrated).of(rec,gear)).toBeNull();
});

test("seated ray capsules follow the shared sole correction while torso proportions remain canonical", () => {
  const rig = pack.header.rigs[0]!, rest = Float32Array.from(rig.rest), offsets = new Float64Array(6), points = targets();
  expect(soleOffsets(rig.soles![0]!.points,rest,null,offsets)).toBe(true);
  const anim = new HumanAnim(NO_CLIPS), st = new AnimState(), frame = new Float64Array([0,0,0,1,0,0,0,1,0,0,0,1]);
  let moved = 0;
  for (let y = .05; y < .45; y += .005) {
    const old = raySeated(anim,st,0,frame,true,.42,y,2,0,0,-1,4,0,points), oldT = zoneHit.t;
    const fitted = raySeated(anim,st,0,frame,true,.42,y,2,0,0,-1,4,0,points,0,offsets);
    if (old !== fitted || Math.abs(oldT-zoneHit.t) > .0001) moved++;
  }
  expect(moved).toBeGreaterThan(5);
  const oldTorso = raySeated(anim,st,0,frame,true,0,1.1,2,0,0,-1,4,0,points), oldT = zoneHit.t;
  expect(raySeated(anim,st,0,frame,true,0,1.1,2,0,0,-1,4,0,points,0,offsets)).toBe(oldTorso);
  expect(zoneHit.t).toBe(oldT); expect(oldTorso).not.toBe(0);
});
