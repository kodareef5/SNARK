import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { BONE_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CreatureBite, creatureBite } from "../../shared/anim/creature-attack.ts";
import { AnimState, bodySeed } from "../../shared/anim/pose.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { EVENT_HIT, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { ACT_SWING } from "../../shared/sim/weapon.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack, frozenPack } from "../fixtures/pack.ts";
import { artTest } from "../fixtures/needs-art.ts";

function fixture(kind: string, grade = 0, across = 0, pack = frozenPack(), posed = true) {
  const map = flatMap(4, { minY: -128 });
  for (let j = 0; j < 129; j++) for (let i = 0; i < 129; i++) map.heights[j * 129 + i] = Math.round((128 + (j * 2 - 70) * grade + (i * 2 - 128) * across) * 256);
  const h = new Harness({}, 5, 60, { dev: true, clips: posed ? pack.clips : NO_CLIPS, rigs: posed ? pack.header.rigs : [], map: writeMap(map) });
  const rider = h.join("rider"), observer = h.join("observer"); h.run(1000);
  const c = h.client(rider)!, ents = h.world.ents, owner = h.host.records.byPid.get(c.pid)!;
  const mount = h.host.spawnCreature(`core:${kind}`, 128, 70, 1), rec = h.host.records.byPid.get(ents.pid[mount]!)!;
  rec.team = owner.team; rec.saddle = h.reg.index.get(`core:saddle_${kind}`)!; ents.setTeam(mount, rec.team);
  h.host.refreshBody(rec); h.host.creatures.claimed(mount); h.host.creatures.mind.stay(mount, 0xffffffff);
  ents.setPosition(c.ent, 126, h.world.hf.heightAt(126, 70), 70);
  expect(h.host.riding.mount(c, mount)).toBe(RESULT_OK); h.run(1000); expect(c.drive).toBe(mount);
  function target(species: string, distance: number, x = 128) {
    const e = h.host.spawnCreature(`core:${species}`, x, 70 + distance, 1);
    h.host.creatures.mind.stay(e, 0xffffffff);
    return h.host.records.byPid.get(ents.pid[e]!)!;
  }
  function attack(pitch = 0) {
    h.pilots[0]!.pitch = pitch; h.run(150);
    const before = h.host.combat.hits, riderHp = h.host.survival.value(owner, V_HEALTH);
    let landed = -1, start = -1;
    h.pilots[0]!.buttons = BTN_PRIMARY;
    for (let f = 0; f < 39; f++) {
      h.run(1000 / 60);
      if (ents.act[mount] === ACT_SWING && start < 0) start = h.world.tick - ents.actTicks[mount]!;
      if (h.host.combat.hits > before && landed < 0) landed = ents.actTicks[mount]!;
    }
    h.pilots[0]!.buttons = 0; h.run(100);
    expect(c.drive).toBe(mount); expect(h.host.survival.value(owner, V_HEALTH)).toBeGreaterThanOrEqual(riderHp);
    return { landed, start, hits: h.host.combat.hits - before, feedback: rider.events.filter(e => e.kind === EVENT_HIT) };
  }
  return { h, rider, observer, mount, rec, c, target, attack, pack };
}

