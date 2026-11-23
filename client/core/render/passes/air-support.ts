import { TICK_RATE } from "../../../../shared/coords.ts";
import { AIR_BAYS, type AirCarrier, type AirDrone, type AirPod, type AirPose, type AirSupportView } from "../../../../shared/sim/air-support.ts";
import type { VehicleRotor } from "../../../../shared/sim/vehicle.ts";
import { AIR_FRAME as A, AIR_PIECES, airBayZ, airMesh, type AirPiece } from "../../../../shared/world/air-support-art.ts";
import type { Details } from "../../details/details.ts";
import type { Assets } from "../../assets/assets.ts";
import { BONE_FLOATS, DRAW_EMISSIVE, DRAW_PLAIN, DRAW_SKINNED, MAX_BONES, MAX_DRAWS, TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";
import type { RotorBlur } from "../rotor-blur.ts";

const ROTOR: VehicleRotor = { bone: "rotor", ratio: 1, at: [0, 0, 0], axis: [0, 1, 0], radius: A.rotorRadius, blur: { blades: 3, chord: 0.23 } };
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
): void {
  const floor = trailer ? A.deck : 0;
  if (trailer) {
    piece("chassis", 0, 0, 0);
    if (!hitched) piece("feet", 0, 0, 2.3);
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

export function drawAirCarrier(piece: Piece, row: AirCarrier, jaws: number, spin: number): void {
  const floor = row.trailer ? A.deck : 0;
  if (row.loaded) drawAirPod(piece, row.trailer, false, 0, 0, -1, 0);
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
  private readonly wheels = new Map<number, { x: number; z: number; angle: number }>();
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
      for (const id of this.wheels.keys()) if (!this.pods.has(id)) this.wheels.delete(id);
    }
    this.share = Math.min(1, Math.max(0, (f.now - this.began) / this.duration));
    for (const row of view.carriers) {
      const prev = this.carriers.get(row.id);
      this.id = row.id;
      if (!this.origin(row, prev, 12)) continue;
      this.scale = ease(Math.min(1, Math.max(0, (540 - Math.hypot(this.x, this.y, this.z)) / 70)));
      if (this.scale < 0.002) continue;
      this.downwash(row);
      drawAirCarrier(this.piece, row, lerp(prev?.jaws ?? row.jaws, row.jaws, this.share), this.tick * 0.73 + row.id);
    }
    for (const row of view.pods) {
      const prev = this.pods.get(row.id);
      if (!this.origin(row, prev, 8)) continue;
      let wheel = 0;
      if (row.trailer) {
        const wx = this.x + f.cam.x,
          wz = this.z + f.cam.z;
        let was = this.wheels.get(row.id);
        if (!was) this.wheels.set(row.id, (was = { x: wx, z: wz, angle: 0 }));
        wheel = was.angle + ((wx - was.x) * this.s + (wz - was.z) * this.c) / A.wheel;
        was.x = wx;
        was.z = wz;
        was.angle = wheel % (Math.PI * 2);
      }
      drawAirPod(this.piece, row.trailer, row.hitched, lerp(prev?.open ?? row.open, row.open, this.share), row.slots, row.selected, wheel);
    }
    for (const row of view.drones) {
      if (row.id === view.flight) continue;
      const prev = this.drones.get(row.id);
      if (this.origin(row, prev, 1)) this.piece("drone", 0, 0, 0, 0, lerp(prev?.pitch ?? row.pitch, row.pitch, this.share));
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
      above = y + A.carrierY - ground;
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

  private readonly piece: Piece = (name, x, y, z, yaw = 0, pitch = 0, roll = 0, dye = 0, rotor = -1) => {
    const f = this.f,
      p = f.packet,
      mesh = this.meshes[name];
    if (mesh < 0) return;
    const cx = this.x + this.scale * (this.c * x + this.s * z),
      cy = this.y + this.scale * y,
      cz = this.z + this.scale * (this.c * z - this.s * x);
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
    airBasis(p.bones, b, this.yaw + yaw, pitch, roll);
    if (this.scale !== 1) for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) p.bones[b + row * 4 + col]! *= this.scale;
    p.bones[b + 3] = cx;
    p.bones[b + 7] = cy;
    p.bones[b + 11] = cz;
    if (rotor >= 0 && f.tier.lit && this.blur.add(p, bone, -1 - this.id * 2 - rotor, ROTOR, 390, IDENTITY, cx, cy, cz, this.scale)) return;
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
