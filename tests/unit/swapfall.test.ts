// A piece may change kind in place while a collapse is being worked out: a fire goes out, a door is opened. It is still judged.

import { expect, test } from "bun:test";
import { FOUNDATION_THICK } from "../../content/building.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { Collapse } from "../../shared/world/collapse.ts";
import { poseAt, type Pose } from "../../shared/world/snap.ts";
import { GONE_FELL, GONE_TAKEN } from "../../shared/world/structures.ts";
import { flatWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;

test("a fire that goes out while the floor under it is coming down comes down with it", () => {
  for (const goesOut of [false, true]) {
    const w = flatWorld(4);
    const kind = (name: string): number => w.kind(`core:${name}`);
    const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
    const join = (target: number, piece: string, k: number): number => {
      expect(poseAt(w.structs, w.reg, target, kind(piece), k, 0, pose)).toBe(true);
      return w.structs.add(kind(piece), pose.x / U, pose.y / U, pose.z / U, pose.yaw, 3, 100);
    };
    const there = (ref: number): boolean => w.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff] !== 0;
    // A foundation, a wall on its edge, a floor off the wall's top, and a lit campfire in the middle of that floor.
    const ground = w.structs.add(kind("foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 0, 3, 100);
    const wall = join(ground, "wall_wood", 0);
    const floor = join(wall, "ceiling_wood", 1);
    const t = w.structs.chunks[Math.floor(floor / 65536)]!;
    const top = t.y[floor & 0xffff]! + w.reg.halfY[kind("ceiling_wood")]!;
    const fire = w.structs.add(kind("campfire_lit"), 100, top + w.reg.halfY[kind("campfire_lit")]!, 100, 0, 3, 100);

    const collapse = new Collapse(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
    w.structs.onRemove = (ref, cause) => void (cause !== GONE_FELL && collapse.gone(ref));
    w.structs.remove(ground, GONE_TAKEN, 1);
    // The first wave takes the wall and the floor. The fire stood on the floor when it was judged, so it waits for the next.
    collapse.step(16000, 1);
    expect([there(wall), there(floor), there(fire), collapse.busy]).toEqual([false, false, true, true]);
    // Its fuel runs out between the two: the row becomes the unlit kind, as server/stations.ts does it.
    if (goesOut) expect(w.structs.swap(fire, kind("campfire"))).toBe(true);
    for (let calls = 0; collapse.busy && calls < 50; calls++) collapse.step(16000, 2);
    expect([goesOut, collapse.busy, there(fire)]).toEqual([goesOut, false, false]);
  }
});
