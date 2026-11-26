// A look's second layout (shared/anim/look.ts): 72 bytes whose first 28 keep their meaning, so a first-layout look
// converts by padding. Every field has a range a client cannot step out of, and bytes past the body's shape no bone.
import { expect, test } from "bun:test";
import { HUMAN_BONES } from "../../shared/anim/human.ts";
import {
  BEARD_STYLES, BROW_STYLES, COMPLEXIONS, FACE_COUNT, LAYOUT_VERSION, LOOK_AGE, LOOK_BEARD, LOOK_BEARD_LENGTH, LOOK_BODY_BYTES, LOOK_BROW, LOOK_BYTES,
  LOOK_COMPLEXION, LOOK_FACE, LOOK_HAIR_COLOR_2, LOOK_HAIR_LENGTH, LOOK_LAYOUT, LOOK_MUSCLE, LOOK_RESERVED, LOOK_SEX, LOOK_V1_BYTES, LOOK_WEIGHT, REGION_COUNT,
  defaultLook, faceOf, lookScales, randomLook, setFace, setRegion, upgradeLook, validLook,
} from "../../shared/anim/look.ts";
import { HAIR_COLORS } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";

test("the default and random looks are valid, of the second layout, and neutral past the colours", () => {
  const plain = defaultLook();
  expect([plain.length, plain[LOOK_LAYOUT], validLook(plain)]).toEqual([LOOK_BYTES, LAYOUT_VERSION, true]);
  expect([...plain.subarray(LOOK_LAYOUT + 1)].every((v) => v === 0)).toBe(true);
  const rng = new Rng(5), faces = new Set<number>();
  for (let i = 0; i < 500; i++) {
    const look = randomLook(rng);
    expect(validLook(look)).toBe(true);
    for (let f = 0; f < FACE_COUNT; f++) {
      // Random faces stay modest: within four tenths of neutral.
      expect(Math.abs(faceOf(look, f))).toBeLessThanOrEqual(0.4 + 1 / 127);
      faces.add(look[LOOK_FACE + f]!);
    }
  }
  expect(faces.size).toBeGreaterThan(50);
});

test("validLook holds every field to its range", () => {
  const bad = (at: number, value: number): boolean => {
    const look = defaultLook();
    look[at] = value;
    return validLook(look);
  };
  // -128 is one step past a slider's end, in a region, a body byte or a face modifier.
  for (const at of [1, REGION_COUNT, LOOK_AGE, LOOK_WEIGHT, LOOK_MUSCLE, LOOK_FACE, LOOK_FACE + FACE_COUNT - 1]) {
    expect(bad(at, 128)).toBe(false);
    expect(bad(at, 127) && bad(at, 129)).toBe(true);
  }
  expect([bad(LOOK_LAYOUT, 0), bad(LOOK_LAYOUT, LAYOUT_VERSION + 1)]).toEqual([false, false]);
  expect([bad(LOOK_BROW, BROW_STYLES - 1), bad(LOOK_BROW, BROW_STYLES)]).toEqual([true, false]);
  expect([bad(LOOK_COMPLEXION, COMPLEXIONS - 1), bad(LOOK_COMPLEXION, COMPLEXIONS)]).toEqual([true, false]);
  expect([bad(LOOK_HAIR_COLOR_2, HAIR_COLORS), bad(LOOK_HAIR_COLOR_2, HAIR_COLORS + 1)]).toEqual([true, false]);
  expect([bad(LOOK_HAIR_LENGTH, 255), bad(LOOK_BEARD_LENGTH, 255)]).toEqual([true, true]);
  for (let at = LOOK_RESERVED; at < LOOK_FACE; at++) expect(bad(at, 1)).toBe(false);
  expect(validLook(new Uint8Array(LOOK_BYTES - 1))).toBe(false);
  expect(validLook(defaultLook().subarray(0, LOOK_V1_BYTES))).toBe(false);
});

test("a beard is valid on either body", () => {
  for (let sex = 0; sex < 2; sex++) for (let beard = 0; beard < BEARD_STYLES.length; beard++) {
    const look = defaultLook();
    look[LOOK_SEX] = sex;
    look[LOOK_BEARD] = beard;
    expect(validLook(look)).toBe(true);
  }
});

test("a first-layout look is padded to the second: the same first bytes, then neutral", () => {
  const old = randomLook(new Rng(11)).slice(0, LOOK_V1_BYTES);
  const look = upgradeLook(old);
  expect(look.length).toBe(LOOK_BYTES);
  expect([...look.subarray(0, LOOK_V1_BYTES)]).toEqual([...old]);
  expect(look[LOOK_LAYOUT]).toBe(LAYOUT_VERSION);
  expect([...look.subarray(LOOK_LAYOUT + 1)].every((v) => v === 0)).toBe(true);
  expect(validLook(look)).toBe(true);
  // A look of this layout, or of no layout, is left for validLook to judge.
  const now = defaultLook();
  expect(upgradeLook(now)).toBe(now);
  expect(validLook(upgradeLook(new Uint8Array(30)))).toBe(false);
});

test("bytes past the body's shape change no bone stretch", () => {
  const rng = new Rng(17), a = new Float32Array(HUMAN_BONES * 3), b = new Float32Array(HUMAN_BONES * 3);
  for (let i = 0; i < 200; i++) {
    const look = randomLook(rng), other = randomLook(rng);
    // Every byte past the body's from another look: colours, hair, brow, lengths, body bytes, faces.
    other.set(look.subarray(0, LOOK_BODY_BYTES));
    lookScales(look, a);
    lookScales(other, b);
    expect([...b]).toEqual([...a]);
  }
  const look = defaultLook();
  for (let f = 0; f < FACE_COUNT; f++) setFace(look, f, 1);
  lookScales(look, a);
  expect([...a].every((v) => v === 1)).toBe(true);
});

test("one region alone that fits keeps all of its stretch; all at once are eased", () => {
  const scales = new Float32Array(HUMAN_BONES * 3);
  // Build alone keeps its flesh within LIMB_SLACK: the upper arm's girth and the spine's width.
  for (const [r, bone, axis, amount] of [[21, 7, 1, 0.1], [21, 1, 0, 0.07]] as const) {
    const look = defaultLook();
    setRegion(look, r, 1);
    lookScales(look, scales);
    expect(scales[bone * 3 + axis]).toBeCloseTo(1 + amount, 5);
  }
  const look = defaultLook();
  for (let r = 0; r < REGION_COUNT; r++) setRegion(look, r, 1);
  lookScales(look, scales);
  // The upper arm takes Upper arm and Build together, 1.32 unbounded.
  expect(scales[7 * 3 + 1]!).toBeLessThan(1.2);
  expect(scales[7 * 3 + 1]!).toBeGreaterThan(1);
});
