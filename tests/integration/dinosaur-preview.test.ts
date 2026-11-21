import { expect, test } from "bun:test";
import { DinosaurSelfcheck } from "../../client/core/activity-selfcheck.ts";
import { App } from "../../client/core/app.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_SECONDARY } from "../../shared/sim/character.ts";
import { ACT_COOL, ACT_HOLD } from "../../shared/sim/weapon.ts";
import { frozenPack } from "../fixtures/pack.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { DINOSAUR_COURSE, dinosaurCourse } from "../../tools/dinosaurs/course.ts";
import { installDinosaurPreview, seedDinosaurPreview } from "../../tools/dinosaurs/dev.ts";
import { Harness } from "../fixtures/net.ts";

test("the independent dinosaur course preserves survivor setup and grants real owned saddled creatures once per team", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(dinosaurCourse()) });
  try {
    // This fixture exercises preview infrastructure with an existing species; native Trike/Stego validation is separate.
    installDinosaurPreview(h.host, ["core:raptor"]);
    const s = h.join("Reviewer"); h.run(500);
    const client = h.client(s)!, owner = h.host.records.byPid.get(client.pid)!;
    expect(owner.team).toBeGreaterThan(0); expect(owner.look).not.toBeNull();
    const raptor = h.reg.index.get("core:raptor")!, pets = [...h.host.records.byPid.values()].filter(r => r.kind === raptor);
    expect(pets).toHaveLength(1);
    const pet = pets[0]!;
    expect(pet.team).toBe(owner.team); expect(h.reg.saddleFits[pet.saddle]).toBe(raptor);
    expect(h.host.items.inv(pet).total(h.reg.index.get("core:meat")!)).toBeGreaterThan(90);
    expect(seedDinosaurPreview(h.host, owner, ["core:raptor"])).toBe(0);
    expect(h.host.items.audit()).toEqual([]);
    const hf = h.world.hf, { spawn, slope, pool } = DINOSAUR_COURSE;
    expect(hf.heightAt(spawn.x, spawn.z)).toBe(1);
    expect(hf.heightAt(slope.x, slope.z)).toBe(6);
    expect(hf.heightAt(pool.x, pool.z)).toBe(-4);
    expect(hf.waterAt(pool.x, pool.z)).toBe(0);
    expect(h.world.nodes).not.toBeNull();
  } finally { h.host.shutdown(); }
});

for (const [connection, outage] of [["normal input", 0], ["a lost windup", 1500], ["a sustained input outage", Infinity]] as const) {
  test(`the Trike ride probe reports the server's charge and recovery with ${connection}`, () => {
    const pack = frozenPack(), h = new Harness({}, 1, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map: writeMap(dinosaurCourse()) });
    try {
      installDinosaurPreview(h.host, ["core:trike"]);
      const s = h.join("rider", {}, { manual: true }), app = new App(s, h.reg, pack);
      app.fromEye = true; // as the shell sets it for a ?selfcheck page
      const frame = (now: number) => app.frame(now, 800, 600);
      h.run(500, frame);
      const c = h.client(s)!, ents = h.world.ents;
      const trike = [...h.host.records.byPid.values()].find(rec => rec.kind === h.reg.index.get("core:trike"))!;
      const e = h.host.records.entOf.get(trike.pid)!;
      ents.setPosition(c.ent, ents.x[e]! + 2, ents.y[e]!, ents.z[e]!);
      expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
      h.run(300, frame);
      const ride = new DinosaurSelfcheck("trike");
      let interrupted = false, ran = false, recovered = false;
      h.run(18300, now => {
        ride.step(app, now);
        if (!interrupted && (app.controls.buttons & BTN_SECONDARY) !== 0) {
          // Predictions still run and server snapshots still arrive while the first RMB press cannot reach the host.
          h.ends[0]!.downUntil = now + outage;
          interrupted = true;
        }
        frame(now); ride.observe(app);
        ran ||= ents.act[e] === ACT_HOLD;
        recovered ||= ran && ents.act[e] === ACT_COOL;
      });
      expect(interrupted).toBe(true);
      if (outage === 0) expect(ride.data.chargeAttempts).toBe(1);
      if (outage === 1500) expect(ride.data.chargeAttempts).toBeGreaterThan(1);
      expect(ride.data.timedOut).toBe(outage === Infinity);
      expect(ride.data.secondary).toBe(true);
      expect([ran, recovered]).toEqual([outage !== Infinity, outage !== Infinity]);
      expect([ride.data.chargeRan, ride.data.recovered, ride.data.finished]).toEqual([ran, recovered, true]);
    } finally { h.host.shutdown(); }
  });
}
