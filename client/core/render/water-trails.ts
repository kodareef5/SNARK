// Local, cosmetic disturbances. Segment endpoints are left in world space: an old wake follows the path the hull took.
import type { Registry } from "../../../shared/content/registry.ts";
import { AnimState, CUE_DEAD, SPEED_MAX } from "../../../shared/anim/pose.ts";
import { MODE_FLYER, MODE_SWIM } from "../../../shared/sim/character.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { RemoteSample } from "../session.ts";
import type { OwnBody } from "./scene.ts";
import { MAX_WATER_MARKS, WATER_PATHS, WATER_BOUNDS, WATER_MARK_COUNT, WATER_MARKS } from "./packet.ts";

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
  anchorX: number;
  anchorZ: number;
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  index: number;
  stern: number;
  head: Mark;
}
interface Mark extends Position {
  dx: number;
  dz: number;
  t: number;
  width: number;
  strength: number;
  duration: number;
  incoming: number;
  outgoing: number;
  family: number;
}
const limit = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

const SWIM = 1,
  SKIM = 2,
  HULL = 3;
const emptyMark = (): Mark => ({
  x: 0,
  y: 0,
  z: 0,
  dx: 0,
  dz: 0,
  t: 0,
  width: 0,
  strength: 0,
  duration: 0,
  incoming: 0,
  outgoing: 0,
  family: 0,
});

/** Hermite endpoint tangents projected onto this chord. Neighbouring hull sections meet along the same tangent. */
function path(m: Mark, s: Track, x: number, z: number, time: number): void {
  m.dx = (x - s.fromX) * 0.5;
  m.dz = (z - s.fromZ) * 0.5;
  m.x = x - m.dx;
  m.z = z - m.dz;
  m.t = time;
  m.duration = time - s.emitted;
  const d = Math.hypot(m.dx, m.dz);
  if (d < 0.01 || m.family !== HULL) {
    m.incoming = m.outgoing = 0;
    return;
  }
  const ax = m.dx / d,
    az = m.dz / d;
  m.incoming = limit((ax * s.startZ - az * s.startX) / Math.max(0.4, ax * s.startX + az * s.startZ), -1, 1);
  m.outgoing = limit((ax * s.endZ - az * s.endX) / Math.max(0.4, ax * s.endX + az * s.endZ), -1, 1);
}

