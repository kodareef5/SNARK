// Content numbers as the ARK wiki (ark.wiki.gg) gave them on 2026-11-14. Each test names the page it was read from.

import { expect, test } from "bun:test";
import { TICK_RATE } from "../../shared/coords.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const at = (name: string): number => reg.index.get(`core:${name}`)!;
const keeps = (name: string): number => reg.spoilTicks[at(name)]! / TICK_RATE;

test("raw meat stacks to 40 and a piece keeps ten minutes; cooked meat keeps twenty (Raw Meat, Cooked Meat, Spoilage)", () => {
  expect([reg.stack[at("meat")], keeps("meat"), keeps("meat_cooked")]).toEqual([40, 600, 1200]);
});
