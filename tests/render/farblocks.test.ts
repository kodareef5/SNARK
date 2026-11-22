// Far blocks between a real server and a real client: the session says a chunk is whole once its last row has come and
// until the server lets go of it, and a scene drawn from the session's world shows a base near while it is whole and as
// blocks after.

import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { FAR_BUFFER } from "../../client/core/render/far.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { chunkAt } from "../../shared/coords.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { farPack } from "../fixtures/farworld.ts";
import { Harness } from "../fixtures/net.ts";

const DIMS = { chunksX: 32, chunksZ: 4 };
const SAMPLES = ((DIMS.chunksX * 64) / TERRAIN_CELL + 1) * ((DIMS.chunksZ * 64) / TERRAIN_CELL + 1);
/** A flat map 2 km by 256 m, its ground at 0. */
const MAP = writeMap({ id: "test:farblocks", dims: DIMS, minY: -32, stepY: 1 / 256, seaLevel: -Infinity, heights: new Uint16Array(SAMPLES).fill(32 * 256), tint: new Uint8Array(SAMPLES).fill(1), statics: [], nodes: [], spawns: [{ name: "West", x: 100, z: 100, yaw: 0 }] });

test("a base the survivor stands by is drawn near once its rows are whole, and as blocks once the server lets go of its chunk", () => {
  const h = new Harness({}, 1, 60, { map: MAP });
  const k = (id: string): number => h.reg.index.get(`core:${id}`)!;
  for (let i = 0; i < 6; i++) h.world.structs.add(k("pillar"), 162, 3.3 + i * 6, 100, 0, 7, 100);
  const chunk = chunkAt(DIMS, 162, 100);
  const s = h.join("ada");
  h.run(100, () => s.askFar(1024));
  h.client(s)!.admin = true;
  const until = (holds: () => boolean): void => {
    for (let ms = 0; ms < 5000 && !holds(); ms += 100) h.run(100, () => s.askFar(1024));
    expect(holds()).toBe(true);
  };
  until(() => s.world!.far.complete(chunk) && s.far.chunks.has(chunk));
  const scene = new Scene(s.world!, h.reg, farPack());
  const cam = new Camera();
  const drawn = (): string => {
    [cam.x, cam.y, cam.z, cam.yaw] = [s.own.x, 1.6, s.own.z, Math.atan2(162 - s.own.x, 100 - s.own.z)];
    const p = scene.build(cam, null);
    const far = p.drawBuffer.subarray(0, p.drawCount).includes(FAR_BUFFER);
    const near = p.drawBuffer.subarray(0, p.drawCount).includes(chunk);
    return far === near ? "both or neither" : far ? "far" : "near";
  };
  expect(drawn()).toBe("near");
  // Taken 1.4 km east, past the rows a client is sent, the chunk is let go and drawn as blocks.
  h.say(s, "tp 1550 100");
  until(() => !s.world!.far.complete(chunk));
  expect(s.world!.structs.chunks[chunk]).toBeNull();
  expect(drawn()).toBe("far");
  h.say(s, "tp 120 100");
  until(() => s.world!.far.complete(chunk));
  expect(drawn()).toBe("near");
});
