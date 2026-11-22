import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { castWorld, HIT_NONE } from "../../shared/world/ray.ts";
import { flatMap } from "../fixtures/map.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack, frozenPack } from "../fixtures/pack.ts";

function throughRoof(pack: Pack, species: string, fps: number, underside: number, reverse = false, passenger = false, pitch = -.4): void {
  const { registry, errors } = compileContent(CORE_CONTENT.map(d => passenger && d.type === "item" && d.id === `core:saddle_${species}`
    ? { ...d, saddle: { ...d.saddle!, seats: [...d.saddle!.seats, { id: "passenger", anchor: [0, 2.57, -.2] as const, entry: [-1.7, 0, -.2] as const }] } } : d));
  expect(errors).toEqual([]);
  const h = new Harness({}, 1, fps, { dev: true, map: writeMap(flatMap(2)), clips: pack.clips, rigs: pack.header.rigs }, registry!);
  try {
    const apps = Array.from({ length: passenger ? 2 : 1 }, (_, i) => new App(h.join(`roof-rider-${i}`, {}, { manual: true }), h.reg, pack)), app = apps[0]!;
    const run = (ms: number, observe?: () => void): void => h.run(ms, now => { for (const a of apps) a.frame(now, 960, 540); observe?.(); });
    run(600);
    const c = h.client(app.session)!, ents = h.world.ents, owner = h.host.records.byPid.get(c.pid)!;
    const start = reverse ? 97 : 65, e = h.host.spawnCreature(`core:${species}`, 70, start, 1), rec = h.host.records.byPid.get(ents.pid[e]!)!;
    rec.team = owner.team; rec.saddle = h.reg.index.get(`core:saddle_${species}`)!;
    h.host.refreshBody(rec); h.host.creatures.claimed(e); h.host.creatures.mind.stay(e, 0xffffffff);
    const roof = h.reg.index.get("core:ceiling_stone")!;
    for (let x = 61; x <= 79; x += 3) for (let z = 73.5; z <= 88.5; z += 3) h.world.structs.add(roof, x, underside + h.reg.halfY[roof]!, z, 0, 0, 10000);
    ents.setPosition(c.ent, 68, 0, start);
    expect(h.host.riding.mount(c, e)).toBe(RESULT_OK); run(200);
    if (passenger) {
      const other = h.client(apps[1]!.session)!;
      h.host.records.byPid.get(other.pid)!.team = owner.team;
      ents.setPosition(other.ent, 72, 0, start);
      expect(h.host.riding.mount(other, e)).toBe(RESULT_OK);
    }
    run(1200);
    expect(app.session.driving).toBe(e);
    for (const a of apps) { a.controls.yaw = reverse ? Math.PI : 0; a.controls.pitch = pitch; }
    run(300);
    const samples = apps.map(() => ({ last: null as number[] | null, body: null as number[] | null, maxJump: 0, inside: 0, entered: false, escaped: 0, recovered: [0, 0, 0], recoverySamples: 0, tail: [] as number[][] }));
    app.controls.moveZ = 1;
    run(14000, () => {
      for (let i = 0; i < apps.length; i++) {
        const a = apps[i]!, s = samples[i]!, cam = a.cam, own = a.session.own, r = a.remote;
        const ri = i ? r.id.subarray(0, r.count).indexOf(e) : -1;
        const body = ri < 0 ? [own.x, own.y, own.z] : [r.x[ri]!, r.y[ri]!, r.z[ri]!];
        const [x, y, z] = body as [number, number, number];
        if (s.last && s.body) s.maxJump = Math.max(s.maxJump, Math.hypot(cam.x - s.last[0]! - (x - s.body[0]!), cam.y - s.last[1]! - (y - s.body[1]!), cam.z - s.last[2]! - (z - s.body[2]!)));
        s.last = [cam.x, cam.y, cam.z]; s.body = body;
        const offset = [cam.x - x, cam.y - y, cam.z - z];
        s.tail.push(offset); if (s.tail.length > fps / 10) s.tail.shift();
        if (z > 72 && z < 90) {
          s.entered = true; s.inside++;
          const mid = y + h.reg.move[rec.kind]!.height * .5, dx = cam.x - x, dy = cam.y - mid, dz = cam.z - z, distance = Math.hypot(dx, dy, dz);
          if (distance > 0) expect(castWorld(h.world, x, mid, z, dx / distance, dy / distance, dz / distance, distance)).toBe(HIT_NONE);
          if (cam.x > 59.5 && cam.x < 80.5 && cam.z > 72 && cam.z < 90) expect(cam.y).toBeLessThan(underside);
        } else if (s.entered && (reverse ? z <= 72 : z >= 90)) {
          s.escaped++;
          if (s.escaped >= fps * 1.5 && s.escaped < fps * 1.6) {
            for (let k = 0; k < 3; k++) s.recovered[k]! += offset[k]!;
            s.recoverySamples++;
          }
        }
      }
    });
    for (let i = 0; i < apps.length; i++) {
      const s = samples[i]!, cam = apps[i]!.cam;
      expect(s.entered).toBe(true); expect(s.inside).toBeGreaterThan(fps);
      expect(s.escaped).toBeGreaterThan(fps * 1.5);
      // No more than 30 m/s of camera movement relative to the mount: 0.5 m per frame at 60 fps.
      expect(s.maxJump).toBeLessThanOrEqual(30 / fps);
      if (pitch <= 0) expect(cam.y).toBeGreaterThan(underside + 1);
      expect(s.recoverySamples).toBe(fps / 10);
      // Average 100 ms (three server ticks) so comparison does not depend on the client/server tick phase.
      const outdoor = [0, 0, 0];
      for (const offset of s.tail) for (let k = 0; k < 3; k++) outdoor[k]! += offset[k]! / s.tail.length;
      expect(Math.hypot(...outdoor.map((n, k) => n - s.recovered[k]! / s.recoverySamples))).toBeLessThan(.05);
    }
  } finally { h.host.shutdown(); }
}

for (const fps of [20, 30, 60, 120]) for (const under of [2.75, 2.96]) test(`whole-client parasaur roof edge stays continuous at ${fps} fps under ${under} m`, () => throughRoof(frozenPack(), "parasaur", fps, under));
for (const under of [2.75, 2.96]) {
  test(`the opposite roof edge stays continuous under ${under} m`, () => throughRoof(frozenPack(), "parasaur", 60, under, true));
  test(`a remote saddle passenger keeps roof-edge continuity under ${under} m`, () => throughRoof(frozenPack(), "parasaur", 60, under, false, true));
  for (const pitch of [-1.2, 0, .8]) test(`roof-edge continuity follows look pitch ${pitch} under ${under} m`, () => throughRoof(frozenPack(), "parasaur", 60, under, false, false, pitch));
}
artTest("current raptor and parasaur rigs keep roof-edge continuity at both ceiling heights", () => {
  for (const kind of ["raptor", "parasaur"]) for (const under of [2.75, 2.96]) for (const fps of [20, 30, 60, 120]) throughRoof(corePack(), kind, fps, under);
});
