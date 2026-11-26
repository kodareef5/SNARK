// The hair and beard styles a look names by byte, in order, and every look a client can make names a style the cook makes
// for both sexes.

import { expect, test } from "bun:test";
import { BEARD_STYLES, HAIR_STYLES, SEX_IDS } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { slotsOf } from "../../shared/content/slots.ts";
import { CORE_CONTENT } from "../../content/core.ts";

test("the styles keep their order and every drawn style is a mesh slot", () => {
  expect(HAIR_STYLES.slice(5).map((s) => s.id)).toEqual(["fade", "coils", "tied"]);
  expect(BEARD_STYLES.slice(2).map((s) => s.id)).toEqual(["stubble", "short"]);
  const reg = compileContent(CORE_CONTENT).registry!;
  const keys = new Set(slotsOf(reg.defs.filter((d) => d !== null)).filter((u) => u.owner === "core:survivor").map((u) => `${u.slot} ${u.key}`));
  for (const sex of SEX_IDS) {
    for (const s of HAIR_STYLES) expect(keys.has(`hair ${sex}/${s.id}`)).toBe(s.drawn);
    for (const s of BEARD_STYLES) expect(keys.has(`beard ${sex}/${s.id}`)).toBe(s.drawn);
  }
});
