import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { DRAW_ONE_BONE, DRAW_SKINNED, type FramePacket } from "../../client/core/render/packet.ts";
import plan from "../../content/landmarks/koru-sails.json" with { type: "json" };
import { MODE_GHOST, MODE_WALK, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { sailsProgress } from "../../shared/sim/sails.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { koruWorldPoint, KORU_COURSE } from "../../tools/koru/course.ts";
import { koruSailsCourse } from "../../tools/koru-sails/course.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

test("native dynamic sails keep one owner and advancing poses through city handovers, then use five rest bones", () => {
  const map = koruSailsCourse(), pack = corePack(), h = new Harness({}, 629, 60, { dev: true, map: writeMap(map), clips: pack.clips, rigs: pack.header.rigs });
  try {
    const operator = h.join("winch", {}, { manual: true, city: true }), observer = h.join("offshore", {}, { manual: true, city: true });
    const helm = new App(operator, h.reg, pack), app = new App(observer, h.reg, pack);
    helm.ui.settings.tier = "lowpoly"; app.ui.settings.tier = "high"; helm.ui.settings.steady = app.ui.settings.steady = false;
    let packet: FramePacket | null = null;
    const run = (ms: number) => h.run(ms, now => { helm.frame(now, 640, 480); packet = app.frame(now, 800, 500); });
    run(900);
    const user = h.client(operator)!, viewer = h.client(observer)!, ents = h.world.ents, feet = koruWorldPoint(plan.control.approach), aim = koruWorldPoint(plan.control.aim);
    ents.setPosition(user.ent, ...feet); ents.mode[user.ent] = MODE_WALK; ents.flags[user.ent] &= ~F_GROUNDED; user.ownDirty = true;
    const eye = feet[1] + stanceEye(h.reg.move[ents.kind[user.ent]!]!, ents.stance[user.ent]!);
    helm.controls.yaw = Math.atan2(aim[0] - feet[0], aim[2] - feet[2]); helm.controls.pitch = Math.atan2(aim[1] - eye, Math.hypot(aim[0] - feet[0], aim[2] - feet[2]));
    observer.text("enablecheats"); run(100); observer.text("fly"); run(600);
    expect(helm.hud.prompt).toContain("raise sails");
    helm.key("KeyE", true); run(80); helm.key("KeyE", false); run(80);
    expect(h.host.sails.states()[0]!.target).toBe(1);
    let previous = 0;
    for (const distance of [115, 280, 650, 900, 115]) {
      ents.setPosition(viewer.ent, KORU_COURSE.vessel.x - distance, 33.38, KORU_COURSE.vessel.z - 10);
      ents.vx[viewer.ent] = ents.vy[viewer.ent] = ents.vz[viewer.ent] = 0; ents.mode[viewer.ent] = MODE_GHOST; ents.flags[viewer.ent] &= ~F_GROUNDED; viewer.ownDirty = true;
      app.controls.yaw = Math.atan2(distance, 10); app.controls.pitch = -.03; run(1200);
      const p = packet! as FramePacket, scene = app.scene!, source = observer.sails;
      const progress = sailsProgress(source.states()[0]!, source.tick()); expect(progress).toBeGreaterThan(previous); previous = progress;
      expect(scene.sails.stats.sails).toBe(5); expect(scene.sails.stats.bones).toBe(227); expect(scene.sails.stats.limited).toBe(0);
      for (const sail of plan.sails) {
        const mesh = scene.assets.table.find(sail.mesh), instances = new Set<number>(); let sections = 0;
        for (let d = 0; d < p.drawCount; d++) if (p.drawMesh[d] === mesh) {
          expect(p.drawFlags[d]! & DRAW_SKINNED).toBe(DRAW_SKINNED); expect(p.drawInstances[d]).toBe(1); expect(p.drawFade[d]).toBe(scene.assets.tier.reach.city);
          instances.add(p.drawFirst[d]!); sections++;
        }
        expect(sections).toBeGreaterThan(0); expect(instances.size).toBe(1);
      }
      expect(p.dropped).toBe(0); expect(p.skipped).toBe(0); expect(p.casterDropped).toBe(0);
      if (distance >= 650) expect(observer.world!.structs.chunks.some(chunk => chunk?.kind.some(kind => !!h.reg.sails[kind]))).toBe(false);
    }
    // Advance both real sessions through completion without rebuilding identical intermediate scene packets.
    h.run(19000, now => { operator.update(now, 0, 0, 0, 0, 0); observer.update(now, 0, 0, 0, 0, 0); }); run(100);
    expect(observer.sails.states()[0]!.from).toBe(1); expect(app.scene!.sails.stats.bones).toBe(5);
    const p = packet! as FramePacket;
    for (let d = 0; d < p.drawCount; d++) if (plan.sails.some(sail => app.scene!.assets.table.find(sail.mesh) === p.drawMesh[d])) expect(p.drawFlags[d]! & DRAW_ONE_BONE).toBe(DRAW_ONE_BONE);
    // Resource pressure never writes part of a rig or overruns a tier; it leaves the whole assembly out.
    const scene = app.scene!, tier = scene.assets.tier;
    scene.assets.tier = { ...tier, bones: 4 }; scene.build(app.cam, null);
    expect(scene.sails.stats.groups).toBe(0); expect(scene.sails.stats.limited).toBe(1);
    scene.assets.tier = { ...tier, reach: { ...tier.reach, city: 0 } }; scene.build(app.cam, null);
    expect(scene.sails.stats.groups).toBe(0); expect(scene.sails.stats.sails).toBe(0);
  } finally { h.host.shutdown(); }
}, 10000);
