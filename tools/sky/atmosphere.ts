// The sky as light scattered by air, after Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering
// Technique" (EGSR 2020): a table of how much sunlight gets through, a table of the light scattered more than once,
// and the sky seen from the ground marched along each view ray. It runs at build time only.
//
// Lengths are kilometres. Light is per unit of sunlight arriving at the top of the air, in three channels standing for
// red, green and blue (680, 550 and 440 nm), as the paper's numbers are.

export interface Air {
  /** Radii of the ground and the top of the air. */
  ground: number;
  top: number;
  rayleigh: readonly [number, number, number];
  rayleighHeight: number;
  mieScatter: number;
  mieExtinct: number;
  mieHeight: number;
  /** How strongly haze scatters forward, for its phase function. */
  mieG: number;
  /** Ozone absorbs in a layer this thick either side of its middle. */
  ozone: readonly [number, number, number];
  ozoneMiddle: number;
  ozoneHalf: number;
  /** The share of light the ground sends back, white and even. */
  albedo: number;
}

/** The paper's Earth, over a ground that is mostly sea. */
export const EARTH: Air = {
  ground: 6360,
  top: 6460,
  rayleigh: [5.802e-3, 13.558e-3, 33.1e-3],
  rayleighHeight: 8,
  mieScatter: 3.996e-3,
  mieExtinct: 4.44e-3,
  mieHeight: 1.2,
  mieG: 0.8,
  ozone: [0.65e-3, 1.881e-3, 0.085e-3],
  ozoneMiddle: 25,
  ozoneHalf: 15,
  albedo: 0.1,
};

/** Where the eye stands: two metres over the ground. */
export const EYE_HEIGHT = 0.002;

const TRANS_H = 64;
const TRANS_MU = 256;
const TRANS_STEPS = 40;
const MS_SIZE = 32;
/** Directions the light scattered more than once is gathered from, as a square of this many on a side. */
const MS_DIRS = 8;
const MS_STEPS = 20;
const VIEW_STEPS = 40;

/** The phase functions: Rayleigh's, and Cornette and Shanks's for haze, as the paper uses. */
export function rayleighPhase(cos: number): number {
  return (3 / (16 * Math.PI)) * (1 + cos * cos);
}

export function miePhase(g: number, cos: number): number {
  const k = (3 / (8 * Math.PI)) * ((1 - g * g) / (2 + g * g));
  return (k * (1 + cos * cos)) / Math.pow(1 + g * g - 2 * g * cos, 1.5);
}

const UNIFORM = 1 / (4 * Math.PI);

/** Distance along a ray from radius r with cosine mu to the sphere of radius R: the near crossing or the far one, or -1. */
function toSphere(r: number, mu: number, R: number, near: boolean): number {
  const b = r * mu;
  const d = b * b - r * r + R * R;
  if (d < 0) return -1;
  const s = Math.sqrt(d);
  const t = near ? -b - s : -b + s;
  return t >= 0 ? t : -1;
}

export class Atmosphere {
  readonly air: Air;
  private readonly trans = new Float64Array(TRANS_H * TRANS_MU * 3);
  private readonly ms = new Float64Array(MS_SIZE * MS_SIZE * 3);
  // What `medium` and the lookups leave, a channel each.
  private sR = 0;
  private sG = 0;
  private sB = 0;
  private sM = 0;
  private eR = 0;
  private eG = 0;
  private eB = 0;
  private tR = 0;
  private tG = 0;
  private tB = 0;
  private mR = 0;
  private mG = 0;
  private mB = 0;

  constructor(air: Air = EARTH) {
    this.air = air;
    this.buildTransmittance();
    this.buildMultiple();
  }

