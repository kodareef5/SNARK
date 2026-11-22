import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { CreatureSounds } from "../../client/core/sound/creatures.ts";
import { SoundLibrary } from "../../client/core/sound/library.ts";
import { Resolver } from "../../client/core/sound/resolve.ts";
import { Pose, sampleClip } from "../../shared/anim/clip.ts";
import { creaturePose } from "../../shared/anim/creature.ts";
import { AnimState, CUE_NONE, CUE_ROAR, CUE_STARTLE } from "../../shared/anim/pose.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../shared/sim/character.ts";
import { V_TORPOR } from "../../shared/sim/vitals.ts";
import { ACT_NONE, ACT_SWING } from "../../shared/sim/weapon.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { birdAnim, birdRig } from "../fixtures/bird.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

test("a ridden Rex roars once per press and nearby small wild creatures are interrupted once per immunity period", () => {
  const h = new Harness({}, 3, 60, { map: writeMap(flatMap()) });
  try {
    const rider = h.join("rider"), peer = h.join("listener", { latencyMs: 45 });
    h.run(650);
    const ents = h.world.ents, me = h.host.records.byPid.get(h.client(rider)!.pid)!;
    const ox = ents.x[h.ent(rider)]! + 2, oz = ents.z[h.ent(rider)]!;
    const rec = (e: number) => h.host.records.byPid.get(ents.pid[e]!)!;
    const spawn = (species: string, dx: number, dz: number, level: number) => {
      const e = h.host.spawnCreature("core:" + species, ox + dx, oz + dz, level);
      expect(e).toBeGreaterThanOrEqual(0);
      h.host.creatures.mind.stay(e, h.world.tick + 1000);
      return e;
    };
    const mount = spawn("rex", 0, 0, 10);
    h.host.taming.give(rec(mount), me, 1);
    rec(mount).saddle = h.reg.index.get("core:saddle_rex")!;
    expect(h.host.riding.mount(h.client(rider)!, mount)).toBe(RESULT_OK);
    h.run(500);
    expect(rider.driving).toBe(mount);
    const wild = spawn("dodo", 4, 1, 10), high = spawn("dodo", 0, 5, 50);
    const ally = spawn("dodo", -4, -1, 1), sleeping = spawn("dodo", 4, -4, 1);
    const large = spawn("rex", -7, 3, 1), far = spawn("dodo", 0, 17, 1);
    const hidden = spawn("dodo", 0, -9, 1);
    const unclaimed = spawn("dodo", 2, 7, 1);
    rec(unclaimed).span = ents.span[unclaimed] = 10000;
    rec(unclaimed).grown = ents.grown[unclaimed] = h.world.tick + 10000;
    h.world.structs.add(h.reg.index.get("core:wall")!, ox, 1.5, oz - 5, 0, 0, 1);
    h.host.taming.give(rec(ally), me, 1);
    h.host.survival.add(rec(sleeping), V_TORPOR, 1e4);
    h.run(500);
    const st = new AnimState(), state = (e: number) => { st.unpackCue(ents.cue[e]!); return st.cue; };
    // Both clients feed their actual view through the client sound dispatcher before and during the roar.
    const sound = new SoundLibrary({ sounds: [{ id: "core:rex/sound/roar", file: 1, at: 8, rate: 32000, range: 150, vary: 0, takes: [] }] }, null);
    const listeners = [rider, peer].map(s => {
      const voice = new CreatureSounds(h.reg, sound, new Resolver(sound.index), () => null);
      const view = new RemoteSample(), heard: number[] = [];
      return { view, heard, sample() {
        s.sampleRemote(view);
        voice.update(view, h.world.hf, ox, 2, oz, (_sound, _kind, _weight, id) => heard.push(id), () => {});
      } };
    });
    const sample = () => listeners.forEach(l => l.sample());
    sample();
    const press = (buttons: number, ms: number) => { h.pilots[0]!.buttons = buttons; h.run(ms, sample); };
    ents.act[wild] = ACT_SWING;
    ents.actTicks[wild] = 0;
    press(BTN_SECONDARY, 300);
    expect([state(mount), state(wild), ents.act[wild], h.host.feces.dropped, h.host.feces.laid]).toEqual([CUE_ROAR, CUE_STARTLE, ACT_NONE, 1, 0]);
    for (const other of [high, ally, sleeping, large, far, hidden, unclaimed, h.ent(peer)]) expect(state(other)).not.toBe(CUE_STARTLE);
    for (const l of listeners) {
      const row = l.view.id.subarray(0, l.view.count).indexOf(mount);
      expect(row).toBeGreaterThanOrEqual(0);
      st.unpackCue(l.view.cue[row]!);
      expect(st.cue).toBe(CUE_ROAR);
      expect(l.heard).toEqual([mount]);
    }
    const first = ents.cue[mount]!;
    press(0, 100);
    press(BTN_SECONDARY, 100);
    expect(ents.cue[mount]).toBe(first);
    // Keep the wild bird in view after its moment of immobility. Holding through cooldown cannot fire again.
    h.host.creatures.mind.stay(wild, h.world.tick + 1000);
    press(BTN_SECONDARY, 8100);
    for (const l of listeners) expect(l.heard).toEqual([mount]);
    press(0, 150);
    press(BTN_SECONDARY, 350);
    for (const l of listeners) expect(l.heard).toEqual([mount, mount]);
    expect(h.host.feces.dropped).toBe(1);
    press(0, 8100);
    press(BTN_SECONDARY, 300);
    expect(h.host.feces.dropped).toBe(2);
    press(0, 150);
    press(BTN_PRIMARY, 120);
    expect(ents.act[mount]).toBe(ACT_SWING);
    for (const l of listeners) expect(l.heard).toEqual([mount, mount, mount]);
    // A second rider's ordinary mount gets the same right-click and keeps its ordinary behavior.
    const normal = spawn("raptor", -1, 2, 1);
    h.host.taming.give(rec(normal), h.host.records.byPid.get(h.client(peer)!.pid)!, 1);
    rec(normal).saddle = h.reg.index.get("core:saddle_raptor")!;
    expect(h.host.riding.mount(h.client(peer)!, normal)).toBe(RESULT_OK);
    h.run(500);
    h.pilots[1]!.buttons = BTN_SECONDARY;
    h.run(300);
    expect([peer.driving, state(normal), h.host.feces.dropped]).toEqual([normal, CUE_NONE, 2]);
  } finally {
    h.host.shutdown();
  }
});

