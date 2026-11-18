import { expect } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { readFileSync } from "node:fs";
import { TRIKE } from "../../content/creatures/trike.ts";
import { CreatureAnim, rayCreature } from "../../shared/anim/creature.ts";
import { ZONE_HEAD, ZONE_TORSO } from "../../shared/anim/human.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { TAU, detCos, detSin } from "../../shared/math/scalar.ts";
import { ACT_NONE, ACT_SWING } from "../../shared/sim/weapon.ts";
import { Pose, sampleClip } from "../../shared/anim/clip.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { Solved, boneToModel, solve } from "../../shared/anim/skeleton.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { fromArt, test } from "../fixtures/needs-art.ts";
import { writeBones } from "../../client/core/render/characters.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { Ragdoll } from "../../shared/anim/ragdoll.ts";
import { flatWorld } from "../fixtures/world.ts";

const pack = fromArt(() => parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/creatures/trike/trike.snpk", import.meta.url)))));
const rig = fromArt(() => buildRigs(pack.header.rigs, pack.clips).get("core:trike")!);
const species = TRIKE.find(d => d.type === "species") as SpeciesDef;

test("Trike's complete registered content compiles with its measured wild sprint and authored controls", () => {
  const compiled = compileContent(CORE_CONTENT);
  expect(compiled.errors).toEqual([]);
  expect(compiled.registry).not.toBeNull();
});

function contact(clip: string, frame: number): number[] {
  const pose = new Pose(rig.bones), solved = new Solved(rig.bones), out = new Float64Array(3);
  sampleClip(rig.clips.get(clip)!, frame, pose); solve(rig, pose, solved);
  const socket = rig.sockets.get("horn_contact")!;
  boneToModel(solved, socket.bone, socket.x, socket.y, socket.z, out);
  return [...out];
}

test("Trike's authored horn contacts remain in the server broad phase and strike ahead of the feet", () => {
  const attack = species.combat!.primary, clip = rig.clips.get(attack.clip)!;
  let low = Infinity, high = -Infinity;
  for (let frame = 0; frame < clip.frames; frame++) {
    const p = contact(attack.clip, frame);
    expect(Math.hypot(...p) + attack.radius).toBeLessThanOrEqual(attack.reach);
    if (frame >= attack.lands && frame <= attack.through) {
      expect(p[2]).toBeGreaterThan(2.5);
      low = Math.min(low, p[1]!); high = Math.max(high, p[1]!);
    }
  }
  expect(high - low).toBeGreaterThan(.15);
});

test("Trike lowers its horns during the real charge gait and finishes windup in that lowered posture", () => {
  const standing = contact("idle", 0), windup = rig.clips.get("charge_windup")!;
  const ready = contact("charge_windup", windup.frames - 1);
  expect(ready[1]).toBeLessThan(standing[1]! - .35);
  const charge = rig.clips.get("charge")!;
  for (let frame = 0; frame < charge.frames; frame++) {
    const p = contact("charge", frame);
    expect(p[1]).toBeGreaterThan(.65);
    expect(p[1]).toBeLessThan(standing[1]! - .30);
    expect(p[2]).toBeGreaterThan(2.5);
    expect(Math.hypot(...p) + species.combat!.charge!.attack.radius).toBeLessThanOrEqual(species.combat!.charge!.attack.reach);
  }
});

test("Trike's native front stance retains its ground contact while the body traverses the measured stride", () => {
  const foot = rig.names.indexOf("front_toes_l"), pose = new Pose(rig.bones), solved = new Solved(rig.bones);
  for (const [name, last] of [["walk", 18], ["run", 8], ["charge", 8]] as const) {
    const clip = rig.clips.get(name)!, stride = rig.strides.get(name)!;
    let first: number[] | null = null;
    for (let frame = 0; frame <= last; frame++) {
      sampleClip(clip, frame, pose); solve(rig, pose, solved);
      const p = [solved.pos[foot * 3]!, solved.pos[foot * 3 + 1]!, solved.pos[foot * 3 + 2]! + stride * frame / clip.frames];
      if (!first) first = p;
      expect(Math.hypot(...p.map((v, k) => v - first![k]!))).toBeLessThan(.02);
    }
  }
});

test("Trike exports all four actual plant and lift events for every grounded gait", () => {
  const pose = new Pose(rig.bones), solved = new Solved(rig.bones), point = new Float64Array(3);
  const feet = ["front_toes_l", "front_toes_r", "back_toes_l", "back_toes_r"];
  const sockets = ["foot_l", "foot_r", "rear_foot_l", "rear_foot_r"];
  for (const name of ["walk", "run", "charge"]) {
    const clip = rig.clips.get(name)!, rows = rig.footfalls.get(name);
    expect(rows?.length).toBe(4);
    expect(new Set(rows!.map(row => rig.names[row.bone]))).toEqual(new Set(feet));
    for (const row of rows!) {
      const socket = rig.sockets.get(sockets[feet.indexOf(rig.names[row.bone]!)]!)!;
      const height = (fraction: number): number => {
        sampleClip(clip, fraction * clip.frames, pose); solve(rig, pose, solved);
        boneToModel(solved, socket.bone, socket.x, socket.y, socket.z, point);
        return point[1]!;
      };
      // The event follows the authored sole touchdown, not the joint's
      // maximum-forward point. Fractional event phases interpolate between
      // the native 30 Hz samples, leaving up to a centimetre of swing height.
      expect(Math.abs(height(row.plant))).toBeLessThan(.012);
      expect(Math.abs(height(row.lift))).toBeLessThan(.012);
      const swing = (row.plant - row.lift + 1) % 1;
      expect(height((row.lift + swing * .5) % 1)).toBeGreaterThan(.12);
    }
  }
});

test("Trike enters and leaves torpor from the actual planted standing feet", () => {
  const pose = new Pose(rig.bones), solved = new Solved(rig.bones), point = new Float64Array(3);
  const sockets = ["foot_l", "foot_r", "rear_foot_l", "rear_foot_r"];
  const positions = (name: string, frame: number): number[][] => {
    sampleClip(rig.clips.get(name)!, frame, pose); solve(rig, pose, solved);
    return sockets.map(name => {
      const socket = rig.sockets.get(name)!;
      boneToModel(solved, socket.bone, socket.x, socket.y, socket.z, point);
      return [...point];
    });
  };
  const standing = positions("idle", 0);
  for (const [name, frame] of [["torpor_in", 0], ["torpor_out", rig.clips.get("torpor_out")!.frames - 1]] as const) {
    for (const [index, p] of positions(name, frame).entries()) {
      expect(Math.hypot(...p.map((v, axis) => v - standing[index]![axis]!))).toBeLessThan(.003);
    }
  }
});

test("Trike's actual native skin clears the floor throughout collapse, unconscious rest and recovery", () => {
  const mesh = unpackMeshes(pack).find(m => m.id === "core:trike")!.lods[0]!;
  const pose = new Pose(rig.bones), solved = new Solved(rig.bones), matrices = new Float32Array(rig.bones * 12);
  for (const name of ["torpor_in", "torpor_idle", "torpor_out", "death"]) {
    const clip = rig.clips.get(name)!;
    for (let frame = 0; frame < clip.frames; frame++) {
      sampleClip(clip, frame, pose); solve(rig, pose, solved);
      writeBones(matrices, 0, solved, rig.rest, null, 0, 0, 0, 0);
      let lowest = Infinity;
      for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
        let y = 0;
        for (let k = 0; k < 4; k++) {
          const at = mesh.joints![vertex * 4 + k]! * 12 + 4;
          y += mesh.weights![vertex * 4 + k]! * (matrices[at]! * mesh.positions[vertex * 3]! + matrices[at + 1]! * mesh.positions[vertex * 3 + 1]! + matrices[at + 2]! * mesh.positions[vertex * 3 + 2]! + matrices[at + 3]!);
        }
        lowest = Math.min(lowest, y);
      }
      // The authored sole plane quantizes slightly either side of zero.
      // This is under a millimetre in the measured pack; 3mm catches an
      // actual folded limb or tail entering the floor without a golden pose.
      expect(lowest).toBeGreaterThanOrEqual(-.003);
    }
  }
});

