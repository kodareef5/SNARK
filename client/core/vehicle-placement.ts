// The assembled vehicle is always created by the server. This preview uses the same physical envelope and landing test.
import type { Registry } from "../../shared/content/registry.ts";
import { handleIndex } from "../../shared/ids.ts";
import { CMD_VEHICLE, RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, VEHICLE_DEPLOY } from "../../shared/net/protocol.ts";
import { stanceHeight } from "../../shared/sim/character.ts";
import { FLAG_BLUEPRINT } from "../../shared/sim/items.ts";
import { isRotorVehicle } from "../../shared/sim/vehicle.ts";
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
    this.active = !!def && item !== this.suppressed;
    if (!this.active || !def) { this.notice = ""; if (!item) this.selected = -1; return; }
    const hit = castWorld(world, ox, oy, oz, dx, dy, dz, REACH);
    const distance = hit === HIT_NONE ? 8 : rayHit.t;
    const p = this.pose;
    p.x = ox + dx * distance; p.y = oy + dy * distance; p.z = oz + dz * distance;
    p.yaw = (Math.round(yaw * 65536 / (2 * Math.PI)) + this.turn * 4096) & 65535;
    const angle = p.yaw * 2 * Math.PI / 65536, frame = { ...p, yaw: angle, pitch: 0, roll: 0 };
    let problem = session.driving >= 0 || session.own.seat > 0 ? RESULT_DENIED : hit === HIT_NONE || rayHit.ny < .94 ? RESULT_NO_SUPPORT : 0;
    if (!problem && (!isRotorVehicle(def) || !helicopterPlacement(world, p.x, p.y, p.z, angle, def))) problem = RESULT_NO_SUPPORT;
    if (!problem && isRotorVehicle(def)) {
      const me = reg.move[session.ownKind];
      if (me && helicopterMeetsCapsule(def, frame, session.own.x, session.own.y, session.own.z, me.radius, stanceHeight(me, session.own.stance))) problem = RESULT_OBSTRUCTED;
      session.sampleRemote(this.remote);
      for (let i = 0; !problem && i < this.remote.count; i++) {
        const r = this.remote, kind = r.kind[i]!;
        if (r.id[i] === handleIndex(session.ownHandle) || Math.hypot(r.x[i]! - p.x, r.y[i]! - p.y, r.z[i]! - p.z) > 18) continue;
        const other = reg.vehicle[kind];
        if (other ? helicopterMeetsVehicle(def, frame, other, {
          x: r.x[i]!, y: r.y[i]!, z: r.z[i]!, yaw: r.yaw[i]!, pitch: r.vehiclePitch[i]!, roll: r.vehicleRoll[i]!,
          ...(isRotorVehicle(other) ? { qx: r.vehicleQx[i]!, qy: r.vehicleQy[i]!, qz: r.vehicleQz[i]!, qw: r.vehicleQw[i]! } : {}),
        }) : reg.move[kind] && helicopterMeetsCapsule(def, frame, r.x[i]!, r.y[i]!, r.z[i]!, reg.bodyRadius[kind]!, reg.bodyHeight[kind]!)) problem = RESULT_OBSTRUCTED;
      }
    }
    this.problem = this.asked ? RESULT_BUSY : problem;
    this.notice = nowMs < this.refusalUntil ? this.refusal : VEHICLE_PLACEMENT_REASONS[this.problem] ?? "Assemble • click   Rotate • Q / E   Cancel • Esc";
  }

  key(code: string, down: boolean, repeat: boolean): boolean {
    if (!this.active || !["KeyQ", "KeyE", "Escape"].includes(code)) return false;
    if (down && !repeat) { if (code === "Escape") this.cancel(); else this.turn = (this.turn + (code === "KeyQ" ? 15 : 1)) % 16; }
    return true;
  }
  place(session: ClientSession): number {
    if (!this.active || this.problem !== RESULT_OK || this.asked) return 0;
    const p = this.pose;
    this.asked = session.command(CMD_VEHICLE, w => { w.u8(VEHICLE_DEPLOY); w.u8(this.slot); w.f32(p.x); w.f32(p.y); w.f32(p.z); w.u16(p.yaw); });
    return this.asked;
  }
  result(seq: number, code: number, nowMs: number): void {
    if (seq === 0 || seq !== this.asked) return;
    this.asked = 0;
    if (code === RESULT_OK) { this.cancel(); return; }
    this.refusal = VEHICLE_PLACEMENT_REASONS[code] ?? "The aircraft cannot be assembled here";
    this.refusalUntil = nowMs + 2500;
  }
}
