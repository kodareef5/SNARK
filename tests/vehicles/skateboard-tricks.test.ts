import { expect, test } from "bun:test";
import { ruinKind } from "../../content/ruins.ts";
import { skatePiece } from "../../content/skate-park.ts";
import { slopeKind } from "../../content/slopes.ts";
import { streetKind } from "../../content/street.ts";
import { BOARD } from "../../content/vehicles/skateboard.ts";
import { Body, BTN_CROUCH, BTN_JUMP, BTN_MELEE, BTN_PRONE, BTN_RELOAD, BTN_SPRINT } from "../../shared/sim/character.ts";
import { skateBail } from "../../shared/sim/skateboard.ts";
import { BAIL, GRIND, SLIDE, SPECIAL, SPECIAL_FULL } from "../../shared/sim/skate-state.ts";
import {
  GRADE_CLEAN, GRADE_PERFECT, GRADE_SLOPPY, SKATE_TRICKS, T_360_SHOVE, T_50, T_5050, T_BOARDSLIDE, T_CHRIST_AIR, T_HARDFLIP,
  T_HEELFLIP, T_IMPOSSIBLE, T_INDY, T_KICKFLIP, T_MANUAL, T_MELON, T_NOSE_MANUAL, T_NOSEGRAB, T_NOSEGRIND, T_NOSESLIDE, T_POP_SHOVE, T_TAILGRAB,
  T_VARIAL_HEELFLIP, T_VARIAL_KICKFLIP, entryGrade, entryHalves, entryTrick, trickName,
} from "../../shared/sim/skate-tricks.ts";
import { stepVehicleBody, vehicleStep } from "../../shared/sim/vehicle-body.ts";
import { hitKind } from "../../shared/world/bends.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

const step = (w: TestWorld, b: Body, x: number, z: number, keys: number) => stepVehicleBody(w, b, x, z, keys, BOARD);
const rolling = (speed = 5) => Object.assign(new Body(), { x: 34, z: 20, grounded: true, vz: speed });
/** A full pop, then `keys` with the direction (x, z) for one tick. */
function airTrick(w: TestWorld, b: Body, x: number, z: number, keys: number) {
  for (let i = 0; i < 12; i++) step(w, b, 0, 0, BTN_JUMP);
  step(w, b, 0, 0, 0);
  step(w, b, x, z, keys);
}
function land(w: TestWorld, b: Body, keys = 0) {
  for (let i = 0; i < 60 && !b.grounded; i++) step(w, b, 0, 0, keys);
}
const last = (b: Body) => b.skate!.line[(b.skate!.count - 1) % 16]!;

test("every trick has a name, a family and points, and the direction keys pick each flip", () => {
  for (const t of SKATE_TRICKS.slice(2)) expect(t.name === "" ? t.id : t.points).toBeGreaterThan(0);
  const picks: [number, number, number][] = [
    [0, 0, T_KICKFLIP], [-127, 0, T_KICKFLIP], [127, 0, T_HEELFLIP], [0, 127, T_IMPOSSIBLE], [0, -127, T_POP_SHOVE],
    [-127, 127, T_VARIAL_KICKFLIP], [127, 127, T_VARIAL_HEELFLIP], [-127, -127, T_360_SHOVE], [127, -127, T_HARDFLIP],
  ];
  for (const [x, z, id] of picks) {
    const w = flatWorld(), b = rolling();
    airTrick(w, b, x, z, BTN_RELOAD);
    expect(b.skate!.trick).toBe(id);
    land(w, b);
    expect(entryTrick(last(b))).toBe(id);
    // A direction pressed with the trick never turns the rider.
    expect(b.skate!.switched).toBe(false);
  }
});

test("the direction held picks each grab, paid only once let go", () => {
  for (const [x, z, id] of [[0, 0, T_MELON], [127, 0, T_INDY], [0, 127, T_NOSEGRAB], [0, -127, T_TAILGRAB]] as const) {
    const w = flatWorld(), b = rolling();
    airTrick(w, b, x, z, BTN_CROUCH);
    expect(b.skate!.trick).toBe(id);
    for (let i = 0; i < 10; i++) step(w, b, 0, 0, BTN_CROUCH);
    land(w, b);
    expect(vehicleStep.skateHurt).toBe(0);
    expect(entryTrick(last(b))).toBe(id);
  }
});

