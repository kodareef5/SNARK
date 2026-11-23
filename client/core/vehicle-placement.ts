// The assembled vehicle is always created by the server. This preview uses the same physical envelope and landing test.
import type { KeyRow } from "./key-row.ts";
import { T_CANCEL, T_ROTATE, T_SNAP } from "./touch.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { handleIndex } from "../../shared/ids.ts";
import { CMD_VEHICLE, RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, VEHICLE_DEPLOY } from "../../shared/net/protocol.ts";
import { stanceHeight } from "../../shared/sim/character.ts";
import { FLAG_BLUEPRINT } from "../../shared/sim/items.ts";
import { boatRestY } from "../../shared/sim/boat.ts";
import { boatMeetsCapsule, boatMeetsVehicle, boatPlacement } from "../../shared/world/boat.ts";
import { skatePlacement } from "../../shared/world/skate-placement.ts";
import { carMeetsCapsule, carMeetsVehicle } from "../../shared/world/vehicle.ts";
import { isSkateboard, isRotorVehicle, isBoatVehicle } from "../../shared/sim/vehicle.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { helicopterMeetsCapsule, helicopterMeetsVehicle, helicopterPlacement } from "../../shared/world/helicopter.ts";
import { castWorld, HIT_NONE, rayHit } from "../../shared/world/ray.ts";
import { RemoteSample, type ClientSession } from "./session.ts";

const REACH = 11;
export const VEHICLE_PLACEMENT_REASONS: Readonly<Record<number, string>> = {
  [RESULT_NO_SUPPORT]: "Needs level ground, room for the tail and clear rotors",
  [RESULT_OBSTRUCTED]: "A body or vehicle is in the way",
  [RESULT_FAR]: "Move closer to the landing site",
  [RESULT_DENIED]: "Leave your seat before assembling",
  [RESULT_INVALID]: "The assembly is no longer in that inventory slot",
  [RESULT_BUSY]: "Wait for the current assembly request",
};

export class VehiclePlacement {
  active = false;
  kind = 0;
  /** Metres and protocol yaw units, unlike Builder's quantized structure positions. */
  readonly pose = { x: 0, y: 0, z: 0, yaw: 0 };
  problem = RESULT_NO_SUPPORT;
  notice = "";
  turn = 0;
  private selected = -1;
  private slot = -1;
  private item = 0;
  private suppressed = 0;
  private asked = 0;
  private refusal = "";
  private refusalUntil = 0;
  private boardRequest = false;
  private marineRequest = false;
  private readonly remote = new RemoteSample();

  /** An inventory button can start placement directly from any bag slot. */
  begin(slot: number): void { this.selected = slot; this.suppressed = 0; this.turn = 0; }
  cancel(): void { this.suppressed = this.item; this.selected = -1; this.active = false; this.notice = ""; }