test("the authoritative cue plays the native call once across tick wrap and leaves a moving mount's feet in gait", () => {
  const rig = birdRig();
  const anim = birdAnim({ ...rig, sockets: new Map([...rig.sockets, ["head", rig.sockets.get("beak_tip")!]]) });
  const cue = new AnimState(), plain = new AnimState();
  cue.cue = CUE_ROAR;
  cue.cueStart = 250;
  const shown = new Pose(rig.bones), base = new Pose(rig.bones), authored = new Pose(rig.bones);
  sampleClip(anim.call!, 22, authored);
  creaturePose(anim, cue, 272, shown);
  expect(shown.rot).toEqual(authored.rot);
  cue.speed = plain.speed = 8;
  creaturePose(anim, plain, 272, base);
  creaturePose(anim, cue, 272, shown);
  const neck = new Set(anim.neck);
  expect(neck.size).toBeGreaterThan(0);
  expect(shown.rot).not.toEqual(base.rot);
  for (let b = 0; b < rig.bones; b++) {
    expect(shown.rot.slice(b * 4, b * 4 + 4)).toEqual((neck.has(b) ? authored : base).rot.slice(b * 4, b * 4 + 4));
  }
  expect(shown.root).toEqual(base.root);
  const after = 250 + anim.call!.frames + 20;
  creaturePose(anim, cue, after, shown);
  creaturePose(anim, plain, after, base);
  expect(shown.rot).toEqual(base.rot);
});