test("a landing is graded by how straight it comes down", () => {
  function landAt(spin: number, perfect: boolean) {
    const w = flatWorld(), b = rolling();
    airTrick(w, b, 0, 0, BTN_RELOAD);
    let hurt = 0;
    for (let i = 0; i < 60 && !b.grounded; i++) {
      // The flip is round by now: set how far the deck has turned just before it lands.
      if (b.vy < 0 && b.y < .2) b.skate!.spin = spin;
      step(w, b, 0, 0, perfect && b.vy < 0 && b.y < .2 ? BTN_JUMP : 0);
      hurt = Math.max(hurt, vehicleStep.skateHurt);
    }
    return { hurt, move: b.skate!.move, grade: b.skate!.grade, halves: b.skate!.count ? entryHalves(last(b)) : -1, switched: b.skate!.switched };
  }
  expect(landAt(5, true)).toMatchObject({ hurt: 0, grade: GRADE_PERFECT, halves: 0 });
  expect(landAt(5, false)).toMatchObject({ hurt: 0, grade: GRADE_CLEAN });
  expect(landAt(200, false)).toMatchObject({ hurt: 0, grade: GRADE_CLEAN, halves: 1, switched: true });
  expect(landAt(215, false)).toMatchObject({ hurt: 0, grade: GRADE_SLOPPY, halves: 1 });
  expect(landAt(250, false)).toMatchObject({ hurt: 2, move: BAIL });
});

test("a sloppy landing pays half and costs speed, a Perfect one raises the multiplier", () => {
  const w = flatWorld(), clean = rolling(6), sloppy = rolling(6), perfect = rolling(6);
  for (const [b, spin, press] of [[clean, 0, false], [sloppy, 35, false], [perfect, 0, true]] as const) {
    airTrick(w, b, 0, 0, BTN_RELOAD);
    for (let i = 0; i < 60 && !b.grounded; i++) {
      const near = b.vy < 0 && b.y < .2;
      if (near) b.skate!.spin = spin;
      step(w, b, 0, 0, press && near ? BTN_JUMP : 0);
    }
  }
  expect(clean.skate!.points).toBe(100);
  expect(sloppy.skate!.points).toBe(50);
  expect(entryGrade(last(sloppy))).toBe(GRADE_SLOPPY);
  expect(Math.hypot(sloppy.vx, sloppy.vz)).toBeLessThan(Math.hypot(clean.vx, clean.vz) * .8);
  expect(perfect.skate!.chain).toBe(2);
  expect(clean.skate!.chain).toBe(1);
});

test("a spin of 360 with a kickflip names and pays both", () => {
  const w = flatWorld(), b = rolling(7);
  for (let i = 0; i < 12; i++) step(w, b, 0, 0, BTN_JUMP);
  step(w, b, 0, 0, 0);
  for (let t = 0; t < 40 && (t < 2 || !b.grounded); t++) step(w, b, t < 15 ? -127 : 0, 0, t === 4 ? BTN_RELOAD : 0);
  expect(vehicleStep.skateHurt).toBe(0);
  expect(entryTrick(last(b))).toBe(T_KICKFLIP);
  expect(entryHalves(last(b))).toBe(2);
  expect(trickName(entryTrick(last(b)), entryHalves(last(b)))).toBe("360 Kickflip");
  expect(b.skate!.points).toBe(300);
});

test("edges are ground along, slid across, and the direction at the catch picks the trick", () => {
  function catchKerb(angle: number, x: number, z: number) {
    const w = flatWorld(), kind = w.kind(hitKind(false, 2, 8));
    for (let k = 16; k <= 64; k += 8) w.structs.add(kind, k, .075, 40, 0, 0, 16000);
    const a = angle * Math.PI / 180, b = new Body();
    Object.assign(b, { x: 40 - Math.cos(a) * .3, y: .3, z: 39 - Math.sin(a) * .3, grounded: false, vy: -1,
      vx: 5 * Math.cos(a), vz: 5 * Math.sin(a), vehicleYaw: Math.atan2(Math.cos(a), Math.sin(a)) });
    for (let i = 0; i < 8 && b.skate?.move !== GRIND && b.skate?.move !== SLIDE; i++) step(w, b, x, z, BTN_SPRINT);
    return b.skate!;
  }
  expect(catchKerb(0, 0, 0)).toMatchObject({ move: GRIND, trick: T_5050 });
  expect(catchKerb(0, 0, 127)).toMatchObject({ move: GRIND, trick: T_NOSEGRIND });
  expect(catchKerb(10, 0, -127)).toMatchObject({ move: GRIND, trick: T_50 });
  expect(catchKerb(50, 0, 0)).toMatchObject({ move: SLIDE, trick: T_BOARDSLIDE });
  expect(catchKerb(50, 0, 127)).toMatchObject({ move: SLIDE, trick: T_NOSESLIDE });
  expect(Math.abs(catchKerb(50, 0, 0).spin)).toBe(90);
});

