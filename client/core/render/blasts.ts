// What burns: a rocket's flame and the smoke it leaves, a launcher's flash and backblast, and a blast's fire, smoke, dust
// and debris. They are pictures and decide nothing. Shots (client/core/shots.ts) says what flies and what went off, and
// the scene draws what is alight.

import type { Registry } from "../../../shared/content/registry.ts";
import type { Camera } from "./camera.ts";
import type { FramePacket } from "./packet.ts";

export class Blasts {
  /** The owner replaces this when the server's tuning arrives. */
  reg: Registry;

  constructor(reg: Registry) {
    this.reg = reg;
  }

  /**
   * A round with a motor left (ox, oy, oz) at `bornMs`, which may be past, at the velocity (vx, vy, vz), falling at
   * `gravity`, with `flame` metres of fire behind it. `key` names it until `end`: any whole number no other flying round has.
   * Its smoke is laid along that path from then on.
   */
  fly(key: number, ox: number, oy: number, oz: number, vx: number, vy: number, vz: number, gravity: number, flame: number, bornMs: number): void {
    void [key, ox, oy, oz, vx, vy, vz, gravity, flame, bornMs];
  }

  /** Where round `key`'s tail is this frame and its unit way: its flame is drawn there. Once a frame while it flies. */
  at(key: number, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    void [key, x, y, z, dx, dy, dz];
  }

  /** Round `key` is gone: its flame is out, and its smoke ends where it was at `nowMs` and thins away. */
  end(key: number, nowMs: number): void {
    void [key, nowMs];
  }

  /**
   * A launcher fired: a flash at its muzzle (mx, my, mz) along the unit way (dx, dy, dz), and a backblast from its vent
   * (vx, vy, vz) against it. `own` is the viewer's own shot, which shakes its view.
   */
  launch(mx: number, my: number, mz: number, vx: number, vy: number, vz: number, dx: number, dy: number, dz: number, seed: number, own: boolean, nowMs: number): void {
    void [mx, my, mz, vx, vy, vz, dx, dy, dz, seed, own, nowMs];
  }

  /**
   * A blast at (x, y, z) reaching `radius` metres, on a surface whose unit way out is (nx, ny, nz). `look` is an index
   * into BURST_LOOKS, `surface` and `made` what it met (shared/net/rockets.ts SURFACE_, MADE_), and `seed` what every
   * client draws it from (blastSeed).
   */
  burst(look: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, radius: number, surface: number, made: number, seed: number, nowMs: number): void {
    void [look, x, y, z, nx, ny, nz, radius, surface, made, seed, nowMs];
  }

  /** Queues what is alight into the frame. */
  draw(p: FramePacket, cam: Camera, nowMs: number): void {
    void [p, cam, nowMs];
  }
}