test("Trike's authored surface swim keeps the nostrils above its buoyant waterline", () => {
  const pose = new Pose(rig.bones), solved = new Solved(rig.bones), point = new Float64Array(3);
  for (const name of ["swim", "swim_idle"]) {
    const clip = rig.clips.get(name)!;
    for (let frame = 0; frame < clip.frames; frame++) {
      sampleClip(clip, frame, pose); solve(rig, pose, solved);
      for (const socketName of ["breath_l", "breath_r"]) {
        const socket = rig.sockets.get(socketName)!;
        boneToModel(solved, socket.bone, socket.x, socket.y, socket.z, point);
        expect(point[1]! - species.swimDepth!).toBeGreaterThan(.18);
        expect(point[1]).toBeGreaterThanOrEqual(species.swimEyeHeight!);
      }
    }
  }
});

test("Trike's actual foot and tail skin remain above flat terrain after a native limp drop", () => {
  const mesh = unpackMeshes(pack).find(m => m.id === "core:trike")!.lods[0]!;
  const before = new Solved(rig.bones), solved = new Solved(rig.bones);
  const pose = new Pose(rig.bones), matrices = new Float32Array(rig.bones * 12);
  const death = rig.clips.get("death")!, world = flatWorld();
  sampleClip(death, rig.ragdoll!.limp - 1, pose); solve(rig, pose, before);
  sampleClip(death, rig.ragdoll!.limp, pose); solve(rig, pose, solved);
  const doll = new Ragdoll(rig, rig.ragdoll!);
  doll.start(solved, before, 64, 3, 64, 0, 1);
  for (let tick = 0; tick < 360; tick++) {
    doll.step(world, 1 / 60);
    if (tick % 15 !== 14) continue;
    doll.pose(solved); writeBones(matrices, 0, solved, rig.rest, null, 0, 3, 0, 0);
    let lowest = Infinity;
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
      let y = 0;
      for (let k = 0; k < 4; k++) {
        const at = mesh.joints![vertex * 4 + k]! * 12 + 4;
        y += mesh.weights![vertex * 4 + k]! * (matrices[at]! * mesh.positions[vertex * 3]! + matrices[at + 1]! * mesh.positions[vertex * 3 + 1]! + matrices[at + 2]! * mesh.positions[vertex * 3 + 2]! + matrices[at + 3]!);
      }
      lowest = Math.min(lowest, y);
    }
    // Actual skinned vertices catch an unprotected toe/heel or inappropriate
    // shin influence even when every physics capsule itself clears terrain.
    expect(lowest).toBeGreaterThanOrEqual(-.003);
  }
  expect(doll.awake).toBe(false);
});

