// The creators' face controls (shared/people/face-controls.ts): labels in the cooked modifiers' order, groups that
// cover every byte once, presets that are whole faces, a random face that touches only the face, and the entry
// page's face buttons.

import { expect, test } from "bun:test";
import { FACE_COUNT, LOOK_FACE, LOOK_SKIN, defaultLook, faceOf, randomLook, validLook } from "../../shared/anim/look.ts";
import { FACE_GROUPS, FACE_LABELS, FACE_PRESETS, FACE_SPREAD, faceAction, randomFace, resetFace, setFaces } from "../../shared/people/face-controls.ts";
import { Rng } from "../../shared/rng.ts";
import { FACE_MODIFIERS } from "../../tools/makehuman/faces.ts";

test("each face label names its cooked modifier, in byte order", () => {
  expect(FACE_LABELS.length).toBe(FACE_MODIFIERS.length);
  expect(FACE_LABELS.length).toBe(FACE_COUNT);
  expect(FACE_LABELS.map((l) => l.toLowerCase())).toEqual(FACE_MODIFIERS.map((m) => m.name));
  for (const l of FACE_LABELS) expect(l[0]).toBe(l[0]!.toUpperCase());
});

test("the face groups hold every modifier once, in byte order", () => {
  expect(FACE_GROUPS.flatMap((g) => g.faces)).toEqual([...Array(FACE_COUNT).keys()]);
  for (const g of FACE_GROUPS) expect(g.faces.length).toBeGreaterThan(0);
  expect(new Set(FACE_GROUPS.map((g) => g.short)).size).toBe(FACE_GROUPS.length);
});

test("each preset is a whole, distinct face that is not all extremes", () => {
  const seen = new Set<string>();
  for (const p of FACE_PRESETS) {
    expect(p.values.length, p.label).toBe(FACE_COUNT);
    for (const v of p.values) expect(Math.abs(v), p.label).toBeLessThanOrEqual(1);
    expect(p.values.filter((v) => Math.abs(v) >= 0.9).length, p.label).toBe(0);
    expect(p.values.some((v) => v !== 0), p.label).toBe(true);
    const look = setFaces(defaultLook(), p.values);
    expect(validLook(look)).toBe(true);
    p.values.forEach((v, f) => expect(faceOf(look, f)).toBeCloseTo(v, 2));
    seen.add([...look.subarray(LOOK_FACE)].join());
  }
  expect(seen.size).toBe(FACE_PRESETS.length);
  expect(new Set(FACE_PRESETS.map((p) => p.label)).size).toBe(FACE_PRESETS.length);
});

test("a random face changes only face bytes and stays within its spread", () => {
  const rng = new Rng(5);
  const look = randomLook(new Rng(1));
  const rest = [...look.subarray(0, LOOK_FACE)];
  let most = 0;
  for (let i = 0; i < 200; i++) {
    const before = [...look.subarray(LOOK_FACE)];
    randomFace(rng, look);
    expect([...look.subarray(LOOK_FACE)]).not.toEqual(before);
    expect([...look.subarray(0, LOOK_FACE)]).toEqual(rest);
    expect(validLook(look)).toBe(true);
    for (let f = 0; f < FACE_COUNT; f++) most = Math.max(most, Math.abs(faceOf(look, f)));
  }
  expect(most).toBeLessThanOrEqual(FACE_SPREAD + 1 / 127);
  expect(most).toBeGreaterThan(FACE_SPREAD * 0.9);
  randomFace(rng, look, 0.1);
  for (let f = 0; f < FACE_COUNT; f++) expect(Math.abs(faceOf(look, f))).toBeLessThanOrEqual(0.1 + 1 / 127);
  resetFace(look);
  expect([...look.subarray(LOOK_FACE)].every((b) => b === 0)).toBe(true);
  expect([...look.subarray(0, LOOK_FACE)]).toEqual(rest);
});

test("the entry page's face buttons write only face bytes", () => {
  const look = defaultLook();
  look[LOOK_SKIN] = 7;
  const rest = [...look.subarray(0, LOOK_FACE)];
  const face = (): number[] => [...look.subarray(LOOK_FACE)];
  const rng = new Rng(4);
  const preset = [...setFaces(defaultLook(), FACE_PRESETS[2]!.values).subarray(LOOK_FACE)];
  expect(faceAction(look, "face-preset", 2, () => rng)).toBe(true);
  expect(face()).toEqual(preset);
  expect(faceAction(look, "face-random", 0, () => rng)).toBe(true);
  const thrown = face();
  expect(thrown).not.toEqual(preset);
  expect(faceAction(look, "face-preset", 99, () => rng)).toBe(true);
  expect(face()).toEqual(thrown);
  expect(faceAction(look, "face-reset", 0, () => rng)).toBe(true);
  expect(face().every((b) => b === 0)).toBe(true);
  expect(faceAction(look, "swatch", 0, () => rng)).toBe(false);
  expect([...look.subarray(0, LOOK_FACE)]).toEqual(rest);
});