  update(session: ClientSession, world: CollisionWorld, reg: Registry, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, yaw: number, nowMs: number): void {
    const inv = session.inventory;
    const slot = this.selected >= 0 ? this.selected : inv && inv.hotbar >= 0 && session.held >= 0 ? inv.hotbar + session.held : -1;
    const item = inv && slot >= 0 && slot < inv.cap && inv.count[slot]! > 0 && !(inv.flags[slot]! & FLAG_BLUEPRINT) ? inv.item[slot]! : 0;
    if (item !== this.item) { this.turn = 0; this.suppressed = 0; }
    this.item = item; this.slot = slot; this.kind = reg.vehicleDeploy[item] ?? 0;
    const def = reg.vehicle[this.kind];
    this.active = !!def && item !== this.suppressed && session.driving < 0 && session.own.seat === 0;
    if (!this.active || !def) { this.notice = ""; if (!def) this.selected = -1; return; }
    const hit = castWorld(world, ox, oy, oz, dx, dy, dz, REACH);
    let distance = hit === HIT_NONE ? 8 : rayHit.t;
    // The solid-world ray passes through water. Find the first wet plane before its solid hit.
    let waterHit = false;
    if (isBoatVehicle(def) && dy < -.001) for (let d = .25; d <= REACH; d += .25) {
      const water = world.hf.waterAt(ox + dx * d, oz + dz * d), t = (water - oy) / dy;
      if (Number.isFinite(t) && t >= 0 && t <= REACH && t <= (hit === HIT_NONE ? REACH : rayHit.t) && Math.abs(t - d) <= .5 &&
        Math.abs(world.hf.waterAt(ox + dx * t, oz + dz * t) - water) < .02) { distance = t; waterHit = true; break; }
    }
    const p = this.pose;
    p.x = ox + dx * distance; p.y = oy + dy * distance; p.z = oz + dz * distance;
    p.yaw = (Math.round(yaw * 65536 / (2 * Math.PI)) + this.turn * 4096) & 65535;
    if (isBoatVehicle(def)) {
      const rest = boatRestY(def.spec, world.hf.waterAt(p.x, p.z));
      if (Number.isFinite(rest)) p.y = rest;
    }
    const angle = p.yaw * 2 * Math.PI / 65536, frame = { ...p, yaw: angle, pitch: 0, roll: 0 };
    let problem = session.driving >= 0 || session.own.seat > 0 ? RESULT_DENIED : (isBoatVehicle(def) ? !waterHit : hit === HIT_NONE || rayHit.ny < (isSkateboard(def) ? .82 : .94)) ? RESULT_NO_SUPPORT : 0;
    if (!problem && !(isSkateboard(def) ? skatePlacement(world, p.x, p.y, p.z) : isBoatVehicle(def) ? boatPlacement(world, p.x, p.y, p.z, angle, def) : isRotorVehicle(def) && helicopterPlacement(world, p.x, p.y, p.z, angle, def))) problem = RESULT_NO_SUPPORT;
    if (!problem && (isRotorVehicle(def) || isBoatVehicle(def) || isSkateboard(def))) {
      const meetsCapsule = isSkateboard(def) ? (x: number, y: number, z: number, r: number, h: number) => carMeetsCapsule(def.spec, frame, x, y, z, r, h) : isBoatVehicle(def) ? (x: number, y: number, z: number, r: number, h: number) => boatMeetsCapsule(def, frame, x, y, z, r, h) : (x: number, y: number, z: number, r: number, h: number) => helicopterMeetsCapsule(def, frame, x, y, z, r, h);
      const me = reg.move[session.ownKind];
      if (me && meetsCapsule(session.own.x, session.own.y, session.own.z, me.radius, stanceHeight(me, session.own.stance))) problem = RESULT_OBSTRUCTED;
      session.sampleRemote(this.remote);
      for (let i = 0; !problem && i < this.remote.count; i++) {
        const r = this.remote, kind = r.kind[i]!;
        if (r.id[i] === handleIndex(session.ownHandle) || Math.hypot(r.x[i]! - p.x, r.y[i]! - p.y, r.z[i]! - p.z) > 18) continue;
        const other = reg.vehicle[kind];
        const otherFrame = {
          x: r.x[i]!, y: r.y[i]!, z: r.z[i]!, yaw: r.yaw[i]!, pitch: r.vehiclePitch[i]!, roll: r.vehicleRoll[i]!, steering: r.steering[i]!,
          ...(other ? { qx: r.vehicleQx[i]!, qy: r.vehicleQy[i]!, qz: r.vehicleQz[i]!, qw: r.vehicleQw[i]! } : {}),
        };
        if (other ? (isSkateboard(def) ? carMeetsVehicle(def.spec, frame, other, otherFrame) : isBoatVehicle(def) ? boatMeetsVehicle(def, frame, other, otherFrame) : helicopterMeetsVehicle(def, frame, other, otherFrame)) : reg.move[kind] && meetsCapsule(r.x[i]!, r.y[i]!, r.z[i]!, reg.bodyRadius[kind]!, reg.bodyHeight[kind]!)) problem = RESULT_OBSTRUCTED;
      }
    }
    this.problem = this.asked ? RESULT_BUSY : problem;
    this.notice = nowMs < this.refusalUntil ? this.refusal : (isSkateboard(def) && this.problem === RESULT_NO_SUPPORT ? "Place on a clear, dry surface" : isBoatVehicle(def) && this.problem === RESULT_NO_SUPPORT ? "Needs open water with room for the hull and outboard" : VEHICLE_PLACEMENT_REASONS[this.problem]) ?? "Assemble • click   Rotate • Q / E   Cancel • Esc";
  }

  key(code: string, down: boolean, repeat: boolean): boolean {
    if (!this.active || !["KeyQ", "KeyE", "Escape"].includes(code)) return false;
    if (down && !repeat) { if (code === "Escape") this.cancel(); else this.turn = (this.turn + (code === "KeyQ" ? 15 : 1)) % 16; }
    return true;
  }
  place(session: ClientSession): number {
    if (!this.active || this.problem !== RESULT_OK || this.asked) return 0;
    const p = this.pose;
    this.boardRequest = isSkateboard(session.registry.vehicle[this.kind]);
    this.marineRequest = session.registry.vehicle[this.kind]?.movement === "boat";
    this.asked = session.command(CMD_VEHICLE, w => { w.u8(VEHICLE_DEPLOY); w.u8(this.slot); w.f32(p.x); w.f32(p.y); w.f32(p.z); w.u16(p.yaw); });
    return this.asked;
  }
  result(seq: number, code: number, nowMs: number): void {
    if (seq === 0 || seq !== this.asked) return;
    this.asked = 0;
    if (code === RESULT_OK) { this.cancel(); return; }
    this.refusal = (this.boardRequest && code === RESULT_NO_SUPPORT ? "Place on a clear, dry surface" : this.marineRequest && code === RESULT_NO_SUPPORT ? "Needs open water with room for the hull and outboard" : VEHICLE_PLACEMENT_REASONS[code]) ?? "The vehicle cannot be assembled here";
    this.refusalUntil = nowMs + 2500;
  }
}

// While a vehicle is being placed Q and E turn it and Escape leaves off (VehiclePlacement.key), before any screen has the key.
export const PLACEMENT_KEYS: readonly KeyRow[] = [{
  name: "place vehicle",
  keys: ["KeyQ", "KeyE", "Escape"],
  touch: { KeyE: T_ROTATE, KeyQ: T_SNAP, Escape: T_CANCEL },
  when: (c) => !c.ui.captureKeyboard && c.vehiclePlacement.active,
  press: (c, code, down, repeat) => c.vehiclePlacement.key(code, down, repeat) || undefined,
}];
