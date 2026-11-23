import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { BONE_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { corePack } from "../fixtures/pack.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { AnimState, CUE_TORPOR } from "../../shared/anim/pose.ts";
import { REACT_CREATURE_DOWN } from "../../shared/anim/reactions.ts";
import { ZONE_TORSO } from "../../shared/anim/human.ts";
import { MF_DOWN } from "../../shared/sim/character.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

function yard() {
  const h = new Harness({}, 7, 60, { wild: false, map: writeMap(flatMap(4)) });
  h.host.setSetting("Knockdowns", "true");
  const w = h.join("watcher");
  h.run(600);
  const a = h.world.ents, c = h.client(w)!;
  a.setPosition(c.ent, 97, 0, 98);
  h.world.history.discontinuity(c.ent);
  const bird = h.host.spawnCreature("core:dodo", 100, 100, 200);
  const by = h.host.records.byPid.get(c.pid)!;
  const blow = (base: number) => {
    const x = a.x[bird]!, y = a.y[bird]!, z = a.z[bird]!;
    h.host.combat.land({ by, x: x - 1, z, item: 0, base, type: DMG_MELEE, quality: 1, draw: 1, attack: 1,
      torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 }, bird, ZONE_TORSO, x, y + 0.2, z, 1);
  };
  h.run(250);
  return { h, w, a, bird, blow };
}

test("a struck dodo falls on its own rig for a watcher and gets up alive", () => {
  const { h, w, a, bird, blow } = yard();
  try {
    const remote = new RemoteSample(), st = new AnimState(), pack = corePack();
    const characters = new Characters(h.reg, pack, new Assets(h.reg, pack));
    const packet = new FramePacket(), camera = new Camera(), colors = new Uint8Array(6);
    const rig = h.world.anims[a.kind[bird]!]!.rig, head = rig.names.indexOf("skull");
    const start = a.x[bird]!;
    blow(65);
    expect(a.react[bird]).toBe(REACT_CREATURE_DOWN);
    const positions = new Map<number, number[]>();
    let rendered = 0, risingHits = 0, up = false, watchedRise = false;
    h.run(6000, () => {
      const pose = h.host.falls.poseOf(bird);
      if (pose) {
        expect(a.mflags[bird]! & MF_DOWN).toBe(MF_DOWN);
        positions.set(h.world.tick, [a.x[bird]!, a.y[bird]!, a.z[bird]!]);
      }
      w.sampleRemote(remote);
      characters.corpseMotions = w.corpseMotions;
      characters.begin();
      characters.corpses(packet, camera, remote, w.world!);
      for (let i = 0; i < remote.count; i++) if (remote.id[i] === bird) {
        st.unpack(remote.anim[i]!, remote.cue[i]!, remote.emote[i]!, remote.react[i]!);
        watchedRise ||= st.cue === CUE_TORPOR && !st.out && !remote.react[i];
        const tick = Math.floor(remote.tick), at = positions.get(tick);
        const down = !!at && st.react === REACT_CREATURE_DOWN && w.corpseMotions.has(a.handleOf(bird));
        const rising = st.cue === CUE_TORPOR && !st.out && !st.react && ((tick - st.cueStart) & 255) < 30;
        if (!down && !rising) continue;
        const p = new FramePacket();
        characters.begin();
        expect(characters.add(p, remote.kind[i]!, remote.x[i]!, remote.y[i]!, remote.z[i]!, remote.yaw[i]!, st, remote.tick, null, 0, colors, 0, null, 0, bird, false, false)).toBe(true);
        const row = head * BONE_FLOATS, atBone = head * 3;
        const skull = [0, 1, 2].map(axis => {
          const m = row + 4 * axis;
          return p.bones[m]! * rig.rest[atBone]! + p.bones[m + 1]! * rig.rest[atBone + 1]! + p.bones[m + 2]! * rig.rest[atBone + 2]! + p.bones[m + 3]!;
        });
        if (down) {
          const pose = h.host.falls.poseAt(bird, tick)!;
          expect(skull[1]!).toBeCloseTo(at[1]! + pose.pos[atBone + 1]!, 4);
          rendered++;
        } else risingHits++;
        expect(h.host.combat.castBodies(h.ent(w), skull[0]!, skull[1]! + 1, skull[2]!, 0, -1, 0, 1.3, 0, tick)).toBe(bird);
      }
      if (h.host.falls.stats.rose && !up) {
        expect(a.x[bird]! - start).toBeGreaterThan(0.4);
        up = true;
      }
    });
    expect(rendered).toBeGreaterThan(20);
    expect(risingHits).toBeGreaterThan(20);
    expect([up, watchedRise, a.react[bird], a.mflags[bird]! & MF_DOWN]).toEqual([true, true, 0, 0]);
  } finally { h.host.shutdown(); }
});

test("a dodo killed in midair gives its moving fall to its corpse", () => {
  const { h, bird, blow } = yard();
  try {
    blow(65);
    h.run(160);
    const fall = h.host.falls.poseOf(bird)!;
    expect(fall).toBeTruthy();
    blow(100000);
    expect(h.host.falls.isDown(bird)).toBe(false);
    const a = h.world.ents;
    let body = -1;
    for (let e = 0; e < a.flags.length; e++) if (a.kind[e] === h.reg.index.get("core:dodo") && h.host.corpses.at(e)) body = e;
    expect(body).toBeGreaterThanOrEqual(0);
    expect(h.host.corpses.motion(body)).toBeTruthy();
    const after = h.host.corpses.at(body)!.pose!;
    expect(Math.max(...after.pos.map((p, i) => Math.abs(p - fall.pos[i]!)))).toBeLessThan(0.001);
    expect(Math.max(...after.rot.map((q, i) => Math.abs(q - fall.rot[i]!)))).toBeLessThan(0.001);
  } finally { h.host.shutdown(); }
});
