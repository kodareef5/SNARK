// Transverse Mercator on WGS84 (Snyder, Map Projections: A Working Manual, 1987, pp. 61 to 64), for the small square a map
// covers: its own metres east and north of its centre, to and from longitude and latitude.

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const RAD = Math.PI / 180;

function meridian(phi: number): number {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return A * ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) - ((35 * e6) / 3072) * Math.sin(6 * phi));
}

export class TransverseMercator {
  private readonly lat0: number;
  private readonly lon0: number;
  private readonly m0: number;

  constructor(lat0: number, lon0: number) {
    this.lat0 = lat0 * RAD;
    this.lon0 = lon0 * RAD;
    this.m0 = meridian(this.lat0);
  }

  /** Metres east and north of the origin. */
  forward(lon: number, lat: number): [number, number] {
    const phi = lat * RAD;
    const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
    const t = Math.tan(phi) ** 2;
    const c = EP2 * Math.cos(phi) ** 2;
    const a = (lon * RAD - this.lon0) * Math.cos(phi);
    const east = n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120);
    const north = meridian(phi) - this.m0 + n * Math.tan(phi) * ((a * a) / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720);
    return [east, north];
  }

  /** Longitude and latitude in degrees. */
  inverse(east: number, north: number): [number, number] {
    const e4 = E2 * E2;
    const mu = (this.m0 + north) / (A * (1 - E2 / 4 - (3 * e4) / 64 - (5 * e4 * E2) / 256));
    const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
    const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
    const c1 = EP2 * Math.cos(phi1) ** 2;
    const t1 = Math.tan(phi1) ** 2;
    const s = 1 - E2 * Math.sin(phi1) ** 2;
    const n1 = A / Math.sqrt(s);
    const r1 = (A * (1 - E2)) / s ** 1.5;
    const d = east / n1;
    const phi = phi1 - ((n1 * Math.tan(phi1)) / r1) * ((d * d) / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);
    const lambda = this.lon0 + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) / Math.cos(phi1);
    return [lambda / RAD, phi / RAD];
  }
}
