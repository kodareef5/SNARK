import { expect, test } from "bun:test";
import { artTest } from "../fixtures/needs-art.ts";
import { App } from "../../client/core/app.ts";
import { InlineCityMaker, type CityJob } from "../../client/core/render/citymake.ts";
import { CITY_BUFFER } from "../../client/core/render/farcity.ts";
import { LANDMARK_BUFFER } from "../../client/core/render/farlandmarks.ts";
import { DRAW_DETAILS, DRAW_PLAIN, DRAW_RANGED, DRAW_TEXTURED, type FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { CRUISE_COLLISION_INSTANCES, CRUISE_LAYOUT, cruiseStatics } from "../../content/landmarks/cruise.ts";
import { STRUCT_UNITS, chunkAt } from "../../shared/coords.ts";
import { landmarkPoint } from "../../shared/world/landmark.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { CRUISE_COURSE, cruiseCourse } from "../../tools/cruise/course.ts";
import { assertCruisePlaced } from "../../tools/cruise/preflight.ts";
import { Harness } from "../fixtures/net.ts";
import { cruisePack } from "../fixtures/cruise.ts";

test("cruise visual and physical cells keep the same owner after arbitrary native placement", () => {
  const instances = CRUISE_COLLISION_INSTANCES.filter(instance => instance.placed);
  const byId = new Map(instances.map(instance => [instance.id, instance]));
  const cells = new Map(CRUISE_LAYOUT.cells.map(cell => [cell.id, cell]));
  const doors = new Set(CRUISE_LAYOUT.doors.map(door => door.instanceId));
  expect(cells.size).toBeGreaterThan(0);
  expect(instances.length).toBeGreaterThan(cells.size);
  const faults: string[] = [];
  for (const cell of cells.values()) {
    const anchor = byId.get(cell.anchor);
    if (!anchor || anchor.cell !== cell.id || anchor.yaw !== 0 || anchor.at.some((v, axis) => v !== cell.origin[axis])) faults.push(`${cell.id}: anchor does not share the exact cell frame`);
  }
  for (const instance of instances) {
    const cell = instance.cell ? cells.get(instance.cell) : undefined;
    if (!cell && !doors.has(instance.id)) faults.push(`${instance.id}: non-door physical module has no visual cell`);
    if (cell && (instance.yaw !== 0 || instance.at.some((v, axis) => v !== cell.origin[axis]))) faults.push(`${instance.id}: physical/far owner differs from its visual cell`);
  }
  expect(faults).toEqual([]);
  // Identical local frames prove equality for any transform. These boundary-adjacent placements
  // additionally exercise the actual frameAxes rounding and 1/512 m native placement quantization.
  for (const [x, z] of [[2048, 2048], [2063.998046875, 2056.001953125], [2111.9990234375, 2048.0009765625]]) {
    for (const yaw of [0, 1, 8192, 12345, 16384, 32768, 49152, 65535]) {
      const rows = cruiseStatics(x!, 0, z!, yaw);
      expect(rows.length).toBe(instances.length);
      const placed = new Map(instances.map((instance, i) => [instance.id, rows[i]!]));
      const mismatches: string[] = [];
      for (const instance of instances) {
        const cell = instance.cell ? cells.get(instance.cell) : undefined;
        if (!cell) continue;
        const row = placed.get(instance.id)!, anchor = placed.get(cell.anchor)!;
        if (row.x !== anchor.x || row.y !== anchor.y || row.z !== anchor.z || row.yaw !== anchor.yaw ||
            chunkAt({ chunksX: 64, chunksZ: 64 }, row.x, row.z) !== chunkAt({ chunksX: 64, chunksZ: 64 }, anchor.x, anchor.z)) mismatches.push(instance.id);
      }
      expect(mismatches, `native placement ${x},${z} yaw${yaw}`).toEqual([]);
    }
  }
});

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
      expect([scene.city!.stats.missing, scene.city!.stats.unseen, scene.city!.stats.behind]).toEqual([0, 0, 0]);
      expect([p!.dropped, p!.skipped, p!.casterDropped]).toEqual([0, 0, 0]);
    }
    expect(was).toEqual([{ near: true, far: true, mixed: true }, { near: true, far: true, mixed: false }]);
    expect(jobs).toBeGreaterThan(0);
    expect(held).toBe(0);
  } finally { h.host.shutdown(); }
});

