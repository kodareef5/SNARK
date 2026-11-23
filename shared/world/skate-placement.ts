import { capsuleFree, type CollisionWorld } from "./collide.ts";
import { castWorld, HIT_NONE, rayHit } from "./ray.ts";

/** A dry, supported deck with room for its standing rider. Works on a street piece above terrain. */
export function skatePlacement(world: CollisionWorld, x: number, y: number, z: number): boolean {
  return world.hf.waterAt(x, z) <= y + .04 && castWorld(world, x, y+.12, z, 0, -1, 0, .23, true) !== HIT_NONE &&
    rayHit.ny >= .82 && Math.abs(rayHit.t-.12) < .08 && capsuleFree(world, x, y+.04, z, .17, 1.65);
}
