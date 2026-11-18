// The rendered fall, its authored particles and the sound mixer all see real host snapshots.
import { expect } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Details } from "../../client/core/details/details.ts";
import { Corpses } from "../../client/core/ragdoll.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CreatureSounds, type Emit } from "../../client/core/sound/creatures.ts";
import { SoundLibrary } from "../../client/core/sound/library.ts";
import { Resolver } from "../../client/core/sound/resolve.ts";
import { bodyDown } from "../../shared/anim/moments.ts";
import { makeHandle } from "../../shared/ids.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

for (const [species, descent] of [
  ["trike", "fall"], ["stego", "fall"], ["trike", "launch"], ["stego", "launch"], ["stego", "removed"], ["stego", "standing"],
] as const) {
  artTest(`${species} death cues observe the rendered contact (${descent})`, () => {
    const launched = descent === "launch", standing = descent === "standing";
    const h = new Harness({}, 1, 60, { map: writeMap(flatMap(3)) });
    try {
      const player = h.join("listener"); h.run(600);
      const { reg, ents, hf, anims } = h.world;
      const x = player.own.x + 4, z = player.own.z, floor = hf.heightAt(x, z);
      const id = h.host.spawnCreature(`core:${species}`, x, z, 1);
      const living = h.host.records.byPid.get(ents.pid[id]!)!;
      h.host.creatures.mind.stay(id, 0xffffffff);
      const pack = corePack(), sheets = pack.header.details!.sheets;
      const animOf = (kind: number) => anims[kind] ?? null;
      const lib = new SoundLibrary({ sounds: ["death", "step"].map(key => ({ id: `core:${species}/sound/${key}`,
        range: 60, file: 0, at: 0, rate: 16000, vary: 0, takes: [] })) }, null);
      const sounds = new CreatureSounds(reg, lib, new Resolver(lib.index), animOf, sheets);
      const details = new Details(reg, pack.header.details, pack.palette, animOf);
      const cam = new Camera(), packet = new FramePacket(), tier = tierOf("medium");
      cam.x = x; cam.y = floor + 3; cam.z = z - 5; cam.aspect = 16 / 9; cam.update();
      const remote = new RemoteSample(), drawn = new Corpses(anims), gaits = new Map();
      const heard: { tick: number; play: Parameters<Emit> }[] = [];
      const frame = () => {
        player.sampleRemote(remote);
        drawn.update(remote, h.world, x, z, gaits, player.corpseMotions);
        sounds.update(remote, hf, x, cam.y, z, (...play) => heard.push({ tick: remote.tick, play }), () => {}, drawn.list);
        packet.detailCount = 0;
        details.frame(packet, cam, remote, drawn.list, [], null, hf, tier, remote.tick * 1000 / TICK_RATE, h.world);
      };
      h.run(200); frame();
      if (!standing) { ents.setPosition(id, x, floor + 40, z); ents.flags[id] &= ~F_GROUNDED; }
      for (let n = 0; n < 6; n++) { h.run(34); frame(); }
      if (!standing) {
        expect(remote.y[remote.id.indexOf(id)]!).toBeGreaterThan(floor + 15);
        ents.vx[id] = 8;
      }
      const launch = launched ? { victimPid: living.pid, victimHandle: makeHandle(id, ents.gen[id]!), vx: 7, vy: 1, vz: 0, wx: .2, wy: .1, wz: 0 } : undefined;
      h.host.survival.hurt(living, 1e6, 0, undefined, launch);
      const body = [...h.host.corpses.bodies.values()].at(-1)!;
      let landed = 0, firstDust = 0, dustX = 0, dustY = 0, fallingFrames = 0;
      for (let n = 0; n < (launched ? 250 : 100); n++) {
        h.run(34); frame();
        const c = drawn.list[0];
        if (c && (c.falling || c.motionRevision && !c.landed)) fallingFrames++;
        if (descent === "removed" && fallingFrames === 3 && h.host.corpses.bodies.has(body.rec.pid)) h.host.corpses.remove(body, true);
        if (c?.landed && !landed) landed = c.landed;
        if (details.pool.count && !firstDust) { firstDust = remote.tick; dustX = details.pool.x[0]!; dustY = details.pool.y[0]!; }
      }
      const cries = heard.filter(e => e.play[0] === 0), impacts = heard.filter(e => e.play[0] === 1);
      expect(cries).toHaveLength(1); expect(cries[0]!.play[10]).toBe(0);
      if (!standing) expect(cries[0]!.play[5]).toBeGreaterThan(floor + 15);
      if (descent === "removed") {
        expect(drawn.list).toHaveLength(0); expect(impacts).toHaveLength(0); expect(firstDust).toBe(0);
        return;
      }
      const c = drawn.list[0]!;
      expect(c.watched).toBe(true); expect(c.air).toBe(false);
      if (standing) {
        const at = c.born + bodyDown(anims[c.kind]!.rig, anims[c.kind]!.death) * TICK_RATE;
        expect(firstDust).toBeGreaterThanOrEqual(at); expect(firstDust - at).toBeLessThan(2);
        expect(fallingFrames).toBe(0);
      } else {
        expect(fallingFrames).toBeGreaterThan(20);
        expect(c.x - x).toBeGreaterThan(3);
        expect(landed).toBeGreaterThan(c.born + TICK_RATE);
        expect(firstDust).toBeGreaterThanOrEqual(landed); expect(firstDust - landed).toBeLessThan(2);
        expect(cries[0]!.tick).toBeLessThan(landed);
      }
      const groundX = c.impact?.[0] ?? c.x, groundZ = c.impact?.[2] ?? c.z;
      const groundY = hf.heightAt(groundX, groundZ);
      if (launched) {
        expect(c.motionRevision).toBeGreaterThan(0);
        expect(c.impact?.[1]).toBeCloseTo(groundY, 4);
      }
      expect(Math.abs(dustX - groundX)).toBeLessThan(2); expect(dustY).toBeCloseTo(groundY, 3);
      expect(impacts).toHaveLength(species === "stego" ? 1 : 0);
      if (impacts.length) {
        expect(impacts[0]!.tick).toBe(firstDust);
        expect(impacts[0]!.play.slice(4, 7)).toEqual([groundX, c.impact?.[1] ?? groundY, groundZ]);
        expect(impacts[0]!.play[3]).toBe(-1); // The sound stays at the contact while a body rolls on.
        expect(impacts[0]!.play[10]).toBe(0);
      }
    } finally { h.host.shutdown(); }
  });
}
