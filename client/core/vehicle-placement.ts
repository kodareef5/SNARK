// The assembled vehicle is always created by the server. This preview uses the same physical envelope and landing test.
import type { KeyRow } from "./key-row.ts";
import { T_CANCEL, T_ROTATE, T_SNAP } from "./touch.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { handleIndex } from "../../shared/ids.ts";
import { CMD_VEHICLE, RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, VEHICLE_DEPLOY, VEHICLE_RIDE } from "../../shared/net/protocol.ts";
import { stanceHeight } from "../../shared/sim/character.ts";
import { FLAG_BLUEPRINT } from "../../shared/sim/items.ts";
import { boatRestY } from "../../shared/sim/boat.ts";
import { isSkateboard, isRotorVehicle, isBoatVehicle } from "../../shared/sim/vehicle.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { castWorld, HIT_NONE, rayHit } from "../../shared/world/ray.ts";
import { RemoteSample, type ClientSession } from "./session.ts";
import { familyOf } from "../../shared/sim/families.ts";
import { hullParts, partMeetsBody } from "../../shared/sim/vehicle-hull.ts";

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
  /** The hotbar slot held when last seen, and whether a board picked there is being set down to ride. */
  private heldSeen: number | null = null;
  private riding = false;
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
    // A board picked in the hotbar goes down under the feet and is ridden at once. Only if it cannot is it placed by hand.
    const picked = this.heldSeen !== null && session.held !== this.heldSeen;
    this.heldSeen = session.held;
    if (picked && isSkateboard(def) && this.selected < 0 && !this.asked && session.driving < 0 && session.own.seat === 0) {
      const facing = Math.round(yaw * 65536 / (2 * Math.PI)) & 65535;
      this.boardRequest = true; this.marineRequest = false; this.riding = true;
      this.asked = session.command(CMD_VEHICLE, w => { w.u8(VEHICLE_RIDE); w.u8(slot); w.u16(facing); });
    }
    if (this.riding) { this.active = false; this.notice = ""; return; }
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
    if (!problem && !familyOf(def)!.supports(world, p.x, p.y, p.z, angle, def)) problem = RESULT_NO_SUPPORT;
    if (!problem && !(isRotorVehicle(def) || isBoatVehicle(def))) {
      // A car or a board: its hull's bodies against the bodies near, the test the server makes (vehiclePlaceProblem).
      session.sampleRemote(this.remote);
      const r = this.remote, own = session.ownKind;
      for (const part of hullParts(p.x, p.y, p.z, angle, def)) {
        if (partMeetsBody(part, session.own.x, session.own.y, session.own.z, reg.bodyHeight[own]!, reg.bodyRadius[own]!, null, 0)) problem = RESULT_OBSTRUCTED;
        for (let i = 0; !problem && i < r.count; i++) {
          const kind = r.kind[i]!;
          if (r.id[i] === handleIndex(session.ownHandle) || Math.hypot(r.x[i]! - p.x, r.y[i]! - p.y, r.z[i]! - p.z) > 18) continue;
          if (partMeetsBody(part, r.x[i]!, r.y[i]!, r.z[i]!, reg.bodyHeight[kind]!, reg.bodyRadius[kind]!, reg.vehicle[kind], r.yaw[i]!)) problem = RESULT_OBSTRUCTED;
        }
        if (problem) break;
      }
    } else if (!problem) {
      const family = familyOf(def)!;
      const meetsCapsule = (x: number, y: number, z: number, r: number, h: number) => family.meetsCapsule(def, frame, x, y, z, r, h);
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
        if (other ? family.meetsVehicle(def, frame, other, otherFrame) : reg.move[kind] && meetsCapsule(r.x[i]!, r.y[i]!, r.z[i]!, reg.bodyRadius[kind]!, reg.bodyHeight[kind]!)) problem = RESULT_OBSTRUCTED;
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
    const rode = this.riding;
    this.riding = false;
    if (code === RESULT_OK) { this.cancel(); return; }
    // No room to ride from here: the preview shows where it may go.
    if (rode) return;
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