test("a full special meter gives a Christ air for G and empties", () => {
  const w = flatWorld(), b = rolling(6);
  step(w, b, 0, 0, 0);
  b.skate!.special = SPECIAL_FULL;
  airTrick(w, b, 0, 0, BTN_MELEE);
  expect(b.skate!.move).toBe(SPECIAL);
  expect(b.skate!.special).toBe(0);
  land(w, b);
  expect(entryTrick(last(b))).toBe(T_CHRIST_AIR);
  expect(b.skate!.points).toBe(1000);
  const empty = rolling(6);
  airTrick(w, empty, 0, 0, BTN_MELEE);
  expect(empty.skate!.move).not.toBe(SPECIAL);
});

test("a bench, a low wall and a seat are ledges to grind, found from their boxes", () => {
  for (const [id, y] of [[streetKind("bench"), 0], [ruinKind("sill8"), .45], [ruinKind("seat"), .2]] as const) {
    const w = flatWorld(), kind = w.kind(id);
    w.structs.add(kind, 40, y, 40, 0, 0, 16000);
    // Along each edge that runs the piece's length; one under a bench's back is blocked by the back.
    const ground = w.reg.parts.grindLine![kind]!.filter((l) => l[0]![2] === l[1]![2]).map((edge) => {
      const b = Object.assign(new Body(), { x: 40 + edge[0]![0] + .3, y: y + edge[0]![1] + .25, z: 40 + edge[0]![2] - .05,
        grounded: false, vy: -1, vx: 6, vehicleYaw: Math.PI / 2 });
      let grinding = 0;
      for (let i = 0; i < 20; i++) { step(w, b, 0, 0, BTN_SPRINT); if (b.skate!.move === GRIND) grinding++; }
      return grinding;
    });
    expect(ground.filter((n) => n >= 4).length).toBeGreaterThanOrEqual(2);
  }
  // A wall is too tall to be a ledge.
  const w = flatWorld();
  expect(w.reg.parts.grindLine?.[w.kind("core:wall")]).toBeUndefined();
});

test("the join of two floor slabs is no edge to grind, but a slab's outer edge is", () => {
  const w = flatWorld(), kind = w.kind(ruinKind("floor4"));
  w.structs.add(kind, 40, 0, 40, 0, 0, 16000);
  w.structs.add(kind, 44, 0, 40, 0, 0, 16000);
  const ride = (x: number) => {
    const b = Object.assign(new Body(), { x: x + .05, y: .45, z: 38.5, grounded: false, vy: -1, vz: 6 });
    let grinding = 0;
    for (let i = 0; i < 20; i++) { step(w, b, 0, 0, BTN_SPRINT); if (b.skate!.move === GRIND || b.skate!.move === SLIDE) grinding++; }
    return grinding;
  };
  expect(ride(42)).toBe(0);
  expect(ride(38)).toBeGreaterThan(8);
});

test("a ramp throws the rider off its lip, and a kerb stops the wheels without a fall", () => {
  const w = flatWorld();
  w.structs.add(w.kind(slopeKind("rubble")), 40, .75, 40, 0, 0, 16000);
  const b = Object.assign(new Body(), { x: 40, z: 33, grounded: true, vz: 8 });
  let top = 0, airborne = 0;
  for (let t = 0; t < 90; t++) { step(w, b, 0, 0, 0); top = Math.max(top, b.y); if (!b.grounded) airborne++; }
  expect(top).toBeGreaterThan(1.55);
  expect(airborne).toBeGreaterThan(10);
  const kerbs = flatWorld(), kind = kerbs.kind(hitKind(false, 2, 8));
  for (let x = 24; x <= 56; x += 8) kerbs.structs.add(kind, x, .075, 40, 0, 0, 16000);
  const c = Object.assign(new Body(), { x: 40, z: 36, grounded: true, vz: 9 });
  let worst = 0;
  for (let t = 0; t < 30; t++) { step(kerbs, c, 0, 0, 0); worst = Math.max(worst, skateBail(vehicleStep.impactSpeed, vehicleStep.landSpeed)); }
  expect(worst).toBe(0);
  expect(c.vz).toBe(0);
  expect(c.y).toBeLessThan(.01);
});