  /** Scattering by air (per channel) and haze, and extinction, at a height over the ground. */
  private medium(h: number): void {
    const a = this.air;
    const rd = Math.exp(-h / a.rayleighHeight);
    const md = Math.exp(-h / a.mieHeight);
    const od = h > a.ozoneMiddle - a.ozoneHalf && h < a.ozoneMiddle + a.ozoneHalf ? 1 - Math.abs(h - a.ozoneMiddle) / a.ozoneHalf : 0;
    const m = a.mieExtinct * md;
    this.sR = a.rayleigh[0] * rd;
    this.sG = a.rayleigh[1] * rd;
    this.sB = a.rayleigh[2] * rd;
    this.sM = a.mieScatter * md;
    this.eR = this.sR + m + a.ozone[0] * od;
    this.eG = this.sG + m + a.ozone[1] * od;
    this.eB = this.sB + m + a.ozone[2] * od;
  }

  // The transmittance table, by height and by the cosine of the ray's angle from straight up, both by the
  // parametrisation of Bruneton and Neyret, which samples finely near the ground and the horizon.
  private buildTransmittance(): void {
    const a = this.air;
    const H = Math.sqrt(a.top * a.top - a.ground * a.ground);
    for (let j = 0; j < TRANS_H; j++) {
      const rho = (H * j) / (TRANS_H - 1);
      const r = Math.sqrt(rho * rho + a.ground * a.ground);
      for (let i = 0; i < TRANS_MU; i++) {
        const dMin = a.top - r;
        const dMax = rho + H;
        const d = dMin + (i / (TRANS_MU - 1)) * (dMax - dMin);
        const mu = d === 0 ? 1 : Math.max(-1, Math.min(1, (H * H - rho * rho - d * d) / (2 * r * d)));
        let dr = 0, dg = 0, db = 0;
        const dt = d / TRANS_STEPS;
        for (let k = 0; k < TRANS_STEPS; k++) {
          const t = (k + 0.5) * dt;
          this.medium(Math.sqrt(r * r + t * t + 2 * r * mu * t) - a.ground);
          dr += this.eR * dt;
          dg += this.eG * dt;
          db += this.eB * dt;
        }
        const o = (j * TRANS_MU + i) * 3;
        this.trans[o] = Math.exp(-dr);
        this.trans[o + 1] = Math.exp(-dg);
        this.trans[o + 2] = Math.exp(-db);
      }
    }
  }