function renderedMouth(f: ReturnType<typeof fixture>, st: AnimState, tick: number, x: number, y: number, z: number, yaw: number) {
  const { h, pack, mount } = f, kind = h.world.ents.kind[mount]!, rig = h.world.anims[kind]!.rig, socket = rig.sockets.get("mouth")!;
  const chars = new Characters(h.reg, pack, new Assets(h.reg, pack), h.world), packet = new FramePacket();
  packet.beginFrame(); chars.begin();
  expect(chars.add(packet, kind, x, y, z, yaw, st, tick, null, 0, new Uint8Array(6), 0, null, 0, mount, true, false)).toBe(true);
  const at = socket.bone * BONE_FLOATS, local = [rig.rest[socket.bone * 3]! + socket.x, rig.rest[socket.bone * 3 + 1]! + socket.y, rig.rest[socket.bone * 3 + 2]! + socket.z];
  const mouth = [0, 0, 0], origin = [0, 0, 0];
  const cap = rig.capA[socket.bone * 3 + 2]! < rig.capB[socket.bone * 3 + 2]! ? rig.capA : rig.capB;
  const back = [0, 1, 2].map(axis => rig.rest[socket.bone * 3 + axis]! + cap[socket.bone * 3 + axis]!);
  for (let axis = 0; axis < 3; axis++) {
    const row = at + axis * 4;
    mouth[axis] = packet.bones[row]! * local[0]! + packet.bones[row + 1]! * local[1]! + packet.bones[row + 2]! * local[2]! + packet.bones[row + 3]!;
    origin[axis] = packet.bones[row]! * back[0]! + packet.bones[row + 1]! * back[1]! + packet.bones[row + 2]! * back[2]! + packet.bones[row + 3]!;
  }
  return { mouth, origin };
}

function ordinary(pack = frozenPack()) {
  for (const [kind, prey, distance, pitch, grade, across] of [
    ["raptor", "parasaur", 2.5, 0, 0, 0], ["parasaur", "raptor", 3.5, -.55, 0, 0],
    ["raptor", "parasaur", 2.4, 0, -Math.tan(Math.PI / 9), .15], ["parasaur", "parasaur", 3.65, -Math.PI / 9, -Math.tan(Math.PI / 9), .15],
    ["raptor", "parasaur", 2.4, 0, Math.tan(Math.PI / 9), -.15], ["parasaur", "parasaur", 3.65, Math.PI / 9, Math.tan(Math.PI / 9), -.15],
  ] as const) {
    const f = fixture(kind, grade, across, pack), { h, mount } = f;
    try {
      const target = f.target(prey, distance), result = f.attack(pitch);
      expect({kind, grade, across, hits:result.hits}).toEqual({kind, grade, across, hits:1}); expect(h.host.combat.last.victim).toBe(target.pid);
      expect(result.landed).toBe(h.reg.weapon[h.world.ents.kind[mount]!]!.strikeTick);
      expect(result.feedback.length).toBe(1); expect(result.feedback[0]!.damage).toBeGreaterThan(0);
      expect(f.observer.events.some(e => e.kind === EVENT_HIT)).toBe(false);
      const remote = new RemoteSample(); f.observer.sampleRemote(remote);
      const at = Array.from(remote.id.subarray(0, remote.count)).indexOf(mount), st = new AnimState();
      expect(at).toBeGreaterThanOrEqual(0); st.unpack(remote.anim[at]!, remote.cue[at]!); st.seed = bodySeed(mount);
      expect(st.action & 7).toBe(ACT_SWING); expect(st.actionStart).toBe(result.start & 255);
      const bite = new CreatureBite(), x = remote.x[at]!, y = remote.y[at]!, z = remote.z[at]!, yaw = remote.yaw[at]!;
      expect(creatureBite(h.world.anims[h.world.ents.kind[mount]!]!, st, remote.tick, x, y, z, yaw, h.reg.reach[h.world.ents.kind[mount]!]!, bite, h.world, h.reg.tamedMove[h.world.ents.kind[mount]!]!)).toBe(true);
      const drawn = renderedMouth(f, st, remote.tick, x, y, z, yaw);
      expect(Math.hypot(...drawn.mouth.map((v, axis) => v - bite.mouth[axis]!))).toBeLessThan(.0001);
      expect(Math.hypot(...drawn.origin.map((v, axis) => v - bite.origin[axis]!))).toBeLessThan(.0001);
    } finally { h.host.shutdown(); }
  }
}

test("normal mounted bites hit once at their authored impact tick on level and uphill/downhill ground; observer jaws share authority's pose", () => ordinary());
artTest("current shipped raptor and parasaur assets retain the same normal attack and observer contract", () => ordinary(corePack()));

