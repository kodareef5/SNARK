// Registered content and native rigs, rather than a surrogate species with changed dimensions.
import { expect, test } from "bun:test";
import { artTest } from "../fixtures/needs-art.ts";
import { CreatureAnim, creaturePose } from "../../shared/anim/creature.ts";
import { AnimState, CUE_LAND, CUE_NONE, CUE_STARTLE, CUE_TORPOR, LAYER_EAT, LAYER_FLINCH, LAYER_NONE } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { youngScale } from "../../shared/sim/breeding.ts";
import { BTN_JUMP, BTN_PRIMARY, BTN_SECONDARY, MODE_SWIM, MODE_WALK } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { ACT_NONE } from "../../shared/sim/weapon.ts";
import { V_OXYGEN, V_TORPOR } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { dinosaurCourse, DINOSAUR_COURSE } from "../../tools/dinosaurs/course.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

for (const species of ["trike", "stego"]) {
  test(`native ${species} floats at its authored depth, replays diving, cancels attacks in water and loses oxygen when submerged unconscious`, () => {
    const h = new Harness({}, 1, 60, { dev: true, map: writeMap(dinosaurCourse()) });
    try {
      const ada = h.join("ada"); h.run(300); h.say(ada, "enablecheats"); h.say(ada, "tp 108 92");
      const client = h.client(ada)!, owner = h.host.records.byPid.get(client.pid)!, ents = h.world.ents;
      h.host.survival.gods.add(owner.pid);
      const e = h.host.spawnCreature(`core:${species}`, 110, 92, 1);
      expect(e).toBeGreaterThanOrEqual(0);
      const rec = h.host.records.byPid.get(ents.pid[e]!)!, move = h.reg.move[rec.kind]!, sv = h.host.survival;
      expect(move.swimDepth).toBeDefined();
      expect((move.swimEyeHeight ?? move.eyeHeight) - move.swimDepth!).toBeGreaterThan(.05);
      rec.genome!.wild.fill(0); rec.genome!.tamed.fill(0); sv.init(rec);
      expect(h.host.taming.give(rec, owner, 0, "forced")).toBe(true);
      rec.saddle = h.reg.index.get(`core:saddle_${species}`)!; h.host.refreshBody(rec);
      h.host.creatures.claimed(e); h.host.creatures.mind.stay(e, 0xffffffff);
      expect(h.host.riding.mount(client, e)).toBe(RESULT_OK); h.run(300);
      const pilot = h.pilots[0]!;
      pilot.buttons = BTN_JUMP; h.run(200); pilot.buttons = 0;
      expect(ents.flags[e]! & F_GROUNDED).not.toBe(0);
      expect(ents.vy[e]).toBe(0);
      ents.flags[e] = ents.flags[e]! & ~F_GROUNDED; ents.mode[e] = MODE_WALK;
      ents.setPosition(e, DINOSAUR_COURSE.pool.x, -3, DINOSAUR_COURSE.pool.z);
      ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
      h.run(1000);
      const corrections = ada.stats.corrections + ada.stats.stateCorrections;
      pilot.buttons = BTN_JUMP; h.run(2200); pilot.buttons = 0;
      expect(ents.mode[e]).toBe(MODE_SWIM);
      expect(ents.y[e]).toBeCloseTo(-move.swimDepth!, 3);
      pilot.buttons = BTN_PRIMARY | BTN_SECONDARY; h.run(300); pilot.buttons = 0;
      expect(ents.act[e]).toBe(ACT_NONE);
      pilot.moveZ = 1; pilot.pitch = -.8; h.run(900);
      expect(ents.y[e]! + (move.swimEyeHeight ?? move.eyeHeight)).toBeLessThan(0);
      pilot.moveZ = 0; pilot.pitch = 0; pilot.buttons = BTN_JUMP; h.run(2200);
      pilot.buttons = 0; h.run(500);
      expect(ada.stats.corrections + ada.stats.stateCorrections).toBe(corrections);
      expect(Math.abs(ada.own.y - ents.y[e]!)).toBeLessThan(.001);
      expect(ents.y[e]).toBeCloseTo(-move.swimDepth!, 3);
      const breathing = sv.value(rec, V_OXYGEN); h.run(3000);
      expect(sv.value(rec, V_OXYGEN)).toBeGreaterThanOrEqual(breathing);
      sv.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1); h.run(300);
      expect(rec.out).toBe(true);
      expect(client.drive).toBe(-1);
      ents.setPosition(e, DINOSAUR_COURSE.pool.x, -3, DINOSAUR_COURSE.pool.z);
      const submerged = sv.value(rec, V_OXYGEN); h.run(4000);
      expect(sv.value(rec, V_OXYGEN)).toBeLessThan(submerged - 5);
    } finally { h.host.shutdown(); }
  });

  artTest(`native ${species} measured nostril remains clear through every awake water reaction and layer`, () => {
    const pack = corePack(), reg = coreRegistry(), kind = reg.index.get(`core:${species}`)!, move = reg.move[kind]!;
    const rig = buildRigs(pack.header.rigs, pack.clips).get(`core:${species}`)!;
    // Native opt-in is mandatory for these two registered species. A merely named but unbound socket would leave
    // the server using its legacy eye during KO/recovery, despite this geometric diagnostic appearing to pass.
    expect(rig.breath?.length).toBe(2);
    const sockets = rig.breath!;
    expect(move.swimDepth).toBeDefined();
    const anim = new CreatureAnim(rig, reg.runAt[kind]!, move.swimSpeed, reg.combat[kind]), st = new AnimState(), point = new Float64Array(3);
    st.mode = MODE_SWIM; st.grounded = false; st.cueStart = st.layerStart = 100;
    for (const speed of [0, move.swimSpeed]) for (const cue of [CUE_NONE, CUE_STARTLE, CUE_LAND, CUE_TORPOR]) for (const layer of [LAYER_NONE, LAYER_FLINCH, LAYER_EAT]) {
      st.speed = speed; st.cue = cue; st.layer = layer;
      for (let age = 0; age < 90; age += .5) {
        creaturePose(anim, st, 100 + age, rig.a); solve(rig, rig.a, rig.solved);
        for (const [side, socket] of sockets.entries()) {
          boneToModel(rig.solved, socket.bone, socket.x, socket.y, socket.z, point);
          expect(point[1]! - move.swimDepth!, `${species} airway ${side}: speed ${speed}, cue ${cue}, layer ${layer}, age ${age}`).toBeGreaterThan(.05);
        }
      }
    }
  });

  artTest(`native ${species} hatches and floats with the same scale as its visible nostrils`, () => {
    const h = new Harness({}, 1, 60, { dev: true, map: writeMap(dinosaurCourse()) });
    try {
      const ada = h.join("observer"); h.run(300); h.say(ada, "enablecheats");
      const ents = h.world.ents, adult = h.host.spawnCreature(`core:${species}`, 110, 92, 1);
      const parent = h.host.records.byPid.get(ents.pid[adult]!)!, egg = h.host.records.create(h.reg.breedEgg[parent.kind]!);
      egg.genome = structuredClone(parent.genome); egg.x = 208; egg.y = -3; egg.z = 192;
      egg.egg = { species: parent.kind, span: 100, hatchAt: h.world.tick + 100, carrier: 0 };
      h.say(ada, "tp 208 174");
      expect(h.host.breeding.hatchNow(egg)).toBe(true);
      const rec = [...h.host.records.byPid.values()].find(r => r.kind === parent.kind && r.grown !== 0)!;
      const e = h.host.records.entOf.get(rec.pid)!, move = h.reg.move[rec.kind]!, anim = h.world.anims[rec.kind]!;
      expect(anim.rig.breath?.length).toBe(2);
      const sockets = anim.rig.breath!;
      h.host.creatures.mind.stay(e, 0xffffffff);
      const st = new AnimState(), point = new Float64Array(3);
      for (const remaining of [1, .5, .05]) {
        rec.grown = h.world.tick + Math.floor(rec.span * remaining); ents.setYoung(e, rec.span, rec.grown);
        h.run(12000);
        const size = youngScale(h.reg.birthScale[rec.kind]!, rec.span, rec.grown, h.world.tick);
        expect(ents.mode[e]).toBe(MODE_SWIM);
        expect(ents.y[e]).toBeCloseTo(-move.swimDepth! * size, 3);
        st.unpack(ents.anim[e]!, ents.cue[e]!);
        creaturePose(anim, st, h.world.tick, anim.rig.a); solve(anim.rig, anim.rig.a, anim.rig.solved);
        for (const [side, socket] of sockets.entries()) {
          boneToModel(anim.rig.solved, socket.bone, socket.x, socket.y, socket.z, point);
          expect(ents.y[e]! + point[1]! * size, `${species} airway ${side} at scale ${size}`).toBeGreaterThan(.03);
        }
        expect(h.host.survival.value(rec, V_OXYGEN)).toBe(150);
      }
    } finally { h.host.shutdown(); }
  });
}