test("Trike airway witnesses lie in the actual open nares rather than inside the hide or on its rotating rim", () => {
  expect(pack.header.rigs[0]!.breath).toEqual(["breath_l", "breath_r"]);
  expect(rig.breath).toEqual([rig.sockets.get("breath_l")!, rig.sockets.get("breath_r")!]);
  const mesh = unpackMeshes(pack).find(m => m.id === "core:trike")!.lods[0]!;
  const pose = new Pose(rig.bones), solved = new Solved(rig.bones), point = new Float64Array(3);
  solve(rig, pose, solved);
  for (const name of ["breath_l", "breath_r"]) {
    const socket = rig.sockets.get(name)!;
    boneToModel(solved, socket.bone, socket.x, socket.y, socket.z, point);
    const sign = point[0]! > 0 ? 1 : -1;
    let inward = Infinity, outward = Infinity;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i]! * 3, b = mesh.indices[i + 1]! * 3, c = mesh.indices[i + 2]! * 3, p = mesh.positions;
      const det = (p[b + 2]! - p[c + 2]!) * (p[a + 1]! - p[c + 1]!) + (p[c + 1]! - p[b + 1]!) * (p[a + 2]! - p[c + 2]!);
      if (Math.abs(det) < 1e-10) continue;
      const w0 = ((p[b + 2]! - p[c + 2]!) * (point[1]! - p[c + 1]!) + (p[c + 1]! - p[b + 1]!) * (point[2]! - p[c + 2]!)) / det;
      const w1 = ((p[c + 2]! - p[a + 2]!) * (point[1]! - p[c + 1]!) + (p[a + 1]! - p[c + 1]!) * (point[2]! - p[c + 2]!)) / det;
      const w2 = 1 - w0 - w1;
      if (Math.min(w0, w1, w2) < 0) continue;
      const delta = (w0 * p[a]! + w1 * p[b]! + w2 * p[c]! - point[0]!) * sign;
      if (delta < 0) inward = Math.min(inward, -delta);
      else outward = Math.min(outward, delta);
    }
    // The authored recess has a real wall roughly 8 cm inward and an open
    // outward ray. This catches a witness buried in solid facial triangles.
    expect(inward).toBeGreaterThan(.05);
    expect(inward).toBeLessThan(.13);
    expect(outward).toBeGreaterThan(.08);
  }
});