test("jaw aiming is bounded, visible, and follows the creature heading through a turn instead of the camera yaw", () => {
  for (const kind of ["raptor", "parasaur"]) {
    const f = fixture(kind), { h, mount } = f;
    try {
      const k = h.world.ents.kind[mount]!, a = h.world.anims[k]!, st = new AnimState(), bite = new CreatureBite();
      st.grounded = true; st.setAction(ACT_SWING, 0, 0);
      const samples: number[][] = [];
      for (const yaw of [0, Math.PI / 2]) for (const pitch of [-31, -16, 0, 16, 31]) {
        st.pitch = pitch;
        expect(creatureBite(a, st, 11, 128, 0, 70, yaw, h.reg.reach[k]!, bite, h.world, h.reg.tamedMove[k]!)).toBe(true);
        const drawn = renderedMouth(f, st, 11, 128, 0, 70, yaw);
        expect(Math.hypot(...drawn.mouth.map((v, axis) => v - bite.mouth[axis]!))).toBeLessThan(.0001);
        expect(Math.hypot(...drawn.origin.map((v, axis) => v - bite.origin[axis]!))).toBeLessThan(.0001);
        const delta = drawn.mouth.map((v, axis) => v - bite.origin[axis]!);
        const along = delta.reduce((sum, v, axis) => sum + v * bite.direction[axis]!, 0);
        const off = Math.hypot(...delta.map((v, axis) => v - along * bite.direction[axis]!));
        expect(off).toBeLessThan(bite.radius + .05);
        samples.push([...bite.mouth]);
      }
      expect(samples[0]).toEqual(samples[1]); expect(samples[3]).toEqual(samples[4]);
      expect(samples[0]![1]).toBeLessThan(samples[2]![1]! - .2);
      expect(samples[4]![1]).toBeGreaterThan(samples[2]![1]! + .2);
      expect(Math.abs(samples[7]![0]! - 128)).toBeGreaterThan(1);
    } finally { h.host.shutdown(); }
  }
});

test("a mouth through a wall cannot bite its far side; the real doorway opening still permits a raptor bite", () => {
  for (const [kind, piece, x, succeeds] of [
    ["raptor", "wall", 128, false], ["raptor", "doorframe", 128, true], ["raptor", "doorframe", 128.9, false],
    ["parasaur", "doorframe", 128, false],
  ] as const) {
    const f = fixture(kind), { h } = f;
    try {
      const target = f.target("parasaur", kind === "raptor" ? 2.5 : 3.65), hp = h.host.survival.value(target, V_HEALTH);
      h.world.structs.add(h.reg.index.get(`core:${piece}_wood`)!, x, 1.5, 71.3, 0, 0, 10000);
      const result = f.attack();
      expect({kind, piece, x, hits:result.hits}).toEqual({kind, piece, x, hits:succeeds ? 1 : 0});
      expect(h.host.survival.value(target, V_HEALTH) < hp - 1).toBe(succeeds);
    } finally { h.host.shutdown(); }
  }
});

test("posed attacks retain PvE and rider protection, and targets beyond the entire configured reach stay untouched", () => {
  for (const protectedTarget of [true, false]) {
    const f = fixture("raptor"), { h } = f;
    try {
      const target = f.target("parasaur", protectedTarget ? 2.5 : 7), e = h.host.records.entOf.get(target.pid)!;
      if (protectedTarget) { target.team = f.rec.team + 1; h.world.ents.setTeam(e, target.team); h.say(f.rider, "enablecheats"); h.say(f.rider, "setting serverPVE true"); h.run(100); }
      const hp = h.host.survival.value(target, V_HEALTH); f.attack();
      expect(h.host.survival.value(target, V_HEALTH)).toBeGreaterThanOrEqual(hp);
    } finally { h.host.shutdown(); }
  }
});

