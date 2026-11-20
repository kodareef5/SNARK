// A basic loadout from whatever is to hand: what is missing of it, crafted in the order the tools make each next
// thing possible (a pick first: flint comes from rocks only with one), each one's materials gathered first. Items are
// asked for by role (a pick, a hatchet, a bow, arrows): each game names them its own way (grunt/know.ts ROLES), and the
// one the game can make is taken.

import type { Run } from "./body.ts";
import { holding, ROLES } from "./know.ts";
import { craft, gather, harvest, type SkillContext, type SkillResult } from "./skills.ts";

/** The loadout every character keeps: tools to gather with, a weapon to fight from range with, some food. */
export const KIT: { role: keyof typeof ROLES; count: number }[] = [
  { role: "pick", count: 1 },
  { role: "hatchet", count: 1 },
  { role: "bow", count: 1 },
  { role: "arrow", count: 20 },
];

/** What of the loadout is missing now, for the agenda and the brief. */
export function missing(b: SkillContext["belief"]): string[] {
  const has = (role: keyof typeof ROLES) => holding((i) => b.count(i), role);
  const out = KIT.filter((k) => has(k.role) < k.count).map((k) => (k.count > 1 ? `${k.count - has(k.role)} ${k.role}s` : `a ${k.role}`));
  if (has("food") < 10) out.push("some food");
  return out;
}

/** The game's own name for a role: the first of its names the game can make (or the character has). */
function itemFor(b: SkillContext["belief"], role: keyof typeof ROLES): string | null {
  return ROLES[role].find((i) => b.inventory?.craftable.some((r) => r.item === i) || b.count(i) > 0) ?? null;
}

export function* kit(ctx: SkillContext): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  const made = ((p.made ??= []) as string[]);
  const cannot: string[] = [];
  for (const k of KIT) {
    const want = k.count - holding((i) => b.count(i), k.role);
    if (want <= 0) continue;
    const item = itemFor(b, k.role);
    const r = item ? b.inventory?.craftable.find((x) => x.item === item) : undefined;
    if (!item || !r) {
      cannot.push(`no ${k.role} I know how to craft`);
      continue;
    }
    if (r.level) {
      cannot.push(`the ${item} is learned at level ${r.level}`);
      continue;
    }
    // Its materials, all of them, in one gather (what is in the bag counts).
    const items = Object.fromEntries(Object.entries(r.needs).map(([m, n]) => [m, n * want]));
    if (Object.entries(items).some(([m, n]) => b.count(m) < n)) {
      const g = yield* gather({ ...ctx, progress: {} }, { items });
      if (g.status !== "done") return { status: "blocked", summary: `making the ${item}: ${g.summary}${made.length ? `; made ${made.join(", ")}` : ""}`, data: { reason: "materials", bill: items } };
    }
    const c = yield* craft({ ...ctx, progress: {} }, { item, count: want });
    if (c.status !== "done") return { status: "blocked", summary: `crafting the ${item}: ${c.summary}`, data: { reason: "craft" } };
    // Seen in the bag before the next gather, so a new tool is taken in hand for it.
    yield { until: () => b.count(item) >= want, ms: 3000 };
    made.push(want > 1 ? `${want} ${item}` : item);
  }
  // Food: bushes picked, one after another, until the bag holds enough of any food (whatever the game calls it).
  for (let n = 0; n < 6 && holding((i) => b.count(i), "food") < 10; n++) {
    const bush = b.find((t) => t.type === "bush" && b.distance(t.pos) < 60)[0];
    if (!bush) break;
    yield* harvest({ ...ctx, progress: {} }, { kind: "bush", target: bush.id, only: true });
  }
  const still = missing(b);
  const why = cannot.length ? `; ${cannot.join("; ")}` : "";
  return still.length
    ? { status: "blocked", summary: `my loadout still lacks ${still.join(", ")}${made.length ? `; made ${made.join(", ")}` : ""}${why}`, data: { missing: still } }
    : { status: "done", summary: made.length ? `my loadout is complete: made ${made.join(", ")}` : "my loadout was already complete" };
}
