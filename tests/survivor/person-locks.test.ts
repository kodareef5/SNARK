// A named person's locks: a part drawn from a seed of its own stays when the person's seed is drawn again, and the
// rest change; no locks draws as before.

import { expect, test } from "bun:test";
import { CITY } from "../../content/people/defaults.ts";
import { FACE_COUNT, LOOK_BYTES, LOOK_FACE, LOOK_HAIR, LOOK_REGIONS, LOOK_SKIN, REGION_COUNT } from "../../shared/anim/look.ts";
import { personFrom } from "../../shared/people/person.ts";

const face = (look: Uint8Array) => [...look.subarray(LOOK_FACE, LOOK_FACE + FACE_COUNT)];
const regions = (look: Uint8Array) => [...look.subarray(LOOK_REGIONS, LOOK_REGIONS + REGION_COUNT)];

test("no locks and empty locks draw the same person as before", () => {
  for (const seed of [1, 99, 0xfeedface]) {
    const plain = personFrom(seed, CITY).look;
    expect([...personFrom(seed, CITY, new Uint8Array(LOOK_BYTES), {}).look]).toEqual([...plain]);
    expect([...personFrom(seed, CITY, new Uint8Array(LOOK_BYTES), null).look]).toEqual([...plain]);
  }
});

test("a locked face stays as the seed is drawn again, and the body changes", () => {
  const kept = personFrom(5, CITY).look;
  let changed = 0;
  for (let seed = 100; seed < 140; seed++) {
    const other = personFrom(seed, CITY, new Uint8Array(LOOK_BYTES), { face: 5, sex: 5 }).look;
    expect(face(other)).toEqual(face(kept));
    if (regions(other).join() !== regions(kept).join()) changed++;
  }
  expect(changed).toBe(40);
});

test("a part given a seed of its own is drawn again alone", () => {
  const was = personFrom(11, CITY).look;
  let hair = 0;
  for (let s = 0; s < 40; s++) {
    const now = personFrom(11, CITY, new Uint8Array(LOOK_BYTES), { hair: s }).look;
    expect([face(now), regions(now), now[LOOK_SKIN]]).toEqual([face(was), regions(was), was[LOOK_SKIN]]);
    if (now[LOOK_HAIR] !== was[LOOK_HAIR]) hair++;
  }
  expect(hair).toBeGreaterThan(10);
});
