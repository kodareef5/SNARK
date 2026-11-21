// Local, cosmetic disturbances. Segment endpoints are left in world space: an old wake follows the path the hull took.
import type { Registry } from "../../../shared/content/registry.ts";
import { AnimState, CUE_DEAD, SPEED_MAX } from "../../../shared/anim/pose.ts";
import { MODE_FLYER, MODE_SWIM } from "../../../shared/sim/character.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { RemoteSample } from "../session.ts";
import type { OwnBody } from "./scene.ts";
import { MAX_WATER_MARKS, WATER_DURATIONS, WATER_BOUNDS, WATER_MARK_COUNT, WATER_MARKS } from "./packet.ts";

const REACH = 64,
  LIFE = 3.6,
  SAMPLE = 0.125;
type Position = { x: number; y: number; z: number };
interface Track extends Position {
  id: number;
  gen: number;
  kind: number;
  t: number;
  surface: number;
  wet: boolean;
  fromX: number;
  fromZ: number;
  emitted: number;
}
interface Mark extends Position {
  dx: number;
  dz: number;
  t: number;
  width: number;
  strength: number;
  duration: number;
}
const limit = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export class WaterTrails {
  private readonly tracks: Track[] = [];
  private readonly marks: Mark[] = Array.from({ length: MAX_WATER_MARKS }, () => ({
    x: 0,
    y: 0,
    z: 0,
    dx: 0,
    dz: 0,
    t: 0,
    width: 0,
    strength: 0,
    duration: 0,
  }));
  private nextMark = 0;
  private markCount = 0;
  private readonly sources = new Int32Array(4);
  private readonly distance = new Float64Array(4);
  private readonly motion = new AnimState();
  private readonly survivor: number;
  private sampled = -Infinity;
  private last = -Infinity;

  private readonly reg: Registry;
  constructor(reg: Registry) {
    this.reg = reg;
    this.survivor = reg.index.get("core:survivor") ?? -1;
  }

  frame(
    f: Float32Array,
    hf: Heightfield,
    eye: Position,
    own: OwnBody | null,
    r: RemoteSample | null,
    time: number,
    capacity: number,
  ): void {
    f[WATER_MARK_COUNT] = 0;
    if (!capacity || time < this.last || time - this.last > 0.55) {
      this.tracks.length = this.markCount = this.nextMark = 0;
      this.sampled = -Infinity;
    }
    this.last = time;
    if (!capacity) return;
    if (time - this.sampled >= SAMPLE - 1e-6) {
      this.sampled = time;
      this.distance.fill(Infinity);
      this.sources.fill(-2);
      const consider = (i: number, kind: number, speed: number, x: number, y: number, z: number) => {
        const ds = (x - eye.x) ** 2 + (y - eye.y) ** 2 + (z - eye.z) ** 2;
        if (ds > REACH * REACH) return;
        // A spectator on a roof or a crowd on the beach must not evict a moving hull in the bay.
        const level = hf.waterAt(x, z);
        if (!Number.isFinite(level) || y > level + 5 || y < level - 4 || hf.heightAt(x, z) > level - 0.07) return;
        // A resting swimmer or a body high over water can still register its next entry when a slot is free.
        const close = y <= level + 1.65;
        const active = close && (this.reg.vehicle[kind]?.movement === "boat" || speed > 0 || y > level + 0.04);
        const score = (i < 0 ? -1 : ds) + (active ? 0 : REACH * REACH + 1);
        let k = 0;
        while (k < this.distance.length && this.distance[k]! <= score) k++;
        if (k === this.distance.length) return;
        this.sources.copyWithin(k + 1, k);
        this.distance.copyWithin(k + 1, k);
        this.sources[k] = i;
        this.distance[k] = score;
      };
      if (
        own &&
        !own.attachment &&
        !own.state.dead &&
        (own.kind === this.survivor || this.reg.vehicle[own.kind]?.movement === "boat" || own.state.mode === MODE_FLYER)
      )
        consider(-1, own.kind, own.state.speed, own.x, own.y, own.z);
      if (r)
        for (let i = 0; i < r.count; i++) {
          if (r.id[i] === own?.id || r.seat[i] || r.cue[i]! & CUE_DEAD) continue;
          const kind = r.kind[i]!;
          if (kind !== this.survivor && this.reg.vehicle[kind]?.movement !== "boat") {
            if (!this.reg.flies[kind]) continue;
            this.motion.unpack(r.anim[i]!, r.cue[i]!);
            if (this.motion.mode !== MODE_FLYER) continue;
          }
          consider(i, kind, r.anim[i]! & SPEED_MAX, r.x[i]!, r.y[i]!, r.z[i]!);
        }
      const sourceLimit = Math.min(this.sources.length, Math.max(1, Math.floor(capacity / 3)));
      for (let slot = 0; slot < sourceLimit; slot++) {
        const i = this.sources[slot]!;
        if (i === -2) break;
        if (i === -1 && own) {
          const v = own.vehicle;
          const up =
            v?.qw !== undefined
              ? 1 - 2 * ((v.qx ?? 0) ** 2 + (v.qz ?? 0) ** 2)
              : Math.cos(v?.pitch ?? 0) * Math.cos(v?.roll ?? 0);
          this.observe(hf, own.id, own.generation ?? 0, own.kind, own.x, own.y, own.z, own.state, up, time);
        } else if (r) {
          this.motion.unpack(r.anim[i]!, r.cue[i]!);
          const up =
            r.vehicleQw[i] || r.vehicleQx[i] || r.vehicleQz[i]
              ? 1 - 2 * (r.vehicleQx[i]! ** 2 + r.vehicleQz[i]! ** 2)
              : Math.cos(r.vehiclePitch[i]!) * Math.cos(r.vehicleRoll[i]!);
          this.observe(hf, r.id[i]!, r.gen[i]!, r.kind[i]!, r.x[i]!, r.y[i]!, r.z[i]!, this.motion, up, time);
        }
      }
      for (let i = this.tracks.length - 1; i >= 0; i--) if (this.tracks[i]!.t !== time) this.tracks.splice(i, 1);
    }

    let count = 0,
      x0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      z1 = -Infinity;
    for (let i = 0; i < this.markCount && count < capacity; i++) {
      const m = this.marks[(this.nextMark + MAX_WATER_MARKS - 1 - i) % MAX_WATER_MARKS]!,
        age = time - m.t;
      if (age >= LIFE) break;
      const x = m.x - eye.x,
        z = m.z - eye.z,
        ds = x * x + z * z;
      if (ds >= REACH * REACH) continue;
      const fade = limit((REACH - Math.sqrt(ds)) / 12, 0, 1) * (1 - age / LIFE) ** 1.5;
      f[WATER_DURATIONS + count] = m.duration;
      const a = WATER_MARKS + 8 * count++;
      f[a] = x;
      f[a + 1] = z;
      f[a + 2] = m.dx;
      f[a + 3] = m.dz;
      f[a + 4] = m.y - eye.y;
      f[a + 5] = age;
      f[a + 6] = m.width;
      f[a + 7] = m.strength * fade;
      const edge = m.width + 2 + 2.2 * age;
      x0 = Math.min(x0, x - Math.abs(m.dx) - edge);
      x1 = Math.max(x1, x + Math.abs(m.dx) + edge);
      z0 = Math.min(z0, z - Math.abs(m.dz) - edge);
      z1 = Math.max(z1, z + Math.abs(m.dz) + edge);
    }
    f[WATER_MARK_COUNT] = count;
    if (count) {
      f[WATER_BOUNDS] = x0;
      f[WATER_BOUNDS + 1] = z0;
      f[WATER_BOUNDS + 2] = x1;
      f[WATER_BOUNDS + 3] = z1;
    }
  }

  private observe(
    hf: Heightfield,
    id: number,
    gen: number,
    kind: number,
    x: number,
    y: number,
    z: number,
    state: AnimState,
    up: number,
    t: number,
  ): void {
    const surface = hf.waterAt(x, z),
      bed = hf.heightAt(x, z),
      depth = surface - bed,
      height = y - surface;
    const vehicle = this.reg.vehicle[kind],
      hull = vehicle?.movement === "boat" ? vehicle.spec : null;
    const swimmer = kind === this.survivor,
      flight = state.jet || state.mode === MODE_FLYER;
    const wet =
      Number.isFinite(surface) &&
      depth > 0.07 &&
      (hull
        ? up > 0.5 && height < 0.08 && height > -hull.draft - 0.6
        : swimmer && height <= 0.04 && height > -this.reg.bodyHeight[kind]! - 0.15);
    let s = this.tracks.find((p) => p.id === id && p.gen === gen && p.kind === kind);
    if (!s) {
      this.tracks.push({ id, gen, kind, x, y, z, t, surface, wet, fromX: x, fromZ: z, emitted: t });
      return;
    }
    const dt = t - s.t,
      step = Math.hypot(x - s.x, z - s.z),
      speed = step / Math.max(0.001, dt),
      vy = (y - s.y) / Math.max(0.001, dt);
    const skim = flight && !wet && depth > 0.1 && height >= 0 && height < 1.65 && speed > 2;
    const continuous = dt > 0 && dt < 0.5 && Math.abs(surface - s.surface) < 0.15 && speed < 60 && Math.abs(vy) < 60;
    if (continuous && swimmer && wet && !s.wet && vy < -0.8) {
      this.mark(x, surface, z, 0, 0, t, 0.18, -limit(-vy * 0.12, 0.18, 1));
      s.emitted = t;
      s.fromX = x;
      s.fromZ = z;
    } else if (continuous && (wet || skim) && speed > (hull ? 0.65 : 0.25)) {
      const distance = Math.hypot(x - s.fromX, z - s.fromZ);
      if (distance >= (hull ? 3.8 : 1.8) || t - s.emitted >= (hull || skim || state.mode === MODE_SWIM ? 0.43 : 0.32)) {
        const dx = (x - s.fromX) * 0.5,
          dz = (z - s.fromZ) * 0.5;
        if (hull || skim || state.mode === MODE_SWIM) {
          const width = hull ? limit(hull.halfWidth * 0.77, 0.45, 2.2) : skim ? 0.32 : 0.22;
          const power = hull
            ? limit(speed * 0.075, 0.12, 1)
            : skim
              ? 0.48 * (1 - height / 1.65) * limit(speed / 7, 0, 1)
              : limit(speed * 0.13, 0.12, 0.38);
          this.mark(x - dx, surface, z - dz, dx, dz, t, width, power, t - s.emitted);
        } else this.mark(x, surface, z, 0, 0, t, 0.13, -limit(speed * 0.1, 0.12, 0.38));
        s.emitted = t;
        s.fromX = x;
        s.fromZ = z;
      }
    } else {
      s.emitted = t;
      s.fromX = x;
      s.fromZ = z;
    }
    s.x = x;
    s.y = y;
    s.z = z;
    s.surface = surface;
    s.t = t;
    s.wet = wet;
  }

  private mark(
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    t: number,
    width: number,
    strength: number,
    duration = 0,
  ): void {
    const m = this.marks[this.nextMark]!;
    m.x = x;
    m.y = y;
    m.z = z;
    m.dx = dx;
    m.dz = dz;
    m.t = t;
    m.width = width;
    m.strength = strength;
    m.duration = duration;
    this.nextMark = (this.nextMark + 1) % MAX_WATER_MARKS;
    this.markCount = Math.min(this.markCount + 1, MAX_WATER_MARKS);
  }
}