export class WaterTrails {
  private readonly tracks: Track[] = [];
  private readonly marks = Array.from({ length: MAX_WATER_MARKS }, emptyMark);
  private readonly visible: Mark[] = [];
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
          this.observe(hf, own.id, own.generation ?? 0, own.kind, own.x, own.y, own.z, own.state, up, own.yaw, i, time);
        } else if (r) {
          this.motion.unpack(r.anim[i]!, r.cue[i]!);
          const up =
            r.vehicleQw[i] || r.vehicleQx[i] || r.vehicleQz[i]
              ? 1 - 2 * (r.vehicleQx[i]! ** 2 + r.vehicleQz[i]! ** 2)
              : Math.cos(r.vehiclePitch[i]!) * Math.cos(r.vehicleRoll[i]!);
          this.observe(hf, r.id[i]!, r.gen[i]!, r.kind[i]!, r.x[i]!, r.y[i]!, r.z[i]!, this.motion, up, r.yaw[i]!, i, time);
        }
      }
      for (let i = this.tracks.length - 1; i >= 0; i--) if (this.tracks[i]!.t !== time) this.tracks.splice(i, 1);
    }

    // Extend the newest unsealed section to the rendered body every frame. Historical sections stay in world space.
    const visible = this.visible;
    visible.length = 0;
    for (const s of this.tracks) {
      const m = s.head,
        i = s.index;
      if (!(m.strength > 0)) continue;
      let x: number, y: number, z: number, yaw: number;
      if (i < 0 && own && own.id === s.id && (own.generation ?? 0) === s.gen) {
        ({ x, y, z, yaw } = own);
      } else if (i >= 0 && r && i < r.count && r.id[i] === s.id && r.gen[i] === s.gen) {
        x = r.x[i]!;
        y = r.y[i]!;
        z = r.z[i]!;
        yaw = r.yaw[i]!;
      } else continue;
      if (Math.abs(y - s.y) > 1 || Math.hypot(x - s.x, z - s.z) > 8 || (m.family === SKIM && y >= s.surface + 1.65)) continue;
      if (s.stern) {
        x -= s.stern * Math.sin(yaw);
        z -= s.stern * Math.cos(yaw);
      }
      path(m, s, x, z, time);
      if (m.dx * m.dx + m.dz * m.dz > 0.0004) visible.push(m);
    }
    for (let i = 0; i < this.markCount; i++) {
      const m = this.marks[(this.nextMark + MAX_WATER_MARKS - 1 - i) % MAX_WATER_MARKS]!;
      if (time - m.t >= LIFE) break;
      visible.push(m);
    }

    let count = 0,
      x0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      z1 = -Infinity;
    for (const m of visible) {
      if (count >= capacity) break;
      const age = time - m.t;
      const x = m.x - eye.x,
        z = m.z - eye.z,
        ds = x * x + z * z;
      if (ds >= REACH * REACH) continue;
      const fade = limit((REACH - Math.sqrt(ds)) / 12, 0, 1) * (1 - age / LIFE) ** 1.5;
      const at = WATER_PATHS + count * 4;
      f[at] = m.duration;
      f[at + 1] = m.incoming;
      f[at + 2] = m.outgoing;
      f[at + 3] = m.family;
      const a = WATER_MARKS + 8 * count++;
      f[a] = x;
      f[a + 1] = z;
      f[a + 2] = m.dx;
      f[a + 3] = m.dz;
      f[a + 4] = m.y - eye.y;
      f[a + 5] = age;
      f[a + 6] = m.width;
      f[a + 7] = m.strength * fade;
      const edge = m.width + 2 + 2.2 * (age + m.duration) + 0.5 * Math.hypot(m.dx, m.dz);
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
    yaw: number,
    index: number,
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
    const stern = hull ? hull.halfLength * 0.9 : 0;
    const ax = x - stern * Math.sin(yaw),
      az = z - stern * Math.cos(yaw);
    let s = this.tracks.find((p) => p.id === id && p.gen === gen && p.kind === kind);
    if (!s) {
      this.tracks.push({
        id,
        gen,
        kind,
        x,
        y,
        z,
        t,
        surface,
        wet,
        fromX: ax,
        fromZ: az,
        emitted: t,
        anchorX: ax,
        anchorZ: az,
        startX: 0,
        startZ: 0,
        endX: 0,
        endZ: 0,
        index,
        stern,
        head: emptyMark(),
      });
      return;
    }
    const dt = t - s.t,
      step = Math.hypot(x - s.x, z - s.z),
      speed = step / Math.max(0.001, dt),
      vy = (y - s.y) / Math.max(0.001, dt);
    const skim = flight && !wet && depth > 0.1 && height >= 0 && height < 1.65 && speed > 2;
    const continuous = dt > 0 && dt < 0.5 && Math.abs(surface - s.surface) < 0.15 && speed < 60 && Math.abs(vy) < 60;
    const m = s.head;
    const moving = continuous && (wet || skim) && speed > (hull ? 0.65 : 0.25);
    const family = hull ? HULL : skim ? SKIM : state.mode === MODE_SWIM ? SWIM : 0;
    const entry = continuous && swimmer && wet && !s.wet && vy < -0.8;
    if (moving && family && !entry) {
      const d = Math.hypot(ax - s.anchorX, az - s.anchorZ);
      if (d > 0.01) {
        s.endX = (ax - s.anchorX) / d;
        s.endZ = (az - s.anchorZ) / d;
        if (!m.strength || m.family !== family) {
          s.fromX = s.anchorX;
          s.fromZ = s.anchorZ;
          s.emitted = s.t;
          s.startX = s.endX;
          s.startZ = s.endZ;
        }
      }
      m.family = family;
      m.y = surface;
      m.width = hull ? limit(hull.halfWidth * 0.77, 0.45, 2.2) : skim ? 0.32 : 0.22;
      m.strength = hull
        ? limit(speed * 0.075, 0.12, 1)
        : skim
          ? 0.92 * (1 - height / 1.65) * limit(speed / 6, 0, 1)
          : limit(speed * 0.23, 0.16, 0.68);
      path(m, s, ax, az, t);
      if (Math.hypot(m.dx, m.dz) * 2 > (hull ? 4 : 1.8) || t - s.emitted >= 0.48) {
        this.keep(m);
        s.fromX = ax;
        s.fromZ = az;
        s.emitted = t;
        s.startX = s.endX;
        s.startZ = s.endZ;
      }
    } else {
      if (m.strength > 0 && m.dx * m.dx + m.dz * m.dz > 0.01 && continuous) this.keep(m);
      m.strength = 0;
      if (entry || (moving && !family && t - s.emitted >= 0.32)) {
        Object.assign(m, {
          x,
          y: surface,
          z,
          dx: 0,
          dz: 0,
          t,
          width: entry ? 0.18 : 0.13,
          strength: -limit(entry ? -vy * 0.15 : speed * 0.14, 0.16, entry ? 1 : 0.5),
          duration: 0,
          family: 0,
          incoming: 0,
          outgoing: 0,
        });
        this.keep(m);
        m.strength = 0;
        s.emitted = t;
      } else if (!moving) s.emitted = t;
      s.fromX = ax;
      s.fromZ = az;
    }
    s.index = index;
    s.anchorX = ax;
    s.anchorZ = az;
    s.x = x;
    s.y = y;
    s.z = z;
    s.surface = surface;
    s.t = t;
    s.wet = wet;
  }

  private keep(m: Mark): void {
    Object.assign(this.marks[this.nextMark]!, m);
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
  float a=fEffects.y+dot(rel.xz,vec2(.069,.031)), b=fEffects.z+dot(rel.xz,vec2(-.024,.053));
  float ripple=sin(13.*a-24.*b+1.4*sin(3.*a-5.*b)), broken=.67+.33*sin(17.*a-29.*b);
  for (int i=0;i<${MAX_WATER_MARKS};i++) {
    if (i>=int(fEffects.w)) break;
    vec4 path=fWaterMarks[2*i], wave=fWaterMarks[2*i+1];
    vec2 d=rel.xz-path.xy;
    float age=wave.y, width=wave.z;
    vec4 section=fWaterPaths[i];
    float extent=width+2.+2.2*(age+section.x)+.5*(abs(path.z)+abs(path.w));
    if (abs(rel.y-wave.x)>.12 || any(greaterThan(abs(d),abs(path.zw)+extent))) continue;
    float gain=abs(wave.w)*smoothstep(.015,.24,depth);
    vec2 dir; float dist, radius, band, crest=.78, foamCap=.24;
    if (wave.w<0.) {
      dist=length(d); dir=d/max(.001,dist);
      radius=width+age*1.5; band=.13+.07*age;
    } else {
      float halfLen=length(path.zw);
      if (halfLen<.01) continue;
      vec2 along=path.zw/halfLen, side=vec2(-along.y,along.x);
      float axial=dot(d,along), lateral=dot(d,side);
      float t=clamp(.5+.5*axial/halfLen,0.,1.), v=1.-t;
      age+=section.x*v;
      bool boat=section.w>2.5, jet=section.w>1.5 && !boat;
      // The stern describes its own curve in a turn. Both ends carry the actual direction it travelled.
      float tangent=0., outside=0.;
      if (boat) {
        lateral-=2.*halfLen*t*v*(v*section.y-t*section.z);
        tangent=v*(1.-3.*t)*section.y+t*(3.*t-2.)*section.z;
        outside=clamp(-sign(lateral)*(section.z-section.y)*1.9,-1.,1.);
      }
      vec2 normal=(side-tangent*along)*inversesqrt(1.+tangent*tangent);
      float crossDist=abs(lateral)*dot(normal,side);
      float past=max(abs(axial)-halfLen,0.);
      // Overlap the ends across the width of a crest. A short segment joining at an angle must not leave a square hole.
      radius=boat ? width + age*(1.46+.28*outside) : width + age*(jet?.99:.73);
      if (past>.55+.52*radius || crossDist>radius+1.2) continue;
      float mask=1.-smoothstep(.02,.35+.52*radius,past);
      gain*=mask;
      radius+=(boat?.16:.065)*ripple;
      float fresh=1.-smoothstep(0.,boat?2.:1.05,age);
      dir=sign(lateral)*normal; dist=crossDist;
      band=boat ? .22+.12*width+.10*age : .13+.055*age+.08*fresh;
      if (boat) {
        // Broad broken prop wash, with a taller outside shoulder and a weaker inside shoulder.
        float core=1.-smoothstep(0.,.62*width+.30*age,dist);
        float aerated=1.-smoothstep(.10,1.75,age);
        float veins=sin(7.*lateral/max(.6,width)+2.4*sin(5.6*age)+1.8*age);
        float streaks=smoothstep(.1,.9,abs(veins));
        churn=max(churn,gain*core*(.16+.84*aerated)*(.35+.65*streaks));
        foam=max(foam,gain*core*aerated*(.12+.45*streaks));
        crest=1.17+.39*outside; foamCap=.38+.16*outside;
      } else {
        // The body or boot jets keep feeding fresh water at the tip. Older arms quickly return to the wind ripples.
        churn=max(churn,gain*fresh*(jet?.88:.62)*(1.-smoothstep(.12*radius,1.35*radius,dist)));
        crest=.70+1.1*fresh; foamCap=.17+(jet?.84:.62)*fresh;
      }
    }
    float u=(dist-radius)/band;
    if (u>1. || u< -3.4) continue;
    gain*=1.-smoothstep(.45*band,1.8*band,footprint);
    slope+=dir*gain*crest*(wakeRidge(u)+.32*wakeRidge((u+2.)*.85));
    foam=max(foam,gain*foamCap*max(0.,1.-u*u)*broken);
  }
}`;
