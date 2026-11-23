// Every creature rig names its spine, neck, head, jaw, tail and legs (shared/anim/rig-sections.ts), and carries a live
// ragdoll beside its corpse's: hips and chest, neck, head, tail and the top of each leg, which goes limp without a fault.
import { expect } from "bun:test";
import { sampleClip } from "../../shared/anim/clip.ts";
import { Ragdoll } from "../../shared/anim/ragdoll.ts";
import { buildRigs, type Rig } from "../../shared/anim/rigs.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { CREATURE_ASSETS } from "../fixtures/assets.ts";
import { test } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { strider } from "../fixtures/strider.ts";
import { flatWorld } from "../fixtures/world.ts";

const DEG = Math.PI / 180;
const rigs = (): Map<string, Rig> => buildRigs(corePack().header.rigs, corePack().clips);

/** The parts of each creature in the core pack, by bone name, root first. */
const PARTS: Record<string, { spine: string; neck: string; head: string; jaw: string; tail: string; legs: string[] }> = {
  "core:brachio": {
    spine: "pelvis spine chest", neck: "neck_1 neck_2 neck_3 neck_4 neck_5", head: "skull", jaw: "", tail: "tail_1 tail_2 tail_3 tail_4 tail_5 tail_6 tail_7",
    legs: ["hind_upper_l hind_lower_l hind_ankle_l hind_foot_l", "hind_upper_r hind_lower_r hind_ankle_r hind_foot_r", "fore_upper_l fore_lower_l fore_ankle_l fore_foot_l", "fore_upper_r fore_lower_r fore_ankle_r fore_foot_r"],
  },
  "core:carbonemys": {
    spine: "shell", neck: "neck_1 neck_2 neck_3", head: "skull", jaw: "jaw", tail: "tail_1 tail_2",
    legs: ["fore_upper_l fore_lower_l fore_foot_l", "fore_upper_r fore_lower_r fore_foot_r", "hind_upper_l hind_lower_l hind_foot_l", "hind_upper_r hind_lower_r hind_foot_r"],
  },
  "core:dodo": {
    spine: "pelvis belly chest", neck: "neck_1 neck_2 neck_3 neck_4", head: "skull", jaw: "jaw", tail: "tail_1 tail_2",
    legs: ["thigh_l shin_l shank_l toes_l", "thigh_r shin_r shank_r toes_r"],
  },
  "core:parasaur": {
    spine: "pelvis chest", neck: "neck_1 neck_2", head: "skull", jaw: "jaw", tail: "tail_1 tail_2 tail_3 tail_4 tail_5",
    legs: ["upper_arm_l forearm_l manus_l", "upper_arm_r forearm_r manus_r", "thigh_l shank_l hock_l toes_l", "thigh_r shank_r hock_r toes_r"],
  },
  "core:pteranodon": {
    spine: "pelvis spine chest", neck: "neck_1 neck_2 neck_3 neck_4", head: "skull", jaw: "jaw", tail: "tail",
    legs: ["upper_arm_l forearm_l hand_l fingers_l", "upper_arm_r forearm_r hand_r fingers_r", "thigh_l shin_l foot_l toes_l", "thigh_r shin_r foot_r toes_r"],
  },
  "core:raptor": {
    spine: "Body Hips Torso Shoulders", neck: "Neck", head: "Head", jaw: "", tail: "Tail1 Tail2 Tail3 Tail4 Tail5",
    legs: ["BackUpLeg.L BackLowLeg.L BackFoot.L", "BackUpLeg.R BackLowLeg.R BackFoot.R", "FrontUpLeg.L FrontLowLeg.L FrontFoot.L", "FrontUpLeg.R FrontLowLeg.R FrontFoot.R"],
  },
  "core:rex": {
    spine: "pelvis spine chest", neck: "neck_1 neck_2", head: "skull", jaw: "jaw", tail: "tail_1 tail_2 tail_3 tail_4 tail_5 tail_6",
    legs: ["humerus_l forearm_l", "humerus_r forearm_r", "thigh_l shank_l metatarsus_l toes_l", "thigh_r shank_r metatarsus_r toes_r"],
  },
  "core:spino": {
    spine: "pelvis spine chest", neck: "neck_1 neck_2", head: "skull", jaw: "jaw", tail: "tail_1 tail_2 tail_3 tail_4 tail_5 tail_6 tail_7",
    legs: ["hind_upper_l hind_lower_l hind_ankle_l hind_foot_l", "hind_upper_r hind_lower_r hind_ankle_r hind_foot_r", "fore_upper_l fore_lower_l fore_ankle_l fore_foot_l", "fore_upper_r fore_lower_r fore_ankle_r fore_foot_r"],
  },
  "core:stego": {
    spine: "pelvis spine chest", neck: "neck_1 neck_2 neck_3", head: "skull", jaw: "jaw", tail: "tail_1 tail_2 tail_3 tail_4 tail_5 tail_6 tail_7",
    legs: ["hind_upper_l hind_lower_l hind_foot_l", "hind_upper_r hind_lower_r hind_foot_r", "fore_upper_l fore_lower_l fore_foot_l", "fore_upper_r fore_lower_r fore_foot_r"],
  },
  "core:trike": {
    spine: "body chest", neck: "neck", head: "skull", jaw: "jaw", tail: "tail_1 tail_2 tail_3 tail_tip",
    legs: ["front_upper_l front_lower_l front_foot_l front_toes_l front_pad_l", "front_upper_r front_lower_r front_foot_r front_toes_r front_pad_r", "back_upper_l back_lower_l back_foot_l back_toes_l back_pad_l", "back_upper_r back_lower_r back_foot_r back_toes_r back_pad_r"],
  },
};