// A landmark's art is authored down to its flat levels, which keep its palette colours on every tier, near and in its far
// mesh. A core piece's flat draws take the world finish on the lit tiers and the checker on low poly, as before.
artTest("a flat draw of a ship cell or of the ship's far mesh is plain on every tier, and a flat draw of a core piece is not", () => {
  const map = cruiseCourse(), pack = cruisePack(map.content!.landmarks.map(l => l.name)), c = CRUISE_COURSE;
  const h = new Harness({}, 629, 60, { dev: true, map: writeMap(map), clips: pack.clips, rigs: pack.header.rigs });
  try {
    const session = h.join("quay", {}, { manual: true }), app = new App(session, h.reg, pack);
    session.staticsArrived(h.world.statics!);
    app.ui.settings.steady = false;
    let packet: FramePacket | null = null;
    const run = (ms: number) => h.run(ms, now => { packet = app.frame(now, 1280, 720); });
    run(900); session.text("enablecheats"); run(100); session.text("fly"); run(100);
    const client = h.client(session)!, ents = h.world.ents, scene = app.scene!;
    const pieces = new Set(map.statics.filter(s => s.kind.startsWith("core:")).map(s => scene.assets.bind.mesh(s.kind, "mesh")));
    const ids = scene.assets.manifest.meshes.map(m => m.id);
    // From the quay, and from 900 m off where the far mesh draws the whole ship.
    for (const tier of ["lowpoly", "medium", "high"] as const) for (const [x, z, yaw, pitch] of [[c.quayX + 40, c.vessel.z - 60, -Math.PI / 2 - 0.5, -0.2], [c.vessel.x - 900, c.vessel.z, Math.PI / 2, 0]] as const) {
      app.ui.settings.tier = tier;
      ents.setPosition(client.ent, x, 30, z);
      ents.vx[client.ent] = ents.vy[client.ent] = ents.vz[client.ent] = 0;
      ents.mode[client.ent] = MODE_GHOST; ents.flags[client.ent] &= ~F_GROUNDED; client.ownDirty = true;
      app.controls.yaw = yaw; app.controls.pitch = pitch; run(1300);
      const p = packet as FramePacket | null; expect(p).not.toBeNull();
      expect([p!.tier.name, p!.lit]).toEqual([tier, tier !== "lowpoly"]);
      let ship = 0, far = 0, core = 0;
      for (let d = 0; d < p!.drawCount; d++) {
        const flags = p!.drawFlags[d]!, mesh = p!.drawMesh[d]!;
        if ((flags & (DRAW_DETAILS | DRAW_TEXTURED)) !== 0 || p!.drawBuffer[d] === CITY_BUFFER) continue;
        if (/^cruise:(cell_\d+|far)$/.test(ids[mesh]!)) {
          if (p!.drawBuffer[d] === LANDMARK_BUFFER) far++;
          else ship++;
          expect(flags & DRAW_PLAIN, `${tier} ${ids[mesh]}`).toBe(DRAW_PLAIN);
        } else if (pieces.has(mesh)) {
          core++;
          expect(flags & DRAW_PLAIN, `${tier} ${ids[mesh]}`).toBe(0);
        }
      }
      expect(x > c.vessel.x ? [ship > 0, core > 0] : [far > 0]).toEqual(x > c.vessel.x ? [true, true] : [true]);
    }
  } finally { h.host.shutdown(); }
});
