// Actual hatched and adult dinosaurs carry their size across injury, death, falling and a saved game.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corpseSize, sizeSpan } from "../../shared/anim/corpse.ts";
import { CUE_HURT_SHIFT } from "../../shared/anim/pose.ts";
import { youngScale } from "../../shared/sim/breeding.ts";
import { BTN_USE } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { dinosaurCourse } from "../../tools/dinosaurs/course.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const columns = [
  { x: 110, z: 92, shelf: 6, hatched: true }, { x: 122, z: 92, shelf: 6, hatched: false },
  { x: 202, z: 192, shelf: -2, hatched: false }, { x: 214, z: 192, shelf: -2, hatched: true },
];
for (const species of ["trike", "stego"]) {
  test(`native ${species} hatchlings fall and sink through openings that support adults, including after restart`, () => {
    const reg = coreRegistry(), course = dinosaurCourse(), piece = "core:ceiling_wood";
    const ceiling = reg.index.get(piece)!, half = reg.halfX[ceiling]!;
    const statics = columns.flatMap(({ x, z, shelf }) => [-1, 1].map(side => ({
      kind: piece, x: x + side * (half + .6), y: shelf, z, yaw: 0,
    })));
    const dir = mkdtempSync(join(tmpdir(), "snark-dinosaur-corpse-"));
    const options = { dev: true, map: writeMap({ ...course, statics: [...course.statics, ...statics] }), dbPath: join(dir, "world.db") };
    let h: Harness | null = new Harness({}, 1, 60, options);
    try {
      const observer = h.join("observer"); h.run(300);
      const e = h.host.spawnCreature(`core:${species}`, 108, 92, 1);
      const parent = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
      const host = h.host, world = h.world, records = host.records, ents = world.ents;
      const living = columns.map(column => {
        const { shelf, hatched } = column;
        let rec = parent;
        if (hatched) {
          const before = new Set(records.byPid.keys());
          const egg = records.create(reg.breedEgg[parent.kind]!);
          egg.genome = structuredClone(parent.genome); egg.x = 114; egg.y = world.hf.heightAt(114, 92); egg.z = 92;
          egg.egg = { species: parent.kind, span: 100, hatchAt: world.tick + 100, carrier: 0 };
          expect(host.breeding.hatchNow(egg)).toBe(true);
          rec = [...records.byPid.values()].find(child => !before.has(child.pid) && child.kind === parent.kind && child.grown !== 0)!;
        } else if (shelf < 0) {
          const other = host.spawnCreature(`core:${species}`, 114, 98, 1);
          rec = records.byPid.get(ents.pid[other]!)!;
        }
        const id = records.entOf.get(rec.pid)!;
        host.creatures.mind.stay(id, 0xffffffff);
        return { ...column, rec, id };
      });
      const by = h.client(observer)!.pid;
      for (const { rec } of living) h.host.survival.hurt(rec, h.host.survival.value(rec, V_HEALTH) * .6, by);
      h.run(600);
      const samples: { pid: number; size: number; ground: number; hatched: boolean; shelf: number }[] = [];
      for (const { x, z, shelf, hatched, rec, id } of living) {
        expect((ents.cue[id]! >>> CUE_HURT_SHIFT) & 3).toBeGreaterThan(0);
        const size = hatched ? corpseSize(sizeSpan(youngScale(reg.birthScale[rec.kind]!, rec.span, rec.grown, h.world.tick))) : 1;
        const move = reg.move[rec.kind]!, ground = h.world.hf.heightAt(x, z);
        expect(capsuleFree(h.world, x, shelf - .5, z, move.radius * size, move.height * size)).toBe(hatched);
        ents.setPosition(id, x, shelf + reg.halfY[ceiling]! + 1, z);
        ents.vx[id] = ents.vz[id] = 0; ents.vy[id] = -.1; ents.flags[id] &= ~F_GROUNDED;
        const previous = new Set(h.host.corpses.bodies.keys());
        h.host.survival.hurt(rec, 1e6, by);
        const body = [...h.host.corpses.bodies.values()].find(b => !previous.has(b.rec.pid))!;
        expect([body.size, body.drop !== null]).toEqual([size, true]);
        samples.push({ pid: body.rec.pid, size, ground, hatched, shelf });
      }
      h.run(100);
      const [dryYoung, wetYoung] = samples.filter(s => s.hatched);
      const descent = (sample: typeof samples[number]) => sample.shelf + reg.halfY[ceiling]! + 1 - host.corpses.bodies.get(sample.pid)!.y;
      expect(descent(wetYoung!)).toBeLessThan(descent(dryYoung!));
      // Save all four corpses in flight, with both wet sizes present simultaneously.
      h.host.shutdown(); h = null;
      h = new Harness({}, 1, 60, options);
      h.run(10000);
      for (const { pid, size, ground, hatched, shelf } of samples) {
        const body = h.host.corpses.bodies.get(pid)!;
        expect([body.size, body.drop, h.world.ents.span[body.e]]).toEqual([size, null, sizeSpan(size)]);
        expect(body.rec.y).toBe(body.y);
        if (hatched) expect(Math.abs(body.y - ground)).toBeLessThan(.025);
        else expect(Math.abs(body.y - shelf)).toBeLessThan(.3);
      }
      // E opens the body the player sees, and its authoritative distance keeps the inventory open.
      const player = h.join("scavenger"); h.run(300); h.say(player, "enablecheats");
      const body = h.host.corpses.bodies.get(dryYoung!.pid)!, at = h.host.corpses.middle(body);
      h.say(player, `tp ${at.x.toFixed(3)} ${(at.z - 1.7).toFixed(3)}`, 300);
      const me = h.ent(player), feet = h.world.ents, pilot = h.pilots[0]!;
      const dx = at.x - feet.x[me]!, dz = at.z - feet.z[me]!;
      pilot.yaw = Math.atan2(dx, dz);
      pilot.pitch = Math.atan2(at.y - (feet.y[me]! + 1.62), Math.hypot(dx, dz));
      h.run(200);
      expect(h.host.containers.target(h.client(player)!, 3.5)).toBe(body.e);
      pilot.buttons = BTN_USE; h.run(100); pilot.buttons = 0; h.run(300);
      expect(h.client(player)!.open).toBe(body.rec.pid);
      expect(player.open?.name).toBe(body.rec.name);
    } finally {
      h?.host.shutdown();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
