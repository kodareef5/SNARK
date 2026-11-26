// The hair and beard styles a look names by byte: new styles go on the end, so a look saved before them still names the
// style it was made with, and every look a client can make names a style the cook makes for both sexes.

import { expect, test } from "bun:test";
import { BEARD_STYLES, HAIR_STYLES, LOOK_BEARD, LOOK_HAIR, LOOK_V1_BYTES, SEX_IDS, upgradeLook, validLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { slotsOf } from "../../shared/content/slots.ts";
import { CORE_CONTENT } from "../../content/core.ts";

test("an old look's hair and beard bytes still name the styles they named", () => {
  expect(HAIR_STYLES.slice(0, 5).map((s) => s.id)).toEqual(["none", "buzzed", "parted", "long", "buns"]);
  expect(BEARD_STYLES.slice(0, 2).map((s) => s.id)).toEqual(["none", "full"]);
  for (let hair = 0; hair < 5; hair++) for (let beard = 0; beard < 2; beard++) {
    const old = new Uint8Array(LOOK_V1_BYTES);
    [old[LOOK_HAIR], old[LOOK_BEARD]] = [hair, beard];
    const look = upgradeLook(old);
    expect(validLook(look)).toBe(true);
    expect([HAIR_STYLES[look[LOOK_HAIR]!]!.drawn, BEARD_STYLES[look[LOOK_BEARD]!]!.drawn]).toEqual([hair > 0, beard > 0]);
  }
});

test("the new styles follow the old ones and every drawn style is a mesh slot", () => {
  expect(HAIR_STYLES.slice(5).map((s) => s.id)).toEqual(["fade", "coils", "tied"]);
  expect(BEARD_STYLES.slice(2).map((s) => s.id)).toEqual(["stubble", "short"]);
  const reg = compileContent(CORE_CONTENT).registry!;
  const keys = new Set(slotsOf(reg.defs.filter((d) => d !== null)).filter((u) => u.owner === "core:survivor").map((u) => `${u.slot} ${u.key}`));
  for (const sex of SEX_IDS) {
    for (const s of HAIR_STYLES) expect(keys.has(`hair ${sex}/${s.id}`)).toBe(s.drawn);
    for (const s of BEARD_STYLES) expect(keys.has(`beard ${sex}/${s.id}`)).toBe(s.drawn);
  }
});