test("a crafted kicker throws the rider, and a crafted rail and ledge are ground", () => {
  const w = flatWorld();
  w.structs.add(w.kind(skatePiece("kicker")), 40, .25, 40, 0, 0, 1200);
  // Rolled up, it hops a little over the lip; popped at the lip, it adds its rise to the ollie.
  function ride(pop: boolean) {
    const b = Object.assign(new Body(), { x: 40, z: 36, grounded: true, vz: 7 });
    let top = 0;
    for (let t = 0; t < 60; t++) {
      const holding = pop && b.grounded && b.z > 38 && b.z < 40.6;
      step(w, b, 0, 0, holding ? BTN_JUMP : 0);
      top = Math.max(top, b.y);
    }
    expect(b.skate?.move ?? 0).not.toBe(BAIL);
    return top;
  }
  const rolled = ride(false), popped = ride(true);
  expect(rolled).toBeGreaterThan(.55);
  expect(popped).toBeGreaterThan(1.6);
  for (const [name, y] of [["rail", .225], ["ledge", .2]] as const) {
    const v = flatWorld(), kind = v.kind(skatePiece(name));
    v.structs.add(kind, 40, y, 40, 0, 0, 1500);
    const edge = v.reg.parts.grindLine![kind]![0]!;
    const c = Object.assign(new Body(), { x: 39, y: y + edge[0]![1] + .25, z: 40 + edge[0]![2] - .05, grounded: false, vy: -1, vx: 5, vehicleYaw: Math.PI / 2 });
    let grinding = 0;
    for (let i = 0; i < 20; i++) { step(v, c, 0, 0, BTN_SPRINT); if (c.skate!.move === GRIND) grinding++; }
    expect(grinding).toBeGreaterThan(8);
  }
});

test("a key held to push or carve picks no trick until pressed again for it", () => {
  const w = flatWorld();
  // W held to push through the pop: R is a kickflip. W pressed again in the air with R: an impossible.
  const pushed = rolling(5);
  for (let i = 0; i < 20; i++) step(w, pushed, 0, 127, 0);
  for (let i = 0; i < 6; i++) step(w, pushed, 0, 127, BTN_JUMP);
  step(w, pushed, 0, 127, 0);
  step(w, pushed, 0, 127, BTN_RELOAD);
  expect(pushed.skate!.trick).toBe(T_KICKFLIP);
  const fresh = rolling(5);
  for (let i = 0; i < 20; i++) step(w, fresh, 0, 127, 0);
  for (let i = 0; i < 6; i++) step(w, fresh, 0, 127, BTN_JUMP);
  step(w, fresh, 0, 0, 0);
  step(w, fresh, 0, 127, BTN_RELOAD);
  expect(fresh.skate!.trick).toBe(T_IMPOSSIBLE);
  // Carving with A into the pop does not spin the rider; A pressed again in the air does.
  const carved = rolling(5);
  for (let i = 0; i < 12; i++) step(w, carved, -127, 0, i > 4 ? BTN_JUMP : 0);
  for (let i = 0; i < 8; i++) step(w, carved, -127, 0, 0);
  expect(carved.skate!.spin).toBe(0);
  // W held a while, then X: a manual. W pressed with X: a nose manual.
  const manual = rolling(5);
  for (let i = 0; i < 12; i++) step(w, manual, 0, 127, 0);
  step(w, manual, 0, 127, BTN_PRONE);
  expect(manual.skate!.trick).toBe(T_MANUAL);
  const nose = rolling(5);
  step(w, nose, 0, 0, 0);
  step(w, nose, 0, 127, BTN_PRONE);
  expect(nose.skate!.trick).toBe(T_NOSE_MANUAL);
});
