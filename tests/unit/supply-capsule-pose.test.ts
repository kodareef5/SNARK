// The supply capsule's pieces as they stand (client/core/render/supply.ts): each moving piece's bone from the
// capsule's stance, held to the measurements its model is built to (shared/world/supply-capsule.json).

import { expect, test } from "bun:test";
import { CAPSULE, HALOS, HALO_CLIMB, PIECE, PIECES, SHAFT_FADE_FROM, SHAFT_FADE_TO, SHAFT_HAZE, SHAFT_PIXELS, SHAFT_RADIUS, SHEATH_WIDER, SLATS, collarBone, fixedBone, haloAt, hatchBone, hoopBone, legBone, markBone, shaftKeeps, shaftRadius, slatBone, slatOpen, uprightBone, type CapsuleStance } from "../../client/core/render/supply.ts";
import { MARKS } from "../../shared/sim/supply.ts";

const TAU = 2 * Math.PI;
const stance = (more: Partial<CapsuleStance> = {}): CapsuleStance => ({ x: 0, y: 0, z: 0, yaw: 0, legs: 1, shutters: 0, hatch: 0, hoop: 0, ...more });
/** Where a bone takes a point of its piece. */
const through = (rows: Float32Array, x: number, y: number, z: number): [number, number, number] => [
  rows[0]! * x + rows[1]! * y + rows[2]! * z + rows[3]!,
  rows[4]! * x + rows[5]! * y + rows[6]! * z + rows[7]!,
  rows[8]! * x + rows[9]! * y + rows[10]! * z + rows[11]!,
];
/** Whether a bone turns and moves and does nothing else: its three axes a unit long, square to one another, right-handed. */
const rigid = (rows: Float32Array): boolean => {
  const col = (k: number): [number, number, number] => [rows[k]!, rows[4 + k]!, rows[8 + k]!];
  const [x, y, z] = [col(0), col(1), col(2)];
  const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const cross = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return [dot(x, x), dot(y, y), dot(z, z)].every((v) => Math.abs(v - 1) < 1e-6) && [dot(x, y), dot(y, z), dot(x, z)].every((v) => Math.abs(v) < 1e-6) && Math.abs(dot(cross, z) - 1) < 1e-6;
};
const rows = new Float32Array(12);

test("the pieces are the model's, a top-mark to each class's mark, and the measurements are a capsule's", () => {
  expect([...PIECES]).toEqual(["hull", "leg", "shutter", "hatch", "collar", "hoop", "lights", ...MARKS.map((m) => `mark_${m}`), "shaft", "sheath", "halo", "jet", "foot", ...MARKS.map((m) => `figure_${m}`)]);
  expect([PIECES[PIECE.mark], PIECES[PIECE.mark + 6], PIECES[PIECE.shaft], PIECES[PIECE.sheath], PIECES[PIECE.halo], PIECES[PIECE.jet], PIECES[PIECE.foot], PIECES[PIECE.figure], PIECES[PIECE.figure + 6]]).toEqual(["mark_bar", "mark_cone_up", "shaft", "sheath", "halo", "jet", "foot", "figure_bar", "figure_cone_up"]);
  expect([CAPSULE.legs, SLATS, CAPSULE.collar.most, CAPSULE.feet, CAPSULE.height > 2.4 && CAPSULE.height < 2.8]).toEqual([3, 12, 7, 1.2, true]);
  // Seven collars fit the register, between the drum's upper belt and the lantern's sill.
  expect([CAPSULE.collar.first > 1.14, CAPSULE.collar.first + CAPSULE.collar.most * CAPSULE.collar.pitch < 1.425]).toEqual([true, true]);
});

test("splayed, each leg's foot stands on the ground a hundred and twenty degrees from the next, at the capsule's feet; folded, it lies up the drum inside them", () => {
  const [fx, fy] = CAPSULE.leg as [number, number];
  const feet: [number, number, number][] = [];
  for (let k = 0; k < CAPSULE.legs; k++) {
    legBone(rows, 0, stance(), k);
    expect(rigid(rows)).toBe(true);
    const foot = through(rows, fx, fy, 0);
    feet.push(foot);
    expect([Math.abs(foot[1]) < 1e-6, Math.abs(Math.hypot(foot[0], foot[2]) - CAPSULE.feet) < 1e-6]).toEqual([true, true]);
    // Its hinge does not move as it folds.
    const hinge = through(rows, 0, 0, 0);
    legBone(rows, 0, stance({ legs: 0 }), k);
    expect(through(rows, 0, 0, 0).map((v, i) => Math.abs(v - hinge[i]!) < 1e-6)).toEqual([true, true, true]);
    // Folded: the foot is over the hinge, against the drum, under the register's collars.
    const up = through(rows, fx, fy, 0);
    expect([up[1] > 1.0 && up[1] < CAPSULE.collar.first + 0.12, Math.hypot(up[0], up[2]) > CAPSULE.hull && Math.hypot(up[0], up[2]) < CAPSULE.hull + 0.12]).toEqual([true, true]);
  }
  const apart = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);
  expect([apart(feet[0]!, feet[1]!), apart(feet[1]!, feet[2]!), apart(feet[2]!, feet[0]!)].every((d) => Math.abs(d - CAPSULE.feet * Math.sqrt(3)) < 1e-5)).toBe(true);
  // Half way it is between the two, and a leg never passes through the drum on its way: its foot is always outside it.
  for (let t = 0; t <= 1; t += 0.05) {
    legBone(rows, 0, stance({ legs: t }), 0);
    const foot = through(rows, fx, fy, 0);
    expect(Math.hypot(foot[0], foot[2])).toBeGreaterThan(CAPSULE.hull);
  }
});