test("source-only creature shapes retain the normal bite entry point without an authored mouth", () => {
  const f = fixture("raptor", 0, 0, frozenPack(), false);
  try { const target = f.target("parasaur", 2); const result = f.attack(); expect(result.hits).toBe(1); expect(f.h.host.combat.last.victim).toBe(target.pid); expect(result.feedback.length).toBe(1); }
  finally { f.h.host.shutdown(); }
});

test("the normal whole client predicts mounted attack animation and receives one authoritative hit without replaying feedback", async () => {
  const { App } = await import("../../client/core/app.ts");
  for (const kind of ["raptor", "parasaur"]) {
    const pack = frozenPack(), h = new Harness({}, 5, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map: writeMap(flatMap(4)) });
    try {
      const app = new App(h.join("driver", { tcp: true, latencyMs: 75 }, { manual: true }), h.reg, pack);
      const run = (ms: number) => h.run(ms, now => { app.frame(now, 960, 540); });
      run(2500);
      const c = h.client(app.session)!, ents = h.world.ents, me = h.host.records.byPid.get(c.pid)!;
      const mount = h.host.spawnCreature(`core:${kind}`, 128, 70, 1), rec = h.host.records.byPid.get(ents.pid[mount]!)!;
      rec.team = me.team; rec.saddle = h.reg.index.get(`core:saddle_${kind}`)!; ents.setTeam(mount, rec.team);
      h.host.refreshBody(rec); h.host.creatures.claimed(mount); h.host.creatures.mind.stay(mount, 0xffffffff);
      ents.setPosition(c.ent, 126, 0, 70); expect(h.host.riding.mount(c, mount)).toBe(RESULT_OK); run(1500);
      const target = h.host.spawnCreature("core:parasaur", 128, kind === "raptor" ? 72.5 : 73.65, 1); h.host.creatures.mind.stay(target, 0xffffffff);
      app.controls.yaw = 0; app.controls.pitch = kind === "raptor" ? 0 : -.1; run(200);
      const corrections = app.session.stats.corrections;
      let shown = 0, feedback = 0;
      // Observe the native event queue before App consumes it; the production receiver and HUD still run unchanged.
      const frame = app.frame.bind(app); app.frame = (...args) => {
        feedback += app.session.events.filter(e => e.kind === EVENT_HIT).length;
        const packet = frame(...args), own = app.scene?.own;
        if (own?.id === mount && (own.state.action & 7) === ACT_SWING) shown++;
        return packet;
      };
      app.mouseButton(0, true); run(650); app.mouseButton(0, false); run(500);
      expect(shown).toBeGreaterThan(12); expect(h.host.combat.last.victim).toBe(ents.pid[target]);
      expect(feedback).toBe(1); expect(app.session.stats.corrections - corrections).toBe(0);
      expect(app.session.driving).toBe(mount);
    } finally { h.host.shutdown(); }
  }
});

function hugging(pack = frozenPack()) {
  for (const [kind, distance, pitch] of [["raptor", 1.05, 0], ["parasaur", 1.5, -.6]] as const) {
    const f = fixture(kind, 0, 0, pack), { h } = f;
    try {
      const target = h.join("close survivor"); h.run(500);
      const c = h.client(target)!, rec = h.host.records.byPid.get(c.pid)!;
      h.world.ents.setPosition(c.ent, 128, 0, 70 + distance);
      const hp = h.host.survival.value(rec, V_HEALTH), result = f.attack(pitch);
      expect({kind, hits:result.hits}).toEqual({kind, hits:1}); expect(h.host.combat.last.victim).toBe(rec.pid);
      expect(h.host.survival.value(rec, V_HEALTH)).toBeLessThan(hp);
      expect(result.landed).toBe(11); expect(result.feedback.length).toBe(1);
    } finally { h.host.shutdown(); }
  }
}
test("a ridden bite covers the contact-distance neck gap without harming its own rider", () => hugging());
artTest("current shipped mounts bite a survivor pressed against the chest", () => hugging(corePack()));

