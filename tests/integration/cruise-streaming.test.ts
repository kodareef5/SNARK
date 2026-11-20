import { expect, test } from "bun:test";
import { artTest } from "../fixtures/needs-art.ts";
import { App } from "../../client/core/app.ts";
// The app's scenes draw the far city, which a page fetches after its first frame (D873).
import "../../client/core/render/city-late.ts";
import { CITY_BUFFER } from "../../client/core/render/farcity.ts";
import { LANDMARK_BUFFER } from "../../client/core/render/farlandmarks.ts";
import { DRAW_DETAILS, DRAW_PLAIN, DRAW_TEXTURED, type FramePacket } from "../../client/core/render/packet.ts";
import { CRUISE_COLLISION_INSTANCES, CRUISE_LAYOUT, cruiseStatics } from "../../content/landmarks/cruise.ts";
import { chunkAt } from "../../shared/coords.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { CRUISE_COURSE, cruiseCourse } from "../../tools/cruise/course.ts";
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
