import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { MODE_WALK, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { HIT_NONE, HIT_STRUCTURE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { KORU_COURSE, koruCourse } from "../../tools/koru/course.ts";
import { koruReviewShots } from "../../tools/koru/review.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

test("the untouched marina arrival faces and frames the full hull, bowsprit and three mast tips", () => {
  const h = new Harness({}, 629, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(koruCourse()) });
  try {
    const app = new App(h.join("arrival-view", {}, { manual: true }), h.reg, parsePack(corePackBytes()));
    h.run(1200, now => app.frame(now, 1200, 800));
    expect(app.session.own.x).toBeCloseTo(KORU_COURSE.spawn.x, 2);
    expect(app.session.own.z).toBeCloseTo(KORU_COURSE.spawn.z, 2);
    expect(app.session.own.y).toBeCloseTo(h.world.hf.heightAt(KORU_COURSE.spawn.x, KORU_COURSE.spawn.z), 2);
    expect(app.session.own.mode).toBe(MODE_WALK); expect(app.session.own.grounded).toBe(true);
    expect(Math.sin(app.controls.yaw)).toBeCloseTo(-1, 6); expect(app.controls.pitch).toBe(0);
    const screen = new Float32Array(3);
    for (const point of koruReviewShots()[0]!.framePoints!) {
      expect(app.cam.project(...point, screen)).toBe(true);
      for (const coordinate of screen.subarray(0, 2)) { expect(coordinate).toBeGreaterThan(.02); expect(coordinate).toBeLessThan(.98); }
      // Frustum containment alone missed a seawall-hidden hull and a foreground palm. Check the real sightline too.
      const dx = point[0] - app.cam.x, dy = point[1] - app.cam.y, dz = point[2] - app.cam.z, distance = Math.hypot(dx, dy, dz);
      const hit = castWorld(h.world, app.cam.x, app.cam.y, app.cam.z, dx / distance, dy / distance, dz / distance, distance);
      if (hit !== HIT_NONE) {
        expect(hit, `obstructed arrival point ${point}`).toBe(HIT_STRUCTURE);
        const kind = h.world.structs.chunks[Math.floor(rayHit.ref / 65536)]!.kind[rayHit.ref % 65536]!;
        expect(h.reg.defs[kind]!.id.startsWith("core:koru"), `arrival blocked by ${h.reg.defs[kind]!.id}`).toBe(true);
      }
    }
    expect(app.session.stats.corrections).toBe(0);
  } finally { h.host.shutdown(); }
});

test("normal first-person and shoulder cameras remain dry and outside geometry on every authored interior review route", () => {
  const h = new Harness({}, 629, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(koruCourse()) });
  try {
    const app = new App(h.join("interior-view", {}, { manual: true }), h.reg, parsePack(corePackBytes()));
    let width = 1200, height = 800;
    const run = (ms: number) => h.run(ms, now => app.frame(now, width, height));
    run(800);
    const c = h.client(app.session)!, ents = h.world.ents, move = h.reg.move[ents.kind[c.ent]!]!;
    const shots = koruReviewShots().filter(shot => shot.mode === "walk" && !shot.arrival && !shot.name.includes("scenic") && shot.tier === "high");
    const ray = new Float64Array(3), forward = new Float64Array(3);
    for (const shot of shots) for (const portrait of [false, true]) for (const thirdPerson of [false, true]) {
      [width, height] = portrait ? [540, 960] : [1200, 800];
      ents.setPosition(c.ent, ...shot.feet); ents.vx[c.ent] = ents.vy[c.ent] = ents.vz[c.ent] = 0;
      ents.mode[c.ent] = MODE_WALK; ents.flags[c.ent] = ents.flags[c.ent]! & ~F_GROUNDED; c.ownDirty = true;
      const eye = shot.feet[1] + stanceEye(move, ents.stance[c.ent]!);
      const dx = shot.target[0] - shot.feet[0], dz = shot.target[2] - shot.feet[2];
      app.controls.yaw = Math.atan2(dx, dz); app.controls.pitch = Math.atan2(shot.target[1] - eye, Math.hypot(dx, dz));
      if (app.view.thirdPerson !== thirdPerson) { app.key("KeyV", true); app.key("KeyV", false); }
      run(700);
      expect(ents.mode[c.ent], shot.name).toBe(MODE_WALK); expect(ents.flags[c.ent]! & F_GROUNDED, shot.name).not.toBe(0);
      expect(ents.y[c.ent]!, shot.name).toBeCloseTo(shot.feet[1], 2);
      expect(app.cam.y, shot.name).toBeGreaterThan(h.world.hf.waterAt(app.cam.x, app.cam.z));
      expect(capsuleFree(h.world, app.cam.x, app.cam.y - .04, app.cam.z, .04, .08), shot.name).toBe(true);
      app.cam.ray(.5, .5, forward);
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [.5, .5]]) {
        app.cam.ray(u!, v!, ray);
        const depth = app.cam.near / (ray[0]! * forward[0]! + ray[1]! * forward[1]! + ray[2]! * forward[2]!);
        expect(capsuleFree(h.world, app.cam.x + ray[0]! * depth, app.cam.y + ray[1]! * depth - .015, app.cam.z + ray[2]! * depth, .015, .03), `${shot.name} near-plane ${u},${v}`).toBe(true);
      }
      const corrections = app.session.stats.corrections; run(100);
      expect(app.session.stats.corrections - corrections, shot.name).toBe(0);
    }
  } finally { h.host.shutdown(); }
});