test("wild and unmounted tame hits never send a marker to character creation or spectators", () => {
  for (const owned of [false, true]) {
    const pack = frozenPack(), h = new Harness({ spectators: "anyone" }, 5, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map: writeMap(flatMap(4)) });
    try {
      const creator = h.join("creator", {}, { look: null }), watcher = h.join("watcher", {}, { spectate: true }), survivor = h.join("survivor"); h.run(1000);
      const c = h.client(survivor)!, ents = h.world.ents;
      expect([h.client(creator)!.pid, h.client(watcher)!.pid]).toEqual([0, 0]);
      ents.setPosition(c.ent, 128, 0, 128);
      const e = h.host.spawnCreature(owned ? "core:parasaur" : "core:raptor", 128, 140, 1), rec = h.host.records.byPid.get(ents.pid[e]!)!;
      if (owned) { rec.team = h.host.records.byPid.get(c.pid)!.team + 1; ents.setTeam(e, rec.team); h.host.refreshBody(rec); h.host.creatures.claimed(e); h.host.creatures.mind.attack(e, c.ent); }
      for (let tick = 0; tick < 300 && h.host.combat.hits === 0; tick++) h.run(1000 / 30);
      expect(h.host.combat.last.victim).toBe(c.pid); h.run(100);
      for (const s of [creator, watcher, survivor]) expect(s.events.filter(e => e.kind === EVENT_HIT)).toEqual([]);
      // The native structure hit path has the same recipient policy; a real thatch wall takes damage.
      ents.setPosition(c.ent, 160, 0, 128); h.host.creatures.mind.stay(e, 0xffffffff);
      ents.setPosition(e, 128, 0, 128); ents.yaw[e] = 0; ents.pitch[e] = 0; ents.act[e] = ACT_SWING; ents.actTicks[e] = 11; ents.pose(e, h.world.tick);
      h.world.structs.add(h.reg.index.get("core:wall_thatch")!, 128, 1.5, 129.5, 0, 0, 10000);
      const before = h.host.combat.structureHits; h.host.combat.bite(e); h.run(100);
      expect(h.host.combat.structureHits).toBeGreaterThan(before);
      for (const s of [creator, watcher, survivor]) expect(s.events.filter(e => e.kind === EVENT_HIT)).toEqual([]);
    } finally { h.host.shutdown(); }
  }
});

test("a rider looking toward the downhill target's upper body lands a world-aimed bite", () => {
  for (const kind of ["raptor", "parasaur"]) {
    const f = fixture(kind, -Math.tan(Math.PI / 9), .15), { h } = f;
    try {
      const target = f.target("parasaur", kind === "raptor" ? 2.4 : 3.65), e = h.host.records.entOf.get(target.pid)!, eye = new Float64Array(3);
      expect(h.host.riding.eye(f.c.ent, eye)).toBe(true);
      const dx = h.world.ents.x[e]! - eye[0]!, dz = h.world.ents.z[e]! - eye[2]!;
      const pitch = Math.atan2(h.world.ents.y[e]! + h.reg.bodyHeight[target.kind]! * .8 - eye[1]!, Math.hypot(dx, dz));
      const result = f.attack(pitch);
      expect({kind, hits:result.hits}).toEqual({kind, hits:1}); expect(h.host.combat.last.victim).toBe(target.pid);
    } finally { h.host.shutdown(); }
  }
});

test("forward bite reach stays bounded by the species reach, including when aiming downward", () => {
  for (const [kind, pitch] of [["raptor", 0], ["parasaur", -.3]] as const) {
    const f = fixture(kind), { h } = f;
    try {
      const target = h.join("beyond reach"); h.run(500);
      const c = h.client(target)!, rec = h.host.records.byPid.get(c.pid)!;
      const distance = h.reg.reach[f.rec.kind]! + .6;
      h.world.ents.setPosition(c.ent, 128, 0, 70 + distance);
      const hp = h.host.survival.value(rec, V_HEALTH); f.attack(pitch);
      expect(h.host.survival.value(rec, V_HEALTH)).toBeGreaterThanOrEqual(hp);
    } finally { h.host.shutdown(); }
  }
});

