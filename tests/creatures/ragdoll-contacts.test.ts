import { expect, test } from "bun:test";
import { NO_CLIPS, Pose } from "../../shared/anim/clip.ts";
import { Ragdoll } from "../../shared/anim/ragdoll.ts";
import { buildRig, type Rig } from "../../shared/anim/rigs.ts";
import { solve, Solved } from "../../shared/anim/skeleton.ts";
import { quatRotate } from "../../shared/math/quat.ts";
import { parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { slopeKind } from "../../content/slopes.ts";
import type { CreatureAsset } from "../../tools/art/spec.ts";
import { withMotion } from "../../tools/pack/creature.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

function raw(spread = .6): PackRig {
  const rig: PackRig = { id: "test:compound", skeleton: "compound", names: ["body"], parent: [-1], rest: [0, 1, 0], caps: [0, 1, 0, 0, 0, 0, 0, 0, .25],
    ragdoll: { limp: 0, bodies: [{ bone: 0, mass: 1, swing: 0, twist: 0 }], contacts: [] } };
  for (const x of [-spread, spread]) for (const z of [-.6, .6]) {
    const bone = rig.names!.length;
    rig.names!.push(`contact${bone}`); rig.parent!.push(0); rig.rest.push(x, .15, z);
    rig.caps!.push(bone, 1, 0, 0, 0, 0, 0, 0, .08); rig.ragdoll!.contacts!.push(bone);
  }
  return rig;
}
function drop(rig: Rig, height = .2, yaw = 0, size = 1) {
  const pose = new Pose(rig.bones), solved = new Solved(rig.bones);
  solve(rig, pose, solved);
  const doll = new Ragdoll(rig, rig.ragdoll!);
  doll.start(solved, solved, 64, height, 64, yaw, size);
  return doll;
}
function rest(d: Ragdoll, w: TestWorld, seconds = 3): number {
  for (let f = 1; f <= seconds * 60; f++) if (!d.step(w, 1 / 60)) return f / 60;
  return -1;
}

test("rigid child capsules support a body without extra masses and retain native distances at both sizes", () => {
  for (const size of [.5, 1]) for (const yaw of [0, 1.1, 2.4]) {
    const rig = buildRig(raw(), NO_CLIPS)!, d = drop(rig, .2, yaw, size), w = flatWorld();
    expect(d.n).toBe(1);
    expect(rest(d, w)).toBeGreaterThan(0);
    expect(d.deepest(w)).toBeLessThan(.001);
    expect(d.x[1]!).toBeGreaterThan(.85 * size);
    const solved = new Solved(rig.bones); d.pose(solved);
    for (let b = 1; b < rig.bones; b++) {
      expect(Math.hypot(...[0, 1, 2].map(a => solved.pos[b * 3 + a]! - solved.pos[a]!))).toBeCloseTo(Math.hypot(rig.rest[b * 3]!, rig.rest[b * 3 + 1]! - 1, rig.rest[b * 3 + 2]!), 5);
      // pose() returns native local coordinates; the original placement adds .2.
      expect(.2 + solved.pos[b * 3 + 1]! * size).toBeCloseTo(.08 * size, 3);
    }
  }
});

test("absent and empty contact metadata preserve the same legacy trajectory", () => {
  const a = raw(), b = raw(); delete a.ragdoll!.contacts; b.ragdoll!.contacts = [];
  const da = drop(buildRig(a, NO_CLIPS)!), db = drop(buildRig(b, NO_CLIPS)!), w = flatWorld();
  for (let f = 0; f < 180; f++) {
    expect(da.step(w, 1 / 60)).toBe(db.step(w, 1 / 60));
    expect(da.x).toEqual(db.x); expect(da.q).toEqual(db.q);
  }
  expect(da.x[1]!).toBeLessThan(.3);
});

test("offset contacts gather their supporting structures and wake when those supports disappear", () => {
  const rig = buildRig(raw(2.2), NO_CLIPS)!, w = flatWorld(), ceiling = w.kind("core:ceiling_wood");
  const refs = [-2.2, 2.2].map(x => w.structs.add(ceiling, 64 + x, 2.5, 64, 0, 0, 1));
  const d = drop(rig, 2.6);
  expect(rest(d, w)).toBeGreaterThan(0); expect(d.deepest(w)).toBeLessThan(.001);
  expect(d.x[1]!).toBeGreaterThan(3.3);
  for (const ref of refs) w.structs.remove(ref);
  expect(d.step(w, 1 / 60)).toBe(true);
  expect(rest(d, w)).toBeGreaterThan(0);
  expect(d.x[1]!).toBeLessThan(1); expect(d.deepest(w)).toBeLessThan(.001);
});

test("rigid contact lever arms rotate the body onto terrain and convex ramps without stretching", () => {
  for (const kind of ["terrain", "ramp"] as const) for (const yaw of [.4, 1.4, 2.4]) {
    const rig = buildRig(raw(), NO_CLIPS)!, w = flatWorld();
    if (kind === "terrain") {
      for (let z = 0; z < w.hf.nz; z++) for (let x = 0; x < w.hf.nx; x++) w.hf.setSample(x, z, (z * w.hf.cell - 64) / 3);
    } else w.structs.add(w.kind(slopeKind("ramp")), 64, 1.5, 64, 0, 0, 1);
    const d = drop(rig, kind === "terrain" ? .4 : 2.4, yaw);
    expect(rest(d, w)).toBeGreaterThan(0); expect(d.deepest(w)).toBeLessThan(.005);
    expect(Math.hypot(d.q[0]!, d.q[2]!)).toBeGreaterThan(.08);
  }
});

test("rigid child capsule placement includes the handover pose rotation and scales its full lever arm", () => {
  const source = raw(); source.caps![12] = -.3; source.caps![15] = .3;
  const rig = buildRig(source, NO_CLIPS)!, pose = new Pose(rig.bones), solved = new Solved(rig.bones), out = new Solved(rig.bones);
  pose.rot[2] = Math.sin(.2); pose.rot[3] = Math.cos(.2);
  pose.rot[4] = Math.sin(.35); pose.rot[7] = Math.cos(.35); solve(rig, pose, solved);
  const d = new Ragdoll(rig, rig.ragdoll!); d.start(solved, solved, 64, 0, 64, .7, .5); d.pose(out);
  for (let i = 0; i < solved.pos.length; i++) expect(out.pos[i]).toBeCloseTo(solved.pos[i]!, 5);
  // An explicitly tilted lower contact penetrates the flat ground at handover;
  // deepest() must see it even though the central body capsule is above it.
  const rotated = new Float64Array(3); let expected = 0;
  for (let b = 1; b < rig.bones; b++) for (const point of [rig.capA, rig.capB]) {
    quatRotate(solved.rot, b * 4, point[b * 3]!, point[b * 3 + 1]!, point[b * 3 + 2]!, rotated, 0);
    expected = Math.max(expected, (rig.capR[b]! - solved.pos[b * 3 + 1]! - rotated[1]!) * .5);
  }
  expect(expected).toBeGreaterThan(0);
  expect(d.deepest(flatWorld())).toBeCloseTo(expected, 6);
});

test("an offset contact applies its moment to the nearest articulated ancestor", () => {
  const rig = buildRig({ id: "test:owner", skeleton: "owner", names: ["root", "arm", "tip"], parent: [-1, 0, 1], rest: [0, 2, 0, 1, 2, 0, 2, 0, 0],
    caps: [0, 1, 0, 0, 0, 0, 0, 0, .1, 1, 1, 0, 0, 0, 0, 0, 0, .1, 2, 1, 0, 0, 0, 0, 0, 0, .2],
    ragdoll: { limp: 0, bodies: [{ bone: 0, mass: 1, swing: 0, twist: 0 }, { bone: 1, mass: .2, swing: 90, twist: 90 }], contacts: [2] } }, NO_CLIPS)!;
  const d = drop(rig, 0); d.step(flatWorld(), 1 / 240);
  expect(d.n).toBe(2);
  expect(Math.hypot(d.q[0]!, d.q[1]!, d.q[2]!)).toBeLessThan(1e-10);
  expect(Math.hypot(d.q[4]!, d.q[5]!, d.q[6]!)).toBeGreaterThan(.0001);
});

test("the native contact contract rejects missing, duplicated, articulated and unattached capsules", () => {
  const rig = raw();
  const spec: CreatureAsset = { kind: "creature", source: { scripts: [] }, scale: 1, skeleton: { id: "compound", root: "body" }, regions: [], materials: {}, zones: [], sockets: [], clips: [], feet: [], gaits: {}, budgets: { triangles: [32] },
    ragdoll: { bodies: [{ bone: "body", mass: 1 }], contacts: ["contact1", "contact2"] } };
  const faults: string[] = [], packed = withMotion(rig, spec, [], faults);
  expect(faults).toEqual([]); expect(packed.ragdoll!.contacts).toEqual([1, 2]);
  const roundtrip = parsePack(buildPack([], defaultPalette(), [], [packed]));
  expect(roundtrip.header.rigs[0]!.ragdoll!.contacts).toEqual([1, 2]);
  expect(buildRig(packed, NO_CLIPS)!.ragdoll!.contacts).toEqual(new Int16Array([1, 2]));
  for (const contacts of [["missing"], ["contact1", "contact1"], ["body"]]) {
    const bad: string[] = []; withMotion(rig, { ...spec, ragdoll: { ...spec.ragdoll!, contacts } }, [], bad);
    expect(bad.length).toBeGreaterThan(0);
  }
  const detached = { ...rig, parent: [-1, -1, 0, 0, 0] }, bad: string[] = [];
  withMotion(detached, spec, [], bad); expect(bad.length).toBeGreaterThan(0);
  const tooMany: string[] = [];
  withMotion(rig, { ...spec, ragdoll: { ...spec.ragdoll!, contacts: Array(17).fill("contact1") } }, [], tooMany);
  expect(tooMany.some(f => f.includes("more than 16"))).toBe(true);
});

test("an authored mass centre survives the native pack and malformed metadata falls back to the capsule midpoint", () => {
  const source = raw();
  const body = { bone: "body", mass: 1, massCentre: [.375, -.125, .25] as const };
  const spec: CreatureAsset = { kind: "creature", source: { scripts: [] }, scale: 1, skeleton: { id: "compound", root: "body" }, regions: [], materials: {}, zones: [], sockets: [], clips: [], feet: [], gaits: {}, budgets: { triangles: [32] }, ragdoll: { bodies: [body] } };
  const faults: string[] = [], packed = withMotion(source, spec, [], faults);
  const decoded = parsePack(buildPack([], defaultPalette(), [], [packed])).header.rigs[0]!;
  expect(faults).toEqual([]);
  expect(buildRig(decoded, NO_CLIPS)!.ragdoll!.massCentres).toEqual([body.massCentre]);
  for (const malformed of [[1, 2], [1, 2, 3, 4], [0, NaN, 0], [Infinity, 0, 0], [0, "1", 0], Array(3)]) {
    const massCentre = malformed as unknown as typeof body.massCentre;
    const bad: string[] = [];
    withMotion(source, { ...spec, ragdoll: { bodies: [{ ...body, massCentre }] } }, [], bad);
    expect(bad.some(message => message.includes("mass centre"))).toBe(true);
    decoded.ragdoll!.bodies[0]!.massCentre = massCentre;
    expect(buildRig(decoded, NO_CLIPS)!.ragdoll!.massCentres).toBeUndefined();
  }
});

test("offset mass changes torque while preserving the posed skin joints and every collision capsule at handover", () => {
  for (const contacts of [false, true]) for (const size of [.5, 1.25]) for (const yaw of [0, 1.2]) {
    const a = raw();
    a.caps!.splice(2, 6, -.125, -.625, 0, .375, -.375, .125);
    if (!contacts) delete a.ragdoll!.contacts;
    const b = structuredClone(a);
    b.ragdoll!.bodies[0]!.massCentre = [.7, -.3, -.65];
    const ar = buildRig(a, NO_CLIPS)!, br = buildRig(b, NO_CLIPS)!;
    const da = drop(ar, -.35, yaw, size), db = drop(br, -.35, yaw, size);
    expect(db.n).toBe(da.n);
    expect(Math.hypot(db.x[0]! - da.x[0]!, db.x[2]! - da.x[2]!)).toBeGreaterThan(.35);
    const pa = new Solved(ar.bones), pb = new Solved(br.bones);
    da.pose(pa); db.pose(pb);
    for (let j = 0; j < pa.pos.length; j++) expect(pb.pos[j]).toBeCloseTo(pa.pos[j]!, 6);
    expect(pb.rot).toEqual(pa.rot);
    const w = flatWorld();
    expect(db.deepest(w)).toBeCloseTo(da.deepest(w), 7);
    w.structs.add(w.kind("core:ceiling_wood"), 64, (contacts ? .15 : .5) * size - .35, 64, 0, 0, 1);
    expect(da.deepest(w)).toBeGreaterThan(0);
    expect(db.deepest(w)).toBeCloseTo(da.deepest(w), 7);
    da.step(w, 1 / 60); db.step(w, 1 / 60);
    expect(db.q).not.toEqual(da.q);
  }
});

test("explicit capsule midpoint and legacy midpoint produce the same compound trajectory", () => {
  const a = raw(); a.caps!.splice(2, 6, -.25, -.125, -.5, .75, .375, .5);
  const b = structuredClone(a); b.ragdoll!.bodies[0]!.massCentre = [.25, .125, 0];
  const da = drop(buildRig(a, NO_CLIPS)!, .3, .7, .6), db = drop(buildRig(b, NO_CLIPS)!, .3, .7, .6), w = flatWorld();
  for (let f = 0; f < 180; f++) {
    expect(db.step(w, 1 / 60)).toBe(da.step(w, 1 / 60));
    expect(db.x).toEqual(da.x); expect(db.q).toEqual(da.q);
  }
});
