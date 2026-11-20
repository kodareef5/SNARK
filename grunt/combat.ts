// Fighting through the game's attack assist: grunt chooses whom to fight, with what, and when to stop; the assist
// works the hands (closing in, facing, striking at the weapon's pace; with a bow, keeping range, leading and loosing)
// no better than a good player's (grunt/protocol.md, "Assists"). Games without the assist get the old way: aim and
// swing from here, a step aside when something else is under the crosshair.

import type { Run } from "./body.ts";
import { CREATURES, MELEE } from "./know.ts";
import type { Outcome } from "./protocol.ts";
import { hold, holdBest, type SkillContext, type SkillResult } from "./skills.ts";

/** What the character can fight with now: a bow with arrows, a melee weapon, both or neither. */
export function arms(b: SkillContext["belief"]): { bow: boolean; melee: string | null } {
  return { bow: b.count("bow") > 0 && b.count("arrow") > 0, melee: MELEE.find((w) => b.count(w) > 0) ?? null };
}

export function* fight(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  if (!b.assists?.kinds.includes("attack")) return yield* byHand(ctx, args);
  const all = args.all === true;
  const retreat = typeof args.retreat === "number" ? args.retreat : 0.3;
  p.health0 ??= b.vital("health");
  const lost = () => Math.round((Number(p.health0) - b.vital("health")) * 100);
  const kills = ((p.kills ??= []) as string[]);
  let target = typeof args.target === "string" && !kills.includes(args.target) ? args.target : (p.target as string | undefined) ?? null;
  p.foe ??= (target && b.things.get(target)?.type) ?? "creature";
  let obstructed = 0;
  const tally = ((p.tally ??= { swings: 0, shots: 0, hits: 0 }) as { swings: number; shots: number; hits: number });
  const result = (status: SkillResult["status"], summary: string, won: boolean): SkillResult => ({
    status,
    summary: `${summary}; ${kills.length ? `${kills.length} killed, ` : ""}${tally.hits} hits from ${tally.swings} swings and ${tally.shots} arrows; I lost ${lost()} health`,
    data: { foe: p.foe, won, kills: kills.length, swings: tally.swings, shots: tally.shots, weapon: p.weapon ?? null, health_lost: lost(), ...(won ? {} : { reason: status === "blocked" ? "fight" : undefined }) },
  });
  while (true) {
    // Whom: the one asked for; after it (or with `all`), the next hostile creature about, by the rules (hunting and
    // nearest first), until none is left.
    if (!target || !b.things.has(target)) {
      if (!all && (kills.length || p.started)) return result("done", target && !kills.includes(target) ? "it is gone" : "the fight is over", kills.length > 0);
      const foes = b.find((t) => t.kind === "creature" && t.disposition === "hostile" && b.distance(t.pos) < 60);
      if (!foes.length) return result("done", kills.length ? "none is left" : "nothing hostile is about", kills.length > 0);
      const candidates = foes.map((t) => ({ id: t.id, type: t.type, distance: Math.round(b.distance(t.pos)), health: t.health ?? 1, hunting: !!t.tags?.includes("hunting") }));
      target = yield* ctx.decide("fight.next", [...foes.map((t) => t.id), "stop"], { candidates, health: b.vital("health") });
      if (target === "stop") return result("done", "I broke off", kills.length > 0);
    }
    p.target = target;
    p.started = true;
    // With what: a bow from range while it has arrows, else the best melee weapon.
    const a = arms(b);
    const it = b.things.get(target);
    const weapon = yield* ctx.decide("fight.weapon", ["bow", "melee"], { bow: a.bow, melee: a.melee, distance: it ? b.distance(it.pos) : null, type: it?.type ?? null });
    const ok = weapon === "bow" && a.bow ? (yield* hold(ctx, "bow")) && "bow" : yield* holdBest(ctx, [...MELEE]);
    p.weapon = ok || "hands";
    const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "assist", kind: "attack", target, ...(p.weapon === "bow" ? { range: [8, 35] as [number, number] } : {}), until: { health_below: retreat } }], `attack ${target}`), 180_000);
    const d = (o?.detail ?? {}) as { result?: string; swings?: number; shots?: number; hits?: number; by?: string | null };
    tally.swings += Number(d.swings ?? 0);
    tally.shots += Number(d.shots ?? 0);
    tally.hits += Number(d.hits ?? 0);
    switch (d.result) {
      case "killed":
        kills.push(target);
        target = null;
        continue;
      case "gone":
        target = null;
        continue;
      case "health":
        return result("blocked", `I'm hurt (${Math.round(b.vital("health") * 100)}% health) and broke off`, false);
      case "lost":
        if (all) {
          target = null;
          continue;
        }
        return result("blocked", "it got out of sight", false);
      case "ammo":
        continue;
      case "obstructed": {
        // Something in the way of the blow: a step aside, as a player would, and again.
        if (++obstructed > 4) return result("blocked", `something keeps getting in the way (${d.by ?? "?"})`, false);
        p.side = -Number(p.side ?? 1);
        yield* ctx.body.settle(ctx.body.act([{ control: "move", forward: 0, strafe: Number(p.side), duration_ms: 600 }], "clear the line"), 1500);
        continue;
      }
      default:
        return result("blocked", `the attack stopped: ${outcomeSaid(o)}`, false);
    }
  }
}