test("a mount's former rider receives no attack marker after normal dismount", () => {
  const f = fixture("raptor"), { h } = f;
  try {
    const target = f.target("parasaur", 2.5), e = h.host.records.entOf.get(target.pid)!;
    expect(f.attack().feedback.length).toBe(1);
    h.host.riding.dismount(f.c); h.run(500); expect(f.c.drive).toBe(-1);
    f.rider.events.length = 0;
    h.host.creatures.mind.attack(f.mount, e); const before = h.host.combat.hits;
    for (let tick = 0; tick < 150 && h.host.combat.hits === before; tick++) { h.host.creatures.mind.stay(e, 0xffffffff); h.run(1000 / 30); }
    expect(h.host.combat.hits).toBeGreaterThan(before); expect(h.host.combat.last.by).toBe(f.rec.pid);
    h.run(100); expect(f.rider.events.filter(e => e.kind === EVENT_HIT)).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("compound-slope rendered mouths remain inside the world-aimed bite volume", () => {
  for (const kind of ["raptor", "parasaur"]) for (const grade of [-Math.tan(Math.PI / 9), Math.tan(Math.PI / 9)]) {
    const f = fixture(kind, grade, .15), { h, mount } = f;
    try {
      const k = h.world.ents.kind[mount]!, a = h.world.anims[k]!, st = new AnimState(), bite = new CreatureBite();
      st.grounded = true; st.setAction(ACT_SWING, 0, 0);
      for (const yaw of [0, Math.PI / 2]) for (const pitch of [-6, 0, 6]) {
        st.pitch = pitch;
        expect(creatureBite(a, st, 11, 128, 0, 70, yaw, h.reg.reach[k]!, bite, h.world, h.reg.tamedMove[k]!)).toBe(true);
        const drawn = renderedMouth(f, st, 11, 128, 0, 70, yaw), delta = drawn.mouth.map((v, axis) => v - bite.origin[axis]!);
        const along = delta.reduce((sum, v, axis) => sum + v * bite.direction[axis]!, 0);
        expect(Math.hypot(...delta.map((v, axis) => v - along * bite.direction[axis]!))).toBeLessThan(bite.radius + .05);
        expect(Math.hypot(...drawn.mouth.map((v, axis) => v - bite.mouth[axis]!))).toBeLessThan(.0001);
        expect(bite.direction[1]).toBeCloseTo(Math.sin(pitch * Math.PI / 62), 6);
      }
    } finally { h.host.shutdown(); }
  }
});

test("a second mounted bite finds the same contact on a fresh target after biting a different creature", () => {
  function secondContact(firstInReach: boolean) {
    const f = fixture("raptor"), { h } = f;
    try {
      const first = f.target("parasaur", 2.5, firstInReach ? 128 : 145);
      expect(f.attack().hits).toBe(firstInReach ? 1 : 0);
      const firstEntity = h.host.records.entOf.get(first.pid)!;
      h.world.ents.setPosition(firstEntity, 180, 0, 180); h.world.history.discontinuity(firstEntity);
      h.run(1000);
      const next = f.target("raptor", 2.6);
      f.rider.events.length = 0;
      const result = f.attack(-.15);
      expect(result.hits).toBe(1);
      expect(h.host.combat.last.victim).toBe(next.pid);
      expect(result.feedback.length).toBe(1);
      const { x, y, z, zone } = result.feedback[0]!;
      return { x, y, z, zone };
    } finally { h.host.shutdown(); }
  }
  expect(secondContact(true)).toEqual(secondContact(false));
});
