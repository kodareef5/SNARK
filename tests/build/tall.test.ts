import { expect, test } from "bun:test";
import { FOUNDATION_THICK } from "../../content/building.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { HIT_STRUCTURE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { poseAt, type Pose } from "../../shared/world/snap.ts";
import { Support } from "../../shared/world/support.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

/** `count` walls stacked far overhead in the grid cells of (x, z). They are newer than what is there, so a query lists them first. */
function pile(w: TestWorld, x: number, z: number, count: number): void {
  const wall = w.kind("core:wall");
  for (let n = 0; n < count; n++) w.structs.add(wall, x, 100 + n * 3.3, z, 0, 0, 1);
}

test("the oldest piece of a tall column still stops a body and a ray, and still holds up what is built on it", () => {
  const w = flatWorld(4);
  const old = w.structs.add(w.kind("core:wall"), 30, 1.5, 30, 0, 0, 1);
  pile(w, 30, 30, 1100);
  const body = w.reg.move[w.kind("core:survivor")]!;
  expect(capsuleFree(w, 30, 0, 30, body.radius, body.height)).toBe(false);
  expect(castWorld(w, 30, 1, 26, 0, 0, 1, 8)).toBe(HIT_STRUCTURE);
  expect(rayHit.ref).toBe(old);

  const wood = (piece: string): number => w.kind(`core:${piece}_wood`);
  const foundation = w.structs.add(wood("foundation"), 100, FOUNDATION_THICK / 2, 100, 0, 7, 1);
  pile(w, 100, 100, 300);
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  expect(poseAt(w.structs, w.reg, foundation, wood("wall"), 0, 0, pose)).toBe(true);
  expect(support.stands(wood("wall"), pose.x, pose.y, pose.z, pose.yaw)).toBe(true);
});
