// A basic loadout from whatever is to hand: what is missing of it, crafted in the order the tools make each next
// thing possible (a pick first: flint comes from rocks only with one), each one's materials gathered first.

import type { Run } from "./body.ts";
import { craft, gather, type SkillContext, type SkillResult } from "./skills.ts";

/** The loadout every character keeps: tools to gather with, a weapon to fight from range with, some food. */
export const KIT: { item: string; count: number }[] = [
  { item: "stone_pick", count: 1 },
  { item: "stone_hatchet", count: 1 },
  { item: "bow", count: 1 },
  { item: "arrow", count: 20 },
];
const FOOD = ["berries", "meat"];

/** What of the loadout is missing now, for the agenda and the brief. */
export function missing(b: SkillContext["belief"]): string[] {
  const out = KIT.filter((k) => b.count(k.item) < k.count).map((k) => (k.count > 1 ? `${k.count - b.count(k.item)} ${k.item}` : k.item));
  if (FOOD.reduce((n, f) => n + b.count(f), 0) < 10) out.push("some food");
  return out;
}

export function* kit(ctx: SkillContext): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  const made = ((p.made ??= []) as string[]);
  for (const k of KIT) {
    const want = k.count - b.count(k.item);
    if (want <= 0) continue;
    const r = b.inventory?.craftable.find((x) => x.item === k.item);
    if (!r) {
      ctx.note(`I don't know how to make ${k.item}; leaving it`);
      continue;
    }
    // Its materials, all of them, in one gather (what is in the bag counts).
    const items = Object.fromEntries(Object.entries(r.needs).map(([m, n]) => [m, n * want]));
    if (Object.entries(items).some(([m, n]) => b.count(m) < n)) {
      const g = yield* gather({ ...ctx, progress: {} }, { items });
      if (g.status !== "done") return { status: "blocked", summary: `making the ${k.item}: ${g.summary}${made.length ? `; made ${made.join(", ")}` : ""}`, data: { reason: "materials", bill: items } };
    }
    const c = yield* craft({ ...ctx, progress: {} }, { item: k.item, count: want });
    if (c.status !== "done") return { status: "blocked", summary: `crafting the ${k.item}: ${c.summary}`, data: { reason: "craft" } };
    // Seen in the bag before the next gather, so a new tool is taken in hand for it.
    yield { until: () => b.count(k.item) >= k.count, ms: 3000 };
    made.push(want > 1 ? `${want} ${k.item}` : k.item);
  }
  // Food: berries from bushes about, if short.
  const food = FOOD.reduce((n, f) => n + b.count(f), 0);
  if (food < 10 && b.find((t) => t.type === "bush").length) {
    yield* gather({ ...ctx, progress: {} }, { items: { berries: b.count("berries") + (10 - food) } });
  }
  const still = missing(b);
  return still.length
    ? { status: "blocked", summary: `my loadout still lacks ${still.join(", ")}${made.length ? `; made ${made.join(", ")}` : ""}`, data: { missing: still } }
    : { status: "done", summary: made.length ? `my loadout is complete: made ${made.join(", ")}` : "my loadout was already complete" };
}