test("a louvre's slats hang shut over their bay and open one after another from the top, each swinging its foot out", () => {
  const lantern = CAPSULE.lantern;
  // Shut: every slat hangs straight down, proud of its bay's glass, the lowest reaching the lantern's foot.
  for (let k = 0; k < CAPSULE.legs; k++) {
    for (let j = 0; j < lantern.slats; j++) {
      slatBone(rows, 0, stance(), k, j);
      expect(rigid(rows)).toBe(true);
      const [axle, foot] = [through(rows, 0, 0, 0), through(rows, 0, -lantern.slatPitch, 0)];
      const out = (p: number[]): number => Math.hypot(p[0]!, p[2]!);
      expect([Math.abs(axle[1] - (lantern.slatTop - j * lantern.slatPitch)) < 1e-6, Math.abs(out(axle) - out(foot)) < 1e-6, Math.abs(foot[1] - axle[1] + lantern.slatPitch) < 1e-6]).toEqual([true, true, true]);
      // Open: its axle stays, and its foot is out and up.
      slatBone(rows, 0, stance({ shutters: 1 }), k, j);
      const swung = through(rows, 0, -lantern.slatPitch, 0);
      expect([through(rows, 0, 0, 0).every((v, i) => Math.abs(v - axle[i]!) < 1e-6), out(swung) > out(foot) + 0.07, swung[1] > foot[1] + 0.04]).toEqual([true, true, true]);
    }
  }
  expect(lantern.slatTop - lantern.slats * lantern.slatPitch).toBeCloseTo(lantern.foot + 0.006, 2);
  // In turn: at each moment a slat is no further open than the one before it in the order, and none ever closes again.
  const order: [number, number][] = [];
  for (let j = 0; j < lantern.slats; j++) for (let k = 0; k < CAPSULE.legs; k++) order.push([k, j]);
  let was = order.map(() => 0);
  for (let s = 0; s <= 1.0001; s += 0.02) {
    const now = order.map(([k, j]) => slatOpen(s, k, j));
    for (let i = 1; i < now.length; i++) expect(now[i]!).toBeLessThanOrEqual(now[i - 1]! + 1e-9);
    for (let i = 0; i < now.length; i++) expect(now[i]!).toBeGreaterThanOrEqual(was[i]! - 1e-9);
    was = now;
  }
  expect([slatOpen(0, 0, 0), slatOpen(0.2, 0, 0) > 0, slatOpen(0.2, 2, 3), slatOpen(1, 2, 3)]).toEqual([0, true, 0, 1]);
});

test("the hatch swings out about its pin, the hoop turns about the capsule's axis, and a collar and the top-mark stand where the register and the mast have them", () => {
  const h = CAPSULE.hatch;
  const free = (a: number): [number, number, number] => {
    hatchBone(rows, 0, stance({ hatch: a }), );
    // The hatch's free edge, in its own frame: where the far end of its arc is from its pin.
    const pin = h.azimuth - h.half, end = h.azimuth + h.half;
    return through(rows, h.radius * (Math.cos(end) - Math.cos(pin)), 0.8, h.radius * (Math.sin(end) - Math.sin(pin)));
  };
  const [shut, ajar] = [free(0), free(1)];
  expect([Math.abs(Math.hypot(shut[0], shut[2]) - h.radius) < 1e-6, Math.hypot(ajar[0], ajar[2]) > h.radius + 0.25, ajar[1], rigid(rows)]).toEqual([true, true, shut[1], true]);
  hoopBone(rows, 0, stance({ hoop: 1.3 }));
  expect([rigid(rows), through(rows, 0, 1.5, 0)]).toEqual([true, [0, 1.5, 0]]);
  expect(Math.hypot(...through(rows, 0.9, 0, 0)) ).toBeCloseTo(0.9, 6);
  collarBone(rows, 0, stance(), 3);
  expect(through(rows, 0, 0, 0)[1]).toBeCloseTo(CAPSULE.collar.first + 3 * CAPSULE.collar.pitch, 6);
  markBone(rows, 0, stance());
  expect(through(rows, 0, 0, 0)).toEqual([0, Math.fround(CAPSULE.mast.head), 0]);
});

