// Every drawn piece of the cruise ship and the yacht, followed from the quay out to 2 km and back: who draws it at each
// step. It grows with the landmarks' pieces, so it runs before a merge (planning/quality/testing.md).
import { expect } from "bun:test";
import { artTest } from "../fixtures/needs-art.ts";
import { App } from "../../client/core/app.ts";
import { InlineCityMaker, type CityJob } from "../../client/core/render/citymake.ts";
import { LANDMARK_BUFFER } from "../../client/core/render/farlandmarks.ts";
import { DRAW_PLAIN, DRAW_RANGED, type FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { landmarkPoint } from "../../shared/world/landmark.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { CRUISE_COURSE, cruiseCourse } from "../../tools/cruise/course.ts";
import { assertCruisePlaced } from "../../tools/cruise/preflight.ts";
import { Harness } from "../fixtures/net.ts";
import { cruisePack } from "../fixtures/cruise.ts";

// A landmark's piece is drawn by the near store while the chunk its static stands in is held whole, and by a run of the
// landmark's far mesh otherwise. The far city makes no level that holds a landmark's piece.
artTest("each drawn piece of the ship and the yacht has one owner from the quay out to 2 km and back, and the far city holds none", () => {
  const map = cruiseCourse(), names = map.content!.landmarks.map(l => l.name), pack = cruisePack(names), origin = CRUISE_COURSE.vessel;
  const h = new Harness({}, 629, 60, { dev: true, map: writeMap(map), clips: pack.clips, rigs: pack.header.rigs });
  const own = new Set(h.reg.defs.flatMap((d, k) => (d && names.includes(d.id.split(":")[0]!) ? [k] : [])));
  let jobs = 0, held = 0;
  const maker = new class extends InlineCityMaker {
    override make(job: CityJob): void {
      jobs++;
      job.kind.forEach((k, i) => { if (own.has(k) && job.gone?.[i] !== 1) held++; });
      super.make(job);
    }
  }();
  try {
    expect(assertCruisePlaced(map, h.world.structs, h.reg).length).toBe(map.statics.length);
    const session = h.join("ship-observer", {}, { manual: true, cityMaker: maker }), app = new App(session, h.reg, pack);
    session.staticsArrived(h.world.statics!);
    app.ui.settings.tier = "high"; app.ui.settings.steady = false;
    let packet: FramePacket | null = null;
    const run = (ms: number) => h.run(ms, now => { packet = app.frame(now, 1920, 600); });
    run(900); session.text("enablecheats"); run(100); session.text("fly"); run(100);
    const scene = app.scene!, marks = scene.landmarks!, source = session.world!.city!, ids = scene.assets.manifest.meshes.map(m => m.id);
    expect(marks.placed.map(l => l.far.name)).toEqual(names);
    // Each far piece belongs to the chunk where a static of its landmark stands at the point the piece stands.
    const statics = source.statics, stands = new Set<string>(), point = [0, 0, 0];
    for (let c = 0; c < statics.first.length - 1; c++) for (let i = statics.first[c]!; i < statics.first[c + 1]!; i++) if (own.has(statics.kind[i]!)) stands.add(`${c}:${statics.x[i]},${statics.y[i]},${statics.z[i]}`);
    const snap = (v: number) => Math.fround(Math.round(v * STRUCT_UNITS) / STRUCT_UNITS);
    for (const l of marks.placed) for (let i = 0; i < l.far.pieces; i++) {
      landmarkPoint(l.x, l.y, l.z, l.yaw, [l.far.at[i * 3]!, l.far.at[i * 3 + 1]!, l.far.at[i * 3 + 2]!], point);
      expect(stands.has(`${l.chunk[i]}:${snap(point[0]!)},${snap(point[1]!)},${snap(point[2]!)}`), `${l.far.name} piece ${i}`).toBe(true);
    }
    const client = h.client(session)!, ents = h.world.ents;
    // Per landmark: whether it was seen wholly near, wholly far, and partly each.
    const was = names.map(() => ({ near: false, far: false, mixed: false }));
    // West of the ship out to 2 km and back, then west of the yacht and back.
    const koru = CRUISE_COURSE.koru;
    const stops = [...[115, 180, 220, 280, 650, 900, 1300, 2000, 1300, 900, 650, 280, 220, 180, 115].map(d => [origin.x - d, origin.z, d] as const),
      ...[60, 700, 60].map(d => [koru.x - d, koru.z, d] as const)];
    for (const [cx, cz, distance] of stops) {
      ents.setPosition(client.ent, cx, 33.38, cz);
      ents.vx[client.ent] = ents.vy[client.ent] = ents.vz[client.ent] = 0;
      ents.mode[client.ent] = MODE_GHOST; ents.flags[client.ent] &= ~F_GROUNDED; client.ownDirty = true;
      app.controls.yaw = Math.PI / 2; app.controls.pitch = 0; run(1300);
      const p = packet as FramePacket | null; expect(p).not.toBeNull();
      const reach = scene.assets.tier.reach.city, cam = app.cam;
      // Per piece, how many far draws take it in each depth range; and the chunks the near store drew a landmark's mesh of.
      const taken = marks.placed.map(l => new Uint8Array(l.far.pieces * 2));
      const nearChunks = new Set<number>();
      let shipDraws = 0;
      for (let d = 0; d < p!.drawCount; d++) {
        const id = ids[p!.drawMesh[d]!]!;
        if (p!.drawBuffer[d] === LANDMARK_BUFFER) {
          const l = marks.placed[p!.drawFirst[d]!]!, lod = p!.drawLod[d] as 0 | 1, from = p!.drawFirstIndex[d]!, end = from + p!.drawIndexCount[d]!;
          expect(id).toBe(`${l.far.name}:far`);
          expect(p!.drawFlags[d]! & (DRAW_RANGED | DRAW_PLAIN)).toBe(DRAW_RANGED | DRAW_PLAIN);
          let whole = 0;
          for (let i = 0; i < l.far.pieces; i++) {
            const a = l.far.first[lod][i]!, b = a + l.far.count[lod][i]!;
            if (a < from || b > end) continue;
            taken[l.instance]![i * 2 + p!.drawPass[d]!]!++;
            whole += b - a;
          }
          expect(whole, `a far draw of ${l.far.name} at ${distance} m takes whole pieces`).toBe(end - from);
          if (l.far.name === "cruise") shipDraws++;
        } else if (names.includes(id.split(":")[0]!) && p!.drawBuffer[d]! < NODE_BUFFERS) nearChunks.add(p!.drawBuffer[d]!);
      }
      const faults: string[] = [];
      for (const l of marks.placed) {
        let near = 0, far = 0;
        for (let i = 0; i < l.far.pieces; i++) {
          const chunk = l.chunk[i]!, r = l.far.radius[i]!, x = l.at[i * 3]! - cam.x, y = l.at[i * 3 + 1]! - cam.y, z = l.at[i * 3 + 2]! - cam.z;
          const seen = cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r) && Math.hypot(x, y, z) - r < reach;
          const drawn = taken[l.instance]![i * 2]! + taken[l.instance]![i * 2 + 1]!;
          if (taken[l.instance]![i * 2]! > 1 || taken[l.instance]![i * 2 + 1]! > 1) faults.push(`${l.far.name} ${i} drawn far twice`);
          if (source.complete(chunk)) {
            near++;
            if (drawn > 0) faults.push(`${l.far.name} ${i} drawn near and far`);
            if (seen && !nearChunks.has(chunk)) faults.push(`${l.far.name} ${i} held near and not drawn`);
          } else {
            far++;
            if (nearChunks.has(chunk)) faults.push(`${l.far.name} ${i} drawn near from a chunk not held whole`);
            if (seen && drawn === 0) faults.push(`${l.far.name} ${i} not drawn`);
          }
        }
        const w = was[l.instance]!;
        w.near ||= far === 0; w.far ||= near === 0; w.mixed ||= near > 0 && far > 0;
        if (distance >= 650) expect(near, `${l.far.name} at ${distance} m`).toBe(0);
      }
      expect(faults, `at ${distance} m`).toEqual([]);
      expect(shipDraws).toBeLessThanOrEqual(32);
      expect([scene.city!.stats.missing, scene.city!.stats.unseen, scene.city!.stats.behind, marks.stats.unseen]).toEqual([0, 0, 0, 0]);
      expect([p!.dropped, p!.skipped, p!.casterDropped]).toEqual([0, 0, 0]);
    }
    expect(was).toEqual([{ near: true, far: true, mixed: true }, { near: true, far: true, mixed: false }]);
    expect(jobs).toBeGreaterThan(0);
    expect(held).toBe(0);
  } finally { h.host.shutdown(); }
});
