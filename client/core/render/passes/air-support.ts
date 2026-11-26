import { TICK_RATE } from "../../../../shared/coords.ts";
import { handleIndex, makeHandle } from "../../../../shared/ids.ts";
import { AIR_BAYS, type AirCarrier, type AirDrone, type AirPod, type AirPose, type AirSupportView } from "../../../../shared/sim/air-support.ts";
import type { VehicleRotor } from "../../../../shared/sim/vehicle.ts";
import { AIR_FRAME as A, AIR_IMPELLERS, AIR_PIECES, airBayZ, airMesh, type AirPiece } from "../../../../shared/world/air-support-art.ts";
import { AIR_CARRIER_LOAD } from "../../../../content/vehicles/air-freight-art.ts";
import { vehicleRotation } from "../../../../shared/sim/vehicle-frame.ts";
import type { Details } from "../../details/details.ts";
import type { Assets } from "../../assets/assets.ts";
import { BONE_FLOATS, DRAW_EMISSIVE, DRAW_PLAIN, DRAW_SKINNED, MAX_BONES, MAX_DRAWS, TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";
import type { RotorBlur } from "../rotor-blur.ts";

const ROTOR: VehicleRotor = { bone: "rotor", ratio: 1, at: [0, 0, 0], axis: [0, 1, 0], radius: A.rotorRadius, blur: { blades: 3, chord: 0.23 } };
const CARRIER_RPM = 210;
const ROTOR_TURN_PER_TICK = CARRIER_RPM * Math.PI * 2 / (60 * TICK_RATE);
const IDENTITY = new Float64Array([0, 0, 0, 1]);
const SIDES = [-1, 1] as const;
const JAWS = [-A.jawZ, A.jawZ] as const;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const angle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

type Piece = (
  name: AirPiece,
  x: number,
  y: number,
  z: number,
  yaw?: number,
  pitch?: number,
  roll?: number,
  dye?: number,
  rotor?: number,
  localSpin?: number,
) => void;

/** A positive roll lifts the right edge of the pod; positive pitch raises a drone's nose. */
export function airBasis(out: Float32Array, i: number, yaw: number, pitch: number, roll: number): void {
  const h = Math.cos(yaw),
    k = Math.sin(yaw),
    p = Math.cos(pitch),
    q = Math.sin(pitch),
    c = Math.cos(roll),
    s = Math.sin(roll);
  out[i] = h * c - k * q * s;
  out[i + 1] = -h * s - k * q * c;
  out[i + 2] = k * p;
  out[i + 4] = p * s;
  out[i + 5] = p * c;
  out[i + 6] = q;
  out[i + 8] = -k * c - h * q * s;
  out[i + 9] = k * s - h * q * c;
  out[i + 10] = h * p;
}

export function drawAirPod(
  piece: Piece,
  trailer: boolean,
  hitched: boolean,
  open: number,
  slots: number,
  selected: number,
  wheels: number,
  legLift = hitched ? 0.42 : 0,
): void {
  const floor = trailer ? A.deck : 0;
  if (trailer) {
    piece("chassis", 0, 0, 0);
    piece("feet", 0, legLift, 2.3);
    for (const z of A.axle) for (const s of SIDES) piece("wheel", s * 1.07, A.wheel, z, s > 0 ? 0 : Math.PI, wheels * s);
  }
  piece("pod", 0, floor, 0);
  const roof = ease(Math.min(1, open / 0.84)),
    side = ease(Math.max(0, (open - 0.13) / 0.87));
  piece("roof", A.roofX, floor + A.roofY, 0, 0, 0, A.roofAngle * roof);
  piece("side", A.sideX, floor + A.sideY, 0, 0, 0, A.sideAngle * side);
  if (open <= 0.02) return;
  for (let i = 0; i < AIR_BAYS; i++) {
    const full = (slots & (1 << i)) !== 0;
    if (full) piece("drone", 0, floor + A.bayY, airBayZ(i), Math.PI / 2);
    piece("indicator", 0.909, floor + 0.54, airBayZ(i) - 0.14, 0, 0, 0, full ? (i === selected ? 6 : 9) : 4);
  }
}

/** The carrier about its own origin: the load hangs `drop` metres below it, the airframe above the jaws. */
export function drawAirCarrier(piece: Piece, row: AirCarrier, jaws: number, spin: number, drop = AIR_CARRIER_LOAD): void {
  const floor = A.deck - drop;
  if (row.loaded) drawAirPod((name, x, y, z, ...rest) => piece(name, x, y - drop, z, ...rest), true, false, 0, 0, -1, 0);
  const body = floor + A.carrierY;
  piece("carrier", 0, body, 0);
  for (const s of SIDES) {
    piece("rotor", 0, body + 1.4 + (s < 0 ? 0.4 : 0), s * A.rotorZ, s * spin, 0, 0, 0, s < 0 ? 0 : 1);
    for (const z of JAWS) piece("clamp", s * 1.27, body - 0.13, z, s < 0 ? Math.PI : 0, 0, jaws * 0.5);
  }
}

interface Tracked {
  id: number;
}
function remember<T extends Tracked>(map: Map<number, T>, rows: T[] | undefined): void {
  map.clear();
  if (rows) for (const r of rows) map.set(r.id, r);
}

/** Packet transforms are sampled between the last two complete server views. */
export class AirSupport implements Pass {
  view: AirSupportView | null = null;
  tick = 0;
  preview: AirPose | null = null;
  private received: AirSupportView | null = null;
  private readonly carriers = new Map<number, AirCarrier>();
  private readonly pods = new Map<number, AirPod>();
  private readonly drones = new Map<number, AirDrone>();
  private readonly gear = new Map<number, { x: number; z: number; angle: number; lift: number; at: number }>();
  private began = 0;
  private duration = 1;
  private share = 1;
  private f!: Frame;
  private x = 0;
  private y = 0;
  private z = 0;
  private yaw = 0;
  private id = 0;
  private scale = 1;
  private c = 1;
  private s = 0;
  private readonly meshes: Record<AirPiece, number>;
  /** The origin's full turn, row-major, while `tilted`; otherwise pieces turn by `yaw` alone. */
  private readonly basis = new Float64Array(9);
  private readonly local = new Float32Array(12);
  private readonly q = new Float64Array(4);
  private tilted = false;

  private readonly blur: RotorBlur;
  private readonly details: Details;
  private readonly wash = new Map<number, number>();

  constructor(assets: Assets, blur: RotorBlur, details: Details) {
    this.details = details;
    this.blur = blur;
    this.meshes = Object.fromEntries(AIR_PIECES.map((k) => [k, assets.table.find(airMesh(k))])) as Record<AirPiece, number>;
  }

  draw(f: Frame): void {
    this.f = f;
    const view = this.view;
    if (this.preview) {
      this.origin(this.preview);
      this.piece("marker", 0, 0, 0);
    }
    if (!view) return;
    if (this.received !== view) {
      const prior = this.received;
      remember(this.carriers, prior?.carriers);
      remember(this.pods, prior?.pods);
      remember(this.drones, prior?.drones);
      this.duration = Math.max(1, Math.min(260, ((view.tick - (prior?.tick ?? view.tick)) * 1000) / TICK_RATE));
      this.received = view;
      this.began = f.now;
      for (const id of this.wash.keys()) if (!this.carriers.has(id)) this.wash.delete(id);
      for (const id of this.gear.keys()) if (!this.pods.has(id)) this.gear.delete(id);
    }
    this.share = Math.min(1, Math.max(0, (f.now - this.began) / this.duration));
    for (const row of view.carriers) {
      const prev = this.carriers.get(row.id);
      this.id = row.id;
      // Near, the aircraft and its load are entities the bodies pass draws from their art: here only their wash.
      if (this.entityOrigin(row.ent)) { this.downwash(row); this.flat(); continue; }
      // Far, beyond the entities sent, the feed's own pose and attitude draw a stand-in.
      if (!this.origin(row, prev, 16)) continue;
      this.attitude(lerp(prev?.pitch ?? row.pitch, row.pitch, this.share), lerp(prev?.roll ?? row.roll, row.roll, this.share));
      this.downwash(row);
      drawAirCarrier(this.piece, row, lerp(prev?.jaws ?? row.jaws, row.jaws, this.share), this.tick * ROTOR_TURN_PER_TICK + row.id);
      this.flat();
    }
    for (const row of view.pods) {
      const prev = this.pods.get(row.id);
      // A trailer in view is drawn from its art by the bodies pass; this is the stand-in beyond it.
      if (this.entityOrigin(row.ent)) { this.flat(); continue; }
      if (!this.origin(row, prev, 8)) continue;
      let wheel = 0, lift = 0;
      {
        const wx = this.x + f.cam.x,
          wz = this.z + f.cam.z;
        let was = this.gear.get(row.id);
        const targetLift = row.hitched ? 0.42 : 0;
        if (!was) {
          was = { x: wx, z: wz, angle: 0, lift: this.carriers.get(row.id)?.loaded ? 0 : targetLift, at: f.now };
          this.gear.set(row.id, was);
        }
        const travel = Math.max(0, f.now - was.at) * 0.00033;
        lift = was.lift + Math.max(-travel, Math.min(travel, targetLift - was.lift));
        was.lift = lift;
        was.at = f.now;
        wheel = was.angle + ((wx - was.x) * this.s + (wz - was.z) * this.c) / A.wheel;
        was.x = wx;
        was.z = wz;
        was.angle = wheel % (Math.PI * 2);
      }
      drawAirPod(this.piece, true, row.hitched, lerp(prev?.open ?? row.open, row.open, this.share), row.slots, row.selected, wheel, lift);
      this.flat();
    }
    for (const row of view.drones) {
      if (row.id === view.flight) continue;
      if (this.entityOrigin(row.ent)) { this.flat(); continue; }
      const prev = this.drones.get(row.id);
      if (!this.origin(row, prev, 1)) continue;
      const pitch = lerp(prev?.pitch ?? row.pitch, row.pitch, this.share);
      const close = Math.hypot(this.x, this.y, this.z) < 32;
      if (close && (f.tier.name === "high" || f.tier.name === "ultra")) this.drawFlyingDrone(row.id, pitch);
      else this.piece("drone", 0, 0, 0, 0, pitch);
    }
  }

  private drawFlyingDrone(id: number, pitch: number): void {
    this.piece("droneFrame", 0, 0, 0, 0, pitch);
    const c = Math.cos(pitch), s = Math.sin(pitch);
    for (const hub of AIR_IMPELLERS) {
      const spin = hub.turn * (this.tick * 1.31 + id);
      this.piece("impeller", hub.x, c * hub.y + s * hub.z, c * hub.z - s * hub.y, 0, pitch, 0, 0, -1, spin);
    }
  }

  private downwash(row: AirCarrier): void {
    if (Math.hypot(this.x, this.y, this.z) > 85 || this.tick - (this.wash.get(row.id) ?? -Infinity) < 13) return;
    const cam = this.f.cam,
      hf = this.f.world.hf;
    const x = cam.x + this.x,
      y = cam.y + this.y,
      z = cam.z + this.z;
    const ground = hf.heightAt(x, z),
      above = y - AIR_CARRIER_LOAD - ground;
    if (above > 11 || above < 0 || hf.waterAt(x, z) > ground + 0.02) return;
    this.wash.set(row.id, this.tick);
    for (const s of SIDES) {
      const wx = x + this.s * s * A.rotorZ,
        wz = z + this.c * s * A.rotorZ;
      this.details.groundDust(row.id * 2 + (s > 0 ? 1 : 0), wx, hf.heightAt(wx, wz), wz, this.tick, 1.15 + (11 - above) * 0.08, 2, 4);
    }
  }

  private origin(row: AirPose, prev?: AirPose, radius = 0): boolean {
    this.scale = 1;
    const cam = this.f.cam,
      t = this.share;
    this.x = lerp(prev?.x ?? row.x, row.x, t) - cam.x;
    this.y = lerp(prev?.y ?? row.y, row.y, t) - cam.y;
    this.z = lerp(prev?.z ?? row.z, row.z, t) - cam.z;
    this.yaw = angle(prev?.yaw ?? row.yaw, row.yaw, t);
    this.c = Math.cos(this.yaw);
    this.s = Math.sin(this.yaw);
    return !radius || Math.hypot(this.x, this.y, this.z) - radius <= this.f.view;
  }

  /** Places what follows at a remote entity as it is drawn, tilted as it is tilted. False if it is not in view. */
  private entityOrigin(handle: number): boolean {
    const r = this.f.remote;
    if (!r || !handle) return false;
    for (let i = 0; i < r.count; i++) {
      if (makeHandle(r.id[i]!, r.gen[i]!) !== handle) continue;
      const cam = this.f.cam;
      this.scale = 1;
      this.x = r.x[i]! - cam.x; this.y = r.y[i]! - cam.y; this.z = r.z[i]! - cam.z;
      this.rotate(r.vehicleQx[i]!, r.vehicleQy[i]!, r.vehicleQz[i]!, r.vehicleQw[i]!);
      this.yaw = Math.atan2(this.basis[2]!, this.basis[8]!); this.c = Math.cos(this.yaw); this.s = Math.sin(this.yaw);
      return Math.hypot(this.x, this.y, this.z) - 8 <= this.f.view;
    }
    return false;
  }

  /** Tilts the origin set by `origin` by a pitch and a roll, as a vehicle's frame is turned (yaw, then roll, then pitch). */
  private attitude(pitch: number, roll: number): void {
    vehicleRotation({ x: 0, y: 0, z: 0, yaw: this.yaw, pitch, roll }, this.q);
    this.rotate(this.q[0]!, this.q[1]!, this.q[2]!, this.q[3]!);
  }

  private rotate(x: number, y: number, z: number, w: number): void {
    const m = this.basis;
    m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - w * z); m[2] = 2 * (x * z + w * y);
    m[3] = 2 * (x * y + w * z); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - w * x);
    m[6] = 2 * (x * z - w * y); m[7] = 2 * (y * z + w * x); m[8] = 1 - 2 * (x * x + y * y);
    this.tilted = true;
  }

  /** The `hides` bones of trailer entity `id` to hide: the bays whose drones have launched. */
  hidden(id: number): number {
    for (const row of this.view?.pods ?? []) if (handleIndex(row.ent) === id) return ~row.slots & 63;
    return 0;
  }

  /** Back to turning by yaw alone. */
  private flat(): void { this.tilted = false; }

  private readonly piece: Piece = (name, x, y, z, yaw = 0, pitch = 0, roll = 0, dye = 0, rotor = -1, localSpin = 0) => {
    const f = this.f,
      p = f.packet,
      mesh = this.meshes[name];
    if (mesh < 0) return;
    const m = this.basis, tilt = this.tilted;
    const cx = this.x + this.scale * (tilt ? m[0]! * x + m[1]! * y + m[2]! * z : this.c * x + this.s * z),
      cy = this.y + this.scale * (tilt ? m[3]! * x + m[4]! * y + m[5]! * z : y),
      cz = this.z + this.scale * (tilt ? m[6]! * x + m[7]! * y + m[8]! * z : this.c * z - this.s * x);
    const r = Math.max(0.15, f.assets.table.radius[mesh]!);
    const far = Math.max(0.01, Math.hypot(cx, cy, cz) - r);
    if (far > f.view || (name === "indicator" && far > 110)) return;
    const x0 = cx - r,
      y0 = cy - r,
      z0 = cz - r,
      x1 = cx + r,
      y1 = cy + r,
      z1 = cz + r;
    const seen = f.cam.boxVisible(x0, y0, z0, x1, y1, z1);
    const casts =
      f.casting.on && name !== "marker" && name !== "indicator" && rotor < 0
        ? f.casting.castBox(x0, y0, z0, x1, y1, z1) & f.casting.cascades.fits(r)
        : 0;
    if (!seen && !casts) return;
    if (
      p.boneCount >= Math.min(f.tier.bones, MAX_BONES) ||
      p.transientCount >= p.transientIds.length ||
      p.drawCount + f.put.doubled >= Math.min(f.tier.budget.draws, MAX_DRAWS)
    )
      return;
    const level = f.assets.choose(f.assets.table.error[mesh]!, far, -1);
    f.assets.wantTextured(mesh, level, far);
    const bone = p.boneCount++,
      b = bone * BONE_FLOATS;
    const out = tilt ? this.local : p.bones, at = tilt ? 0 : b;
    airBasis(out, at, tilt ? yaw : this.yaw + yaw, pitch, roll);
    if (localSpin !== 0) {
      const c = Math.cos(localSpin), s = Math.sin(localSpin);
      for (let j = at; j < at + 12; j += 4) {
        const x = out[j]!, z = out[j + 2]!;
        out[j] = c * x - s * z;
        out[j + 2] = s * x + c * z;
      }
    }
    if (tilt) {
      const l = this.local;
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
        p.bones[b + row * 4 + col] = m[row * 3]! * l[col]! + m[row * 3 + 1]! * l[4 + col]! + m[row * 3 + 2]! * l[8 + col]!;
      }
    }
    if (this.scale !== 1) for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) p.bones[b + row * 4 + col]! *= this.scale;
    p.bones[b + 3] = cx;
    p.bones[b + 7] = cy;
    p.bones[b + 11] = cz;
    if (rotor >= 0 && f.tier.lit && this.blur.add(p, bone, -1 - this.id * 2 - rotor, ROTOR, CARRIER_RPM, IDENTITY, cx, cy, cz, this.scale)) return;
    const first = p.transientCount++;
    f.transient.setSkinned(first, bone, dye);
    p.transientIds[first] = 0;
    const flags = DRAW_SKINNED | DRAW_PLAIN | (name === "marker" || (name === "indicator" && dye !== 4) ? DRAW_EMISSIVE : 0);
    if (seen) {
      const start = p.drawCount;
      f.put.draw(mesh, level, TRANSIENT_BUFFER, first, 1, 0, 0, 0, flags, f.cam.passes(x0, y0, z0, x1, y1, z1));
      f.put.boxRows(start, p.drawCount, x0, y0, z0, x1, y1, z1);
    }
    if (casts) f.casting.castBody(mesh, level, first, 1, flags, casts, 0);
  };
}
