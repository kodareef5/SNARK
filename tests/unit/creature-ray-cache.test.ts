import { expect, test } from "bun:test";
import { CreatureAnim, CreatureRayPose, rayCreature } from "../../shared/anim/creature.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { zoneHit } from "../../shared/anim/skeleton.ts";
import { ACT_SWING } from "../../shared/sim/weapon.ts";
import { groundUnder } from "../../shared/world/collide.ts";
import { frozenPack } from "../fixtures/pack.ts";
import { flatWorld } from "../fixtures/world.ts";

test("a bite's reused target poses match exact rays after other creatures use the same rig, and refresh for the next bite", () => {
  const pack = frozenPack(), rigs = buildRigs(pack.header.rigs, pack.clips), w = flatWorld(4);
  const cached = new CreatureRayPose(Math.max(...[...rigs.values()].map(rig => rig.bones)));
  let hits = 0, misses = 0;
  for (const species of ["raptor", "parasaur"]) {
    const kind = w.kind(`core:${species}`), p = w.reg.tamedMove[kind]!;
    const anim = new CreatureAnim(rigs.get(`core:${species}`)!, w.reg.runAt[kind]!, p.swimSpeed);
    const other = new AnimState();
    for (const grade of [0, -.4, .4]) {
      for (let j = 0; j < w.hf.nz; j++) for (let i = 0; i < w.hf.nx; i++) {
        w.hf.setSample(i, j, (j * w.hf.cell - 128) * grade + (i * w.hf.cell - 128) * .15);
      }
      for (const yaw of [0, 8192, 32768]) for (const action of [false, true]) {
        const st = new AnimState(); st.seed = 19; st.speed = 6; st.pitch = action ? -8 : 8;
        if (action) st.setAction(ACT_SWING, 0, 0);
        const tick = action ? 11 : 47, y = groundUnder(w.hf, 128, 128, p.radius);
        cached.ready = false;
        for (const side of [-1.5, -.5, 0, .5, 1.5]) for (const height of [.2, 1, 2, 3]) for (const maxT of [2, 8]) {
          const ox = 128 + side, oy = y + height, oz = 124;
          const exact = rayCreature(anim, st, tick, 128, y, 128, yaw, ox, oy, oz, 0, 0, 1, maxT, w, p);
          const expected = { zone: exact, bone: zoneHit.bone, t: zoneHit.t };
          // Posing a different body of this species overwrites rig.solved. Cached targets must own their bones.
          rayCreature(anim, other, tick + 17, 128, y, 128, yaw + 16384, ox, oy, oz, 0, 0, 1, 8, w, p);
          const zone = rayCreature(anim, st, tick, 128, y, 128, yaw, ox, oy, oz, 0, 0, 1, maxT, w, p, cached);
          expect({ zone, bone: zoneHit.bone, t: zoneHit.t }).toEqual(expected);
          if (zone) hits++; else misses++;
        }
      }
    }
  }
  expect(hits).toBeGreaterThan(100);
  expect(misses).toBeGreaterThan(100);
});
