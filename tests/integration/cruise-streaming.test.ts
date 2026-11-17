import { expect, test } from "bun:test";
import { artTest } from "../fixtures/needs-art.ts";
import { App } from "../../client/core/app.ts";
import { CITY_BUFFER } from "../../client/core/render/farcity.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { CRUISE_COLLISION_INSTANCES, CRUISE_LAYOUT, cruiseStatics } from "../../content/landmarks/cruise.ts";
import { chunkAt } from "../../shared/coords.ts";
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

// Collision-only modules do not own draws. The map's cell anchors own near meshes; the complete
// cell-clipped collision/look rows supply the far proxy after their shared chunk leaves interest.
artTest("native cruise cell anchors retain one render owner from near through 2 km and back", () => {
  const map = cruiseCourse(), pack = cruisePack(map.content!.landmarks), origin = CRUISE_COURSE.vessel;
  const rows = cruiseStatics(origin.x, origin.y, origin.z, origin.yaw);
  const chunks = [...new Set(rows.map(row => chunkAt(map.dims, row.x, row.z)))];
  const h = new Harness({}, 629, 60, { dev: true, map: writeMap(map), clips: pack.clips, rigs: pack.header.rigs });
  try {
    expect(assertCruisePlaced(map, h.world.structs, h.reg).length).toBe(map.statics.length);
    const anchors = rows.flatMap(row => {
      const def = h.reg.defs[h.reg.index.get(row.kind)!];
      if (def?.type !== "structure" || !/^cruise:cell_\d+$/.test(def.mesh)) return [];
      const mesh = pack.header.meshes[pack.meshIndex.get(def.mesh)!];
      expect(mesh, `native cell mesh ${def.mesh}`).toBeDefined();
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], point = [0, 0, 0];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
        landmarkPoint(row.x, row.y, row.z, row.yaw, [mesh!.center[0] + x * mesh!.half[0], mesh!.center[1] + y * mesh!.half[1], mesh!.center[2] + z * mesh!.half[2]], point);
        for (let axis = 0; axis < 3; axis++) { lo[axis] = Math.min(lo[axis]!, point[axis]!); hi[axis] = Math.max(hi[axis]!, point[axis]!); }
      }
      return [{ mesh: def.mesh, chunk: chunkAt(map.dims, row.x, row.z), lo, hi }];
    });
    expect(anchors.length).toBeGreaterThan(0);
    expect(new Set(anchors.map(anchor => anchor.mesh)).size).toBe(anchors.length);
    const anchorChunks = new Map(anchors.map(anchor => [anchor.mesh, anchor.chunk]));
    const physical = CRUISE_COLLISION_INSTANCES.filter(instance => instance.placed).flatMap((instance, i) => {
      const anchorChunk = instance.cell ? anchorChunks.get(instance.cell) : undefined;
      return anchorChunk === undefined ? [] : [{ id: instance.id, anchorChunk, chunk: chunkAt(map.dims, rows[i]!.x, rows[i]!.z) }];
    });
    expect(physical.length).toBeGreaterThanOrEqual(anchors.length);
    const session = h.join("ship-observer", {}, { manual: true }), app = new App(session, h.reg, pack);
    session.staticsArrived(h.world.statics!);
    app.ui.settings.tier = "high"; app.ui.settings.steady = false;
    let packet: FramePacket | null = null;
    const run = (ms: number) => h.run(ms, now => { packet = app.frame(now, 1920, 600); });
    run(900); session.text("enablecheats"); run(100); session.text("fly"); run(100);
    const client = h.client(session)!, ents = h.world.ents;
    let mixed = false, entirelyNear = false, entirelyFar = false;
    for (const distance of [115, 180, 220, 280, 650, 900, 1300, 2000, 1300, 900, 650, 280, 220, 180, 115]) {
      ents.setPosition(client.ent, origin.x - distance, 33.38, origin.z);
      ents.vx[client.ent] = ents.vy[client.ent] = ents.vz[client.ent] = 0;
      ents.mode[client.ent] = MODE_GHOST; ents.flags[client.ent] &= ~F_GROUNDED; client.ownDirty = true;
      app.controls.yaw = Math.PI / 2; app.controls.pitch = 0; run(1300);
      const p = packet as FramePacket | null; expect(p).not.toBeNull();
      const city = app.scene!.city!, source = session.world!.city!, far = chunks.filter(chunk => city.isFar(chunk));
      mixed ||= far.length > 0 && far.length < chunks.length; entirelyNear ||= far.length === 0; entirelyFar ||= far.length === chunks.length;
      const nearDraws = new Set<string>(); let cityDraws = 0;
      for (let i = 0; i < p!.drawCount; i++) {
        if (p!.drawBuffer[i] === CITY_BUFFER) cityDraws++;
        const id = pack.header.meshes[p!.drawMesh[i]!]?.id;
        if (id?.startsWith("cruise:cell_")) nearDraws.add(`${p!.drawBuffer[i]}:${id}`);
      }
      for (const chunk of chunks) {
        expect(source.complete(chunk)).toBe(!far.includes(chunk));
      }
      const badOwners = physical.filter(module => Number(source.complete(module.anchorChunk)) + Number(city.isFar(module.chunk)) !== 1).map(module => module.id);
      expect(badOwners, `physical/far and visual ownership at ${distance} m`).toEqual([]);
      let visibleNear = 0;
      for (const anchor of anchors) {
        const visible = app.cam.boxVisible(anchor.lo[0]! - p!.camX, anchor.lo[1]! - p!.camY, anchor.lo[2]! - p!.camZ,
          anchor.hi[0]! - p!.camX, anchor.hi[1]! - p!.camY, anchor.hi[2]! - p!.camZ);
        const drawn = nearDraws.has(`${anchor.chunk}:${anchor.mesh}`);
        if (far.includes(anchor.chunk)) expect(drawn, `far-owned ${anchor.mesh} at ${distance} m`).toBe(false);
        else if (visible) { visibleNear++; expect(drawn, `visible near cell ${anchor.mesh} at ${distance} m`).toBe(true); }
      }
      if (!far.length) expect(visibleNear).toBeGreaterThan(0);
      if (far.length) expect(cityDraws).toBeGreaterThan(0);
      if (distance >= 650) expect(far.length).toBe(chunks.length);
      expect(city.stats.missing).toBe(0); expect(city.stats.unseen).toBe(0); expect(city.stats.behind).toBe(0);
      expect([p!.dropped, p!.skipped, p!.casterDropped]).toEqual([0, 0, 0]);
    }
    expect([mixed, entirelyNear, entirelyFar]).toEqual([true, true, true]);
  } finally { h.host.shutdown(); }
});