  /** Sunlight let through from radius r toward a direction with cosine mu from straight up, into tR, tG, tB: 0 where the ground is in the way. */
  private lookTransmittance(r: number, mu: number): void {
    const a = this.air;
    if (mu < 0 && toSphere(r, mu, a.ground, true) > 0) {
      this.tR = this.tG = this.tB = 0;
      return;
    }
    const H = Math.sqrt(a.top * a.top - a.ground * a.ground);
    const rho = Math.sqrt(Math.max(r * r - a.ground * a.ground, 0));
    const d = Math.max(toSphere(r, mu, a.top, false), 0);
    const dMin = a.top - r;
    const dMax = rho + H;
    const x = (dMax > dMin ? (d - dMin) / (dMax - dMin) : 0) * (TRANS_MU - 1);
    const y = (rho / H) * (TRANS_H - 1);
    const x0 = Math.max(0, Math.min(TRANS_MU - 2, Math.floor(x)));
    const y0 = Math.max(0, Math.min(TRANS_H - 2, Math.floor(y)));
    const fx = Math.max(0, Math.min(1, x - x0));
    const fy = Math.max(0, Math.min(1, y - y0));
    const T = this.trans;
    const p = (y0 * TRANS_MU + x0) * 3;
    const q = p + TRANS_MU * 3;
    const w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy), w2 = (1 - fx) * fy, w3 = fx * fy;
    this.tR = T[p]! * w0 + T[p + 3]! * w1 + T[q]! * w2 + T[q + 3]! * w3;
    this.tG = T[p + 1]! * w0 + T[p + 4]! * w1 + T[q + 1]! * w2 + T[q + 4]! * w3;
    this.tB = T[p + 2]! * w0 + T[p + 5]! * w1 + T[q + 2]! * w2 + T[q + 5]! * w3;
  }

  /** Sunlight reaching the eye straight from a sun at the given cosine from straight up, per unit arriving at the top. */
  transmittance(r: number, mu: number, out: Float64Array | number[]): void {
    this.lookTransmittance(r, mu);
    out[0] = this.tR;
    out[1] = this.tG;
    out[2] = this.tB;
  }

  // The light scattered more than once, per unit of scattering, at a height for a sun angle, in the paper's way: the
  // light arriving there after one more bounce, gathered evenly from every direction with the even phase function,
  // times 1 / (1 - f) for every bounce after it, f being the share a bounce passes on.
  private buildMultiple(): void {
    const a = this.air;
    const n = MS_DIRS * MS_DIRS;
    for (let j = 0; j < MS_SIZE; j++) {
      const r = a.ground + Math.max(0.001, ((j + 0.5) / MS_SIZE) * (a.top - a.ground));
      for (let i = 0; i < MS_SIZE; i++) {
        const muS = (i / (MS_SIZE - 1)) * 2 - 1;
        const sunX = Math.sqrt(1 - muS * muS);
        let lr = 0, lg = 0, lb = 0, fr = 0, fg = 0, fb = 0;
        for (let dj = 0; dj < MS_DIRS; dj++) {
          const dy = 1 - (2 * (dj + 0.5)) / MS_DIRS;
          const sinT = Math.sqrt(1 - dy * dy);
          for (let di = 0; di < MS_DIRS; di++) {
            const dx = sinT * Math.cos((2 * Math.PI * (di + 0.5)) / MS_DIRS);
            const hit = toSphere(r, dy, a.ground, true);
            const length = hit > 0 ? hit : toSphere(r, dy, a.top, false);
            let pr = 1, pg = 1, pb = 1;
            const dt = length / MS_STEPS;
            for (let k = 0; k < MS_STEPS; k++) {
              const t = (k + 0.5) * dt;
              const px = dx * t, py = r + dy * t;
              const qz = sinT * Math.sin((2 * Math.PI * (di + 0.5)) / MS_DIRS) * t;
              const pr2 = Math.sqrt(px * px + py * py + qz * qz);
              this.medium(pr2 - a.ground);
              this.lookTransmittance(pr2, (px * sunX + py * muS) / pr2);
              const sr = this.sR + this.sM, sg = this.sG + this.sM, sb = this.sB + this.sM;
              const xr = Math.exp(-this.eR * dt), xg = Math.exp(-this.eG * dt), xb = Math.exp(-this.eB * dt);
              const ir = (pr * (1 - xr)) / this.eR, ig = (pg * (1 - xg)) / this.eG, ib = (pb * (1 - xb)) / this.eB;
              lr += ir * sr * this.tR * UNIFORM;
              lg += ig * sg * this.tG * UNIFORM;
              lb += ib * sb * this.tB * UNIFORM;
              fr += ir * sr;
              fg += ig * sg;
              fb += ib * sb;
              pr *= xr;
              pg *= xg;
              pb *= xb;
            }
            if (hit > 0) {
              const gx = dx * hit, gy = r + dy * hit, gz = sinT * Math.sin((2 * Math.PI * (di + 0.5)) / MS_DIRS) * hit;
              const gr = Math.sqrt(gx * gx + gy * gy + gz * gz);
              const gmu = (gx * sunX + gy * muS) / gr;
              this.lookTransmittance(gr, gmu);
              const k = Math.max(gmu, 0) * (a.albedo / Math.PI);
              lr += pr * this.tR * k;
              lg += pg * this.tG * k;
              lb += pb * this.tB * k;
            }
          }
        }
        // The mean over the directions is the integral over the sphere with the even phase function.
        const o = (j * MS_SIZE + i) * 3;
        this.ms[o] = lr / n / (1 - fr / n);
        this.ms[o + 1] = lg / n / (1 - fg / n);
        this.ms[o + 2] = lb / n / (1 - fb / n);
      }
    }
  }

  private lookMultiple(r: number, muS: number): void {
    const a = this.air;
    const x = ((muS + 1) / 2) * (MS_SIZE - 1);
    const y = ((r - a.ground) / (a.top - a.ground)) * MS_SIZE - 0.5;
    const x0 = Math.max(0, Math.min(MS_SIZE - 2, Math.floor(x)));
    const y0 = Math.max(0, Math.min(MS_SIZE - 2, Math.floor(y)));
    const fx = Math.max(0, Math.min(1, x - x0));
    const fy = Math.max(0, Math.min(1, y - y0));
    const M = this.ms;
    const p = (y0 * MS_SIZE + x0) * 3;
    const q = p + MS_SIZE * 3;
    const w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy), w2 = (1 - fx) * fy, w3 = fx * fy;
    this.mR = M[p]! * w0 + M[p + 3]! * w1 + M[q]! * w2 + M[q + 3]! * w3;
    this.mG = M[p + 1]! * w0 + M[p + 4]! * w1 + M[q + 1]! * w2 + M[q + 4]! * w3;
    this.mB = M[p + 2]! * w0 + M[p + 5]! * w1 + M[q + 2]! * w2 + M[q + 5]! * w3;
  }

  /**
   * The sky's light seen from the eye in a direction (x, y, z, y up, length 1) with the sun in direction `sun`, per unit
   * of sunlight, into out[0..2]; and with out[3..5] there, the part of it sunlight scattered once by haze gives, the
   * bright glow round the sun. Below the horizon the ray ends on the ground, which is left black.
   */
  sky(dir: ArrayLike<number>, sun: ArrayLike<number>, out: Float64Array | number[]): void {
    const a = this.air;
    const r = a.ground + EYE_HEIGHT;
    const vx = dir[0]!, vy = dir[1]!, vz = dir[2]!;
    const ux = sun[0]!, uy = sun[1]!, uz = sun[2]!;
    const hit = toSphere(r, vy, a.ground, true);
    const length = hit > 0 ? hit : toSphere(r, vy, a.top, false);
    const cos = vx * ux + vy * uy + vz * uz;
    const pr = rayleighPhase(cos);
    const pm = miePhase(a.mieG, cos);
    let or = 0, og = 0, ob = 0, qr = 1, qg = 1, qb = 1, hr = 0, hg = 0, hb = 0;
    // Steps grow with distance: the air thins with height, and the light comes mostly from near the eye.
    let t0 = 0;
    for (let k = 0; k < VIEW_STEPS; k++) {
      const t1 = length * ((k + 1) / VIEW_STEPS) ** 2;
      const dt = t1 - t0;
      const t = (t0 + t1) / 2;
      t0 = t1;
      const px = vx * t, py = r + vy * t, pz = vz * t;
      const p = Math.sqrt(px * px + py * py + pz * pz);
      this.medium(p - a.ground);
      const muS = (px * ux + py * uy + pz * uz) / p;
      this.lookTransmittance(p, muS);
      this.lookMultiple(p, muS);
      const sr = this.tR * (this.sR * pr + this.sM * pm) + this.mR * (this.sR + this.sM);
      const sg = this.tG * (this.sG * pr + this.sM * pm) + this.mG * (this.sG + this.sM);
      const sb = this.tB * (this.sB * pr + this.sM * pm) + this.mB * (this.sB + this.sM);
      const xr = Math.exp(-this.eR * dt), xg = Math.exp(-this.eG * dt), xb = Math.exp(-this.eB * dt);
      or += (qr * sr * (1 - xr)) / this.eR;
      og += (qg * sg * (1 - xg)) / this.eG;
      ob += (qb * sb * (1 - xb)) / this.eB;
      hr += (qr * this.tR * this.sM * pm * (1 - xr)) / this.eR;
      hg += (qg * this.tG * this.sM * pm * (1 - xg)) / this.eG;
      hb += (qb * this.tB * this.sM * pm * (1 - xb)) / this.eB;
      qr *= xr;
      qg *= xg;
      qb *= xb;
    }
    out[0] = or;
    out[1] = og;
    out[2] = ob;
    if (out.length >= 6) {
      out[3] = hr;
      out[4] = hg;
      out[5] = hb;
    }
  }

  /** Sunlight reaching the eye straight from a sun at the given cosine from straight up, per unit arriving at the top. */
  sunAtGround(muS: number, out: Float64Array | number[]): void {
    this.transmittance(this.air.ground + EYE_HEIGHT, muS, out);
  }
}