/** A rig's parts by bone name, as PARTS writes them. */
function named(rig: Rig) {
  const s = rig.sections, n = (bones: readonly number[]): string => bones.map((b) => rig.names[b]).join(" ");
  return { spine: n(s.spine), neck: n(s.neck), head: s.head < 0 ? "" : rig.names[s.head]!, jaw: s.jaw < 0 ? "" : rig.names[s.jaw]!, tail: n(s.tail), legs: s.legs.map(n) };
}

test("every creature rig in the core pack names its spine, neck, head, jaw, tail and legs", () => {
  const all = rigs();
  const creatures = CREATURE_ASSETS.filter((a) => a.spec.kind === "creature").map((a) => a.id).filter((id) => all.has(id) && all.get(id)!.sections.head >= 0);
  expect(creatures.sort()).toEqual(Object.keys(PARTS).sort());
  for (const id of creatures) expect([id, named(all.get(id)!)]).toEqual([id, PARTS[id]!]);
  // Each chain runs root to tip, every bone the parent of the next.
  for (const id of creatures) {
    const rig = all.get(id)!, s = rig.sections;
    for (const chain of [s.spine, s.neck, s.tail, ...s.legs]) for (let k = 1; k < chain.length; k++) expect([id, rig.parent[chain[k]!]]).toEqual([id, chain[k - 1]!]);
    expect(rig.parent[s.neck[0]!]).toBe(s.spine[s.spine.length - 1]!);
    expect(rig.parent[s.head]).toBe(s.neck[s.neck.length - 1]!);
  }
});

test("a rig with no head, as a vehicle's, has no parts and no live ragdoll", () => {
  const all = rigs();
  const vehicles = [...all.values()].filter((r) => !PARTS[r.id]);
  expect(vehicles.length).toBeGreaterThan(0);
  for (const rig of vehicles) expect([rig.id, rig.sections.head, rig.sections.tail.length, rig.sections.legs.length, rig.live]).toEqual([rig.id, -1, 0, 0, null]);
});

test("a live ragdoll has the trunk, neck, head, tail and leg tops with capsules, and masses that sum to one", () => {
  const all = rigs();
  for (const rig of [...Object.keys(PARTS).map((id) => all.get(id)!), strider()]) {
    const live = rig.live!, s = rig.sections, capped = (b: number): boolean => rig.capR[b]! > 0;
    const trunk = s.spine.filter(capped);
    const want = new Set([trunk[0]!, trunk[trunk.length - 1]!, ...s.neck.filter(capped), ...[s.head].filter(capped), ...s.tail.filter(capped), ...s.legs.map((l) => l[0]!).filter(capped)]);
    expect([rig.id, [...live.bone].sort((a, b) => a - b)]).toEqual([rig.id, [...want].sort((a, b) => a - b)]);
    // The first body is the trunk, and every other hangs below it.
    expect(live.bone[0]).toBe(trunk[0]!);
    let sum = 0;
    for (const m of live.mass) sum += m;
    expect([rig.id, Math.abs(sum - 1) < 1e-9, [...live.mass].every((m) => m > 0)]).toEqual([rig.id, true, true]);
  }
  // A corpse still lies as its asset made it.
  for (const r of corePack().header.rigs.filter((r) => PARTS[r.id] && r.ragdoll)) {
    const rig = all.get(r.id)!, asset = r.ragdoll!.bodies.filter((b) => rig.capR[b.bone]! > 0);
    expect([r.id, [...rig.ragdoll!.bone], [...rig.ragdoll!.mass]]).toEqual([r.id, asset.map((b) => b.bone), asset.map((b) => b.mass)]);
  }
});

test("a whole neck turns about 70 degrees and a whole tail about 80, by their live limits", () => {
  const all = rigs();
  for (const id of Object.keys(PARTS)) {
    const rig = all.get(id)!, live = rig.live!, s = rig.sections;
    const turn = (bones: readonly number[]): number => bones.reduce((sum, b) => sum + (live.bone.includes(b) ? live.swing[live.bone.indexOf(b)]! : 0), 0) / DEG;
    const neck = s.neck.filter((b) => live.bone.includes(b)).length, tail = s.tail.filter((b) => live.bone.includes(b)).length;
    // One or two bodies make a short neck or tail: those reach no further than 35 and 40 degrees a body.
    if (neck >= 2) expect([id, turn(s.neck) >= 65 && turn(s.neck) <= 80]).toEqual([id, true]);
    if (tail >= 2) expect([id, Math.abs(turn(s.tail) - 80) < 1e-9]).toEqual([id, true]);
  }
});

test("each live ragdoll goes limp for 2 s on flat ground with no NaN and its limits holding", () => {
  const all = rigs(), w = flatWorld();
  for (const id of Object.keys(PARTS)) {
    const rig = all.get(id)!;
    const idle = rig.clips.get("idle");
    if (idle) sampleClip(idle, 0, rig.a);
    else rig.a.rest();
    const standing = new Solved(rig.bones);
    solve(rig, rig.a, standing);
    const d = new Ragdoll(rig, rig.live!);
    d.start(standing, standing, 64, 0, 64, 0.7, 1);
    let finite = true;
    for (let t = 0; t < 60; t++) {
      d.step(w, 1 / 30);
      for (const v of d.x) finite &&= Number.isFinite(v);
      for (const v of d.q) finite &&= Number.isFinite(v);
    }
    let past = 0;
    for (let i = 1; i < d.n; i++) {
      const [swing, twist] = d.bend(i);
      past = Math.max(past, swing - d.def.swing[i]!, twist - d.def.twist[i]!);
    }
    expect([id, finite, past < 2 * DEG, d.deepest(w) < 0.05]).toEqual([id, true, true, true]);
  }
});