test("Trike's open corneas remain visible through the native orbital skin", () => {
  const mesh = unpackMeshes(pack).find(m => m.id === "core:trike")!.lods[0]!;
  for (const side of ["l", "r"]) {
    const eye = rig.names.indexOf(`eye_${side}`), sign = side === "l" ? 1 : -1;
    for (const along of [-.02, 0, .02]) {
      const y = rig.rest[eye * 3 + 1]!, z = rig.rest[eye * 3 + 2]! + along;
      let outer = -Infinity, triangle = -1;
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const a = mesh.indices[t]! * 3, b = mesh.indices[t + 1]! * 3, c = mesh.indices[t + 2]! * 3, p = mesh.positions;
        const ey = p[b + 1]! - p[a + 1]!, ez = p[b + 2]! - p[a + 2]!;
        const fy = p[c + 1]! - p[a + 1]!, fz = p[c + 2]! - p[a + 2]!, det = ey * fz - ez * fy;
        if (Math.abs(det) < 1e-10) continue;
        const dy = y - p[a + 1]!, dz = z - p[a + 2]!;
        const u = (dy * fz - dz * fy) / det, v = (ey * dz - ez * dy) / det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const x = sign * (p[a]! + u * (p[b]! - p[a]!) + v * (p[c]! - p[a]!));
        if (x > outer) { outer = x; triangle = t; }
      }
      expect(triangle).toBeGreaterThanOrEqual(0);
      // This caught the actual jugal surface concealing an otherwise valid
      // eyeball. A visible side ray must reach the cornea before cheek/frill.
      for (let k = 0; k < 3; k++) {
        const vertex = mesh.indices[triangle + k]!;
        let influence = 0;
        for (let j = 0; j < 4; j++) if (mesh.joints![vertex * 4 + j] === eye) influence += mesh.weights![vertex * 4 + j]!;
        expect(influence).toBeGreaterThan(.99);
      }
      expect(outer - sign * rig.rest[eye * 3]!).toBeGreaterThan(.015);
      expect(outer - sign * rig.rest[eye * 3]!).toBeLessThan(.045);
    }
  }
});