test("the whole capsule goes where its stance puts it and turns as it is turned: every piece by the same turn", () => {
  const s = stance({ x: 12, y: -3, z: 40, yaw: TAU / 4 });
  fixedBone(rows, 0, s);
  // A quarter turn takes the capsule's own +Z to the world's +X, as a body's yaw does.
  expect(through(rows, 0, 1, 1).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([13, -2, 40]);
  // A leg's foot, turned with it, is where the unturned one's is turned to.
  const [fx, fy] = CAPSULE.leg as [number, number];
  legBone(rows, 0, stance(), 1);
  const plain = through(rows, fx, fy, 0);
  legBone(rows, 0, s, 1);
  const turned = through(rows, fx, fy, 0);
  expect([turned[0] - 12, turned[1] + 3, turned[2] - 40].map((v) => Math.round(v * 1e5) / 1e5)).toEqual([plain[2], plain[1], -plain[0]].map((v) => Math.round(v * 1e5) / 1e5));
});

test("a shaft is its own width at hand and never under two pixels wide however far off; the haze takes at most a little over half of it, and it fades out between six and eight kilometres", () => {
  const fov = 1.2217, tall = 1080;
  expect([shaftRadius(5, fov, tall), shaftRadius(150, fov, tall), shaftRadius(5, fov, tall, SHEATH_WIDER)]).toEqual([SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_RADIUS * SHEATH_WIDER]);
  for (const far of [1000, 4000, 7900]) {
    // Its width in pixels: its diameter over what a pixel is there.
    const pixels = (2 * shaftRadius(far, fov, tall)) / ((far * fov) / tall);
    expect([far, Math.abs(pixels - SHAFT_PIXELS) < 1e-9, shaftRadius(far, fov, tall, SHEATH_WIDER) > shaftRadius(far, fov, tall) * 1.5]).toEqual([far, true, true]);
  }
  // A taller picture has smaller pixels: the floor is narrower in metres.
  expect(shaftRadius(4000, fov, 2160)).toBeCloseTo(shaftRadius(4000, fov, 1080) / 2, 9);
  expect([shaftKeeps(100, 0), shaftKeeps(3000, 1), shaftKeeps(3000, 0.5), shaftKeeps(SHAFT_FADE_FROM, 0), shaftKeeps(SHAFT_FADE_TO, 0), shaftKeeps(9000, 0)]).toEqual([1, 1 - SHAFT_HAZE, 0.75, 1, 0, 0]);
  expect(shaftKeeps((SHAFT_FADE_FROM + SHAFT_FADE_TO) / 2, 0)).toBeCloseTo(0.5, 6);
});

test("a ringed drop's halos climb its shaft one after another, each out of the foot and gone before it would turn back", () => {
  const at = { height: 0, strength: 0 };
  for (let k = 0; k < HALOS; k++) {
    let was = -1;
    let wraps = 0;
    for (let s = 0; s < 60; s += 0.05) {
      haloAt(s, k, at);
      expect([at.height >= 2.5, at.height <= 2.5 + HALO_CLIMB, at.strength >= 0 && at.strength <= 1]).toEqual([true, true, true]);
      if (at.height < was) {
        // It only ever goes back down as a new halo at the foot, and the old one had faded out before.
        wraps++;
        expect([at.height < 3.2, at.strength < 0.05]).toEqual([true, true]);
      }
      was = at.height;
    }
    expect(wraps).toBeGreaterThan(2);
  }
  // The three are a third of the climb apart.
  const heights = [0, 1, 2].map((k) => (haloAt(1, k, at), at.height));
  expect([heights[1]! - heights[0]!, heights[2]! - heights[1]!].map((d) => Math.round(d * 1000) / 1000)).toEqual([HALO_CLIMB / HALOS, HALO_CLIMB / HALOS]);
});

test("a piece of light stands upright where it is put, as wide and as tall as it is told", () => {
  uprightBone(rows, 0, 5, -2, 30, 0.42, 0.5);
  expect([through(rows, 1, 600, 0), through(rows, 0, 0, 1)].map((p) => p.map((v) => Math.round(v * 1e5) / 1e5))).toEqual([[5.42, 298, 30], [5, -2, 30.42]]);
});