const outcomeSaid = (o: Outcome | undefined) => (o ? `${o.status}${o.code ? ` (${o.code})` : ""}${o.by ? ` by ${o.by}` : ""}` : "no answer");

/** Without the assist: aim and swing from here, closing in, a step aside when something else is under the crosshair. */
function* byHand(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress, target = String(args.target ?? "");
  const weapon = yield* holdBest(ctx, [...MELEE]);
  const start = b.now;
  p.health0 ??= b.vital("health");
  p.foe ??= b.things.get(target)?.type ?? "creature";
  let swings = Number(p.swings ?? 0);
  const lost = () => Math.round((Number(p.health0) - b.vital("health")) * 100);
  while (b.now - start < 30000) {
    const t = b.things.get(target);
    if (!t) return { status: "done", summary: `the fight is over after ${swings} swings${weapon ? ` with the ${weapon}` : ""}; I lost ${lost()} health`, data: { swings, won: true, foe: p.foe, weapon, health_lost: lost() } };
    if (b.vital("health") < 0.15) return { status: "blocked", summary: "I'm nearly dead", data: { swings, won: false, foe: p.foe, weapon, health_lost: lost() } };
    if (b.distance(t.pos) > 1.8) {
      ctx.body.act([{ control: "look", yaw: b.yawTo(t.pos), pitch: 0 }, { control: "move", forward: 1, strafe: 0, sprint: true, duration_ms: 300 }], "close in");
      yield { ms: 100 };
      continue;
    }
    const other = b.focus.target && b.focus.target !== target && b.focusAt > b.now - 300;
    if (other) {
      p.side = -Number(p.side ?? 1);
      ctx.body.act([{ control: "look", yaw: b.yawTo(t.pos), pitch: 0 }, { control: "move", forward: 0, strafe: Number(p.side), duration_ms: 400 }], "clear the line");
      yield { ms: 400 };
      continue;
    }
    ctx.body.act([{ control: "look", yaw: b.yawTo(t.pos), pitch: 0 }, { control: "use", hand: "primary", hold_ms: 600 }], `strike ${target}`);
    swings++;
    p.swings = swings;
    yield { ms: 600 };
  }
  return { status: "blocked", summary: "it won't die", data: { swings, won: false, foe: p.foe, weapon, health_lost: lost() } };
}

/** How a fight with a creature of this kind looks, with what the character has: for game_look and the reflexes. */
export function lore(type: string, a: { bow: boolean; melee: string | null }, many: number): string | null {
  const l = CREATURES[type];
  if (!l) return null;
  const one = a.bow ? l.ranged : a.melee ? l.armed : l.unarmed;
  if (many < 2) return one;
  return a.bow ? `${many} together: ${l.pack_ranged}` : a.melee ? `${many} together: ${l.pack_armed}` : `${many} together: a losing fight`;
}