for (const frame of [89, 90, 91]) test(`Trike's eyelids cover both native irises at blink frame ${frame}`, () => {
  const mesh = unpackMeshes(pack).find(m => m.id === "core:trike")!.lods[0]!;
  const pose = new Pose(rig.bones), solved = new Solved(rig.bones);
  sampleClip(rig.clips.get("idle")!, frame, pose); solve(rig, pose, solved);
  const matrices = new Float32Array(rig.bones * 12), positions = new Float32Array(mesh.positions.length);
  writeBones(matrices, 0, solved, rig.rest, null, 0, 0, 0, 0);
  for (let vertex = 0; vertex < positions.length / 3; vertex++) for (let axis = 0; axis < 3; axis++) {
    let value = 0;
    for (let k = 0; k < 4; k++) {
      const at = mesh.joints![vertex * 4 + k]! * 12 + axis * 4;
      value += mesh.weights![vertex * 4 + k]! * (matrices[at]! * mesh.positions[vertex * 3]! + matrices[at + 1]! * mesh.positions[vertex * 3 + 1]! + matrices[at + 2]! * mesh.positions[vertex * 3 + 2]! + matrices[at + 3]!);
    }
    positions[vertex * 3 + axis] = value;
  }
  for (const side of ["l", "r"]) {
    const eye = rig.names.indexOf(`eye_${side}`), lid = rig.names.indexOf(`lid_${side}`), sign = side === "l" ? 1 : -1;
    const point = new Float64Array(3);
    for (let row = -3; row <= 3; row++) for (let col = -5; col <= 5; col++) {
      boneToModel(solved, eye, 0, row * .005, col * .006, point);
      const y = point[1]!, z = point[2]!;
      let outer = -Infinity, triangle = -1;
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const a = mesh.indices[t]! * 3, b = mesh.indices[t + 1]! * 3, c = mesh.indices[t + 2]! * 3, p = positions;
        const ey = p[b + 1]! - p[a + 1]!, ez = p[b + 2]! - p[a + 2]!;
        const fy = p[c + 1]! - p[a + 1]!, fz = p[c + 2]! - p[a + 2]!, det = ey * fz - ez * fy;
        if (Math.abs(det) < 1e-10) continue;
        const py = y - p[a + 1]!, pz = z - p[a + 2]!, u = (py * fz - pz * fy) / det, v = (ey * pz - ez * py) / det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const x = sign * (p[a]! + u * (p[b]! - p[a]!) + v * (p[c]! - p[a]!));
        if (x > outer) { outer = x; triangle = t; }
      }
      expect(triangle).toBeGreaterThanOrEqual(0);
      let cover = 0, cornea = 0;
      for (let k = 0; k < 3; k++) for (let j = 0; j < 4; j++) {
        const at = mesh.indices[triangle + k]! * 4 + j;
        if (mesh.joints![at] === lid) cover += mesh.weights![at]!;
        if (mesh.joints![at] === eye) cornea += mesh.weights![at]!;
      }
      // Excess rotation previously drove the lid back through the globe,
      // reopening the iris at the very peak while earlier frames looked shut.
      expect(cover).toBeGreaterThan(.1);
      expect(cornea).toBeLessThan(.01);
    }
  }
});

test("Trike armour follows the visible frill and cheek, leaving the neighbouring gaps open through a horn strike", () => {
  const anim = new CreatureAnim(rig, 2.5, species.swimSpeed!, species.combat!);
  const state = new AnimState();
  state.grounded = true;
  // First-skin samples from the native finest triangles. Each empty ray was
  // previously intercepted by the uniform-radius horn or frill contact.
  const probes = [
    { tick: 0, x: -1.05, y: 2.60, z: 10, zone: ZONE_HEAD },
    { tick: 0, x: -.50, y: 1.55, z: 10, zone: ZONE_HEAD },
    { tick: 0, x: -.90, y: 2.90, z: 10, zone: 0 },
    // During the sweep the scalloped shield crosses 2.70 m. The ray at
    // 2.80 m clears the shield and hits the raised ribcage behind it.
    { tick: 4, x: -.25, y: 2.70, z: 10, zone: ZONE_HEAD },
    { tick: 4, x: -.25, y: 2.80, z: 10, zone: ZONE_TORSO },
    { tick: 4, x: -.90, y: 2.70, z: 10, zone: 0 },
    { tick: 7, x: .75, y: 1.55, z: 10, zone: ZONE_HEAD },
    { tick: 10, x: -.40, y: 2.90, z: 10, zone: ZONE_HEAD },
    { tick: 10, x: -.40, y: 3.00, z: 10, zone: 0 },
    { tick: 0, x: .60, y: 2.20, z: -10, zone: ZONE_TORSO },
  ];
  for (const p of probes) for (const size of [.25, .6, 1]) for (const yaw of [0, 8192, 16384]) {
    state.setAction(p.tick ? ACT_SWING : ACT_NONE, 0, 0);
    const angle = yaw * TAU / 65536, c = detCos(angle), s = detSin(angle), dir = -Math.sign(p.z);
    const x = (c * p.x + s * p.z) * size, z = (c * p.z - s * p.x) * size;
    // The authority brings a world ray into model metres before rayCreature.
    const hit = rayCreature(anim, state, p.tick, 0, 0, 0, yaw, x / size, p.y, z / size, s * dir, 0, c * dir, 15 / size, 0, undefined, size);
    expect([p.tick, p.x, size, yaw, hit]).toEqual([p.tick, p.x, size, yaw, p.zone]);
  }
  expect(species.zones!.head).toBe(.2);
});
