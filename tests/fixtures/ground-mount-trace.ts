// Cross-engine course over a compound hill with a stationary obstacle, real controls and both authored saddle sockets.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CreatureAnim } from "../../shared/anim/creature.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { SEAT_FLOATS, seatOn } from "../../shared/anim/seat.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { GroundBodies } from "../../shared/sim/body-contact.ts";
import { Body, BTN_SPRINT, stepBody } from "../../shared/sim/character.ts";
import { groundUnder } from "../../shared/world/collide.ts";
import { GroundMountFrame, groundMountFrame } from "../../shared/world/ground-mount.ts";
import { flatWorld } from "./world.ts";

export function groundMountTrace(): string {
  const world = flatWorld(4), frame = new GroundMountFrame(), hash = createHash("sha256");
  const hf = world.hf;
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    const crossfall = .15 * Math.min(12, Math.max(-12, i * hf.cell - 128));
    const hill = .364 * Math.max(0, Math.min(j * hf.cell - 48, 112 - j * hf.cell));
    hf.setSample(i, j, 18 + crossfall + hill);
  }
  const obstacle = world.reg.move[world.kind("core:parasaur")]!;
  const neighbours = new GroundBodies();
  neighbours.add(12, 128, groundUnder(hf, 128, 75, obstacle.radius), 75, obstacle.radius, obstacle.height);

  for (const species of ["raptor", "parasaur"]) {
    const id = "core:" + species, kind = world.kind(id), move = world.reg.tamedMove[kind]!;
    const pack = parsePack(readFileSync(new URL("./art/" + species + ".snpk", import.meta.url)));
    const rig = buildRigs(pack.header.rigs, pack.clips).get(id)!;
    const anim = new CreatureAnim(rig, world.reg.runAt[kind]!, move.swimSpeed), state = new AnimState();
    const seat = world.reg.saddleSeats[world.kind("core:saddle_" + species)]![0]!, saddle = new Float64Array(SEAT_FLOATS);
    const body = new Body();
    body.x = 128; body.z = 56; body.y = groundUnder(hf, body.x, body.z, move.radius);
    body.grounded = true; body.staminaMax = 10000; body.stamina = 10000000;
    let nearest = Infinity, farthest = body.z;
    for (let tick = 0; tick < 480; tick++) {
      const yaw = tick < 180 ? 0 : tick < 270 ? 32768 : tick < 365 ? 8192 : 0;
      stepBody(world, body, 0, 127, yaw, 0, BTN_SPRINT, move, TICK_DT, neighbours);
      const angle = body.yaw * 2 * Math.PI / 65536;
      groundMountFrame(world, move, body.x, body.y, body.z, angle, frame);
      state.setMotion(body.vx, body.vz, angle, 0, body.vy);
      state.grounded = body.grounded; state.mode = body.mode;
      seatOn(anim, seat, state, tick, body.x, body.y, body.z, angle, saddle, world, move);
      const sample = Float32Array.of(body.x, body.y, body.z, body.vx, body.vy, body.vz, ...frame.rotation, frame.lift, ...saddle);
      if (!sample.every(Number.isFinite)) throw new Error(species + " produced nonfinite motion or saddle geometry");
      hash.update(new Uint8Array(sample.buffer));
      nearest = Math.min(nearest, Math.hypot(body.x - 128, body.z - 75));
      farthest = Math.max(farthest, body.z);
    }
    if (nearest > move.radius + obstacle.radius + .1 || farthest < 78) throw new Error(species + " missed the contact or the escape");
  }
  return hash.digest("hex");
}

if (import.meta.main) console.log(groundMountTrace());