/** Two compact crests on each side of a track. A negative strength denotes a circular entry or footfall. */
export const WATER_TRAILS_GLSL = `
float wakeRidge(float u) {
  float bell=max(0.,1.-u*u);
  return u*bell*bell;
}
void waterTrails(vec3 rel, float depth, float footprint, inout vec2 slope, inout float foam, out float churn) {
  churn=0.;
  if (fEffects.w<.5 || any(lessThan(rel.xz,fWaterBounds.xy)) || any(greaterThan(rel.xz,fWaterBounds.zw))) return;
  for (int i=0;i<${MAX_WATER_MARKS};i++) {
    if (i>=int(fEffects.w)) break;
    vec4 path=fWaterMarks[2*i], wave=fWaterMarks[2*i+1];
    vec2 d=rel.xz-path.xy;
    float age=wave.y, width=wave.z;
    float extent=width+2.+2.2*age;
    if (abs(rel.y-wave.x)>.12 || any(greaterThan(abs(d),abs(path.zw)+extent))) continue;
    vec2 dir;
    float dist, mask=1., radius, band;
    if (wave.w<0.) {
      dist=length(d); dir=d/max(.001,dist);
      radius=width+age*1.5; band=.13+.07*age;
    } else {
      float halfLen=max(length(path.zw),.001);
      vec2 along=path.zw/halfLen, side=vec2(-along.y,along.x);
      float axial=dot(d,along), lateral=dot(d,side);
      mask=1.-smoothstep(max(0.,halfLen-.20),halfLen+.33,abs(axial));
      if (mask<=0.) continue;
      dir=sign(lateral)*side; dist=abs(lateral);
      float bornEarlier=.5*(1.-clamp(axial/halfLen,-1.,1.))*fWaterDurations[i/4][i%4];
      radius=width+1.2*(age+bornEarlier);
      band=.19+.16*width+.09*age;
    }
    // The core of a powered hull wake is a rough patch between the two spreading crests.
    // Sample the existing wind-ripple texture once in the caller to break up this patch.
    if (wave.w>0. && width>.4)
      churn=max(churn,wave.w*mask*(1.-smoothstep(.2*radius,max(.35,radius),dist))*smoothstep(.12,.45,depth));
    float u=(dist-radius)/band;
    if (u>1. || u< -3.4) continue;
    float gain=abs(wave.w)*mask*smoothstep(.015,.24,depth)*(1.-smoothstep(.45*band,1.8*band,footprint));
    slope+=dir*gain*(.78*wakeRidge(u)+.26*wakeRidge((u+2.)*.85));
    float broken=.55+.45*sin(6.3*d.x+4.6*d.y+2.*sin(2.1*d.y));
    foam=max(foam,gain*.24*max(0.,1.-u*u)*broken);
  }
}`;
