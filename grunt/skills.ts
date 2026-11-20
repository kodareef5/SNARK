// The skills: small autonomous machines a task runs. Each one is a generator over the body's steps; it asks policies
// the narrow questions (decision points) and returns how it ended. A skill can be stopped between any two steps and
// started again with the same progress (a resumed task restarts its skill), so each is written to pick up from what it
// finds: its progress, and the world as believed.

import type { Belief } from "./belief.ts";
import type { Body, Run } from "./body.ts";
import type { Outcome } from "./protocol.ts";

export interface SkillContext {
  belief: Belief;
  body: Body;
  /** The task's own record, kept when the task is suspended and resumed. */
  progress: Record<string, unknown>;
  decide(point: string, candidates: string[], state: Record<string, unknown>): Run<string>;
  /** A note for the Director while the task runs. */
  note(text: string, data?: Record<string, unknown>): void;
}

export interface SkillResult {
  status: "done" | "blocked" | "failed";
  summary: string;
  data?: Record<string, unknown>;
}

export interface Skill {
  name: string;
  describe: string;
  params: Record<string, string>;
  /** Whether it drives the body (move, look, hands). Two such tasks never run at once. */
  body: boolean;
  run(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult>;
}

const YIELD: Record<string, string> = { tree: "wood", rock: "stone", bush: "fiber" };
const TOOLS: Record<string, string[]> = { tree: ["stone_hatchet", "stone_pick"], rock: ["stone_pick", "stone_hatchet"], bush: [] };

function addGained(p: Record<string, unknown>, o: Outcome | undefined): number {
  const got = (o?.detail?.gained ?? {}) as Record<string, number>;
  const total = ((p.gained ??= {}) as Record<string, number>);
  let n = 0;
  for (const [k, v] of Object.entries(got)) (total[k] = (total[k] ?? 0) + v), (n += v);
  return n;
}

/** Takes an item in hand. Slots move when a stack runs out, so the outcome's item is checked, and a stale view of the
 * inventory is waited out before trying again. */
function* hold(ctx: SkillContext, item: string): Run<boolean> {
  const b = ctx.belief;
  if (b.self?.held?.item === item) return true;
  for (let i = 0; i < 3; i++) {
    const slot = b.slotOf(item);
    if (slot === null) return false;
    const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "select", slot }], `hold ${item}`), 2000);
    if (o?.status === "completed" && o.detail?.item === item) return true;
    const since = b.inventoryAt;
    yield { until: () => b.inventoryAt > since, ms: 1500 };
  }
  return false;
}

function* holdBest(ctx: SkillContext, tools: string[]): Run<string | null> {
  for (const tool of tools) if (ctx.belief.slotOf(tool) !== null && (yield* hold(ctx, tool))) return tool;
  return null;
}

function* lookAround(ctx: SkillContext): Run<SkillResult> {
  yield* ctx.body.scan();
  const kinds = new Map<string, number>();
  for (const t of ctx.belief.things.values()) kinds.set(t.type, (kinds.get(t.type) ?? 0) + 1);
  return { status: "done", summary: `I see ${[...kinds].map(([k, n]) => `${n} ${k}`).join(", ") || "nothing"}`, data: Object.fromEntries(kinds) };
}

function* walkTo(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief;
  const to = typeof args.to === "string" ? args.to : null;
  const reach = typeof args.reach === "number" ? args.reach : to ? 2.5 : 1.5;
  const point = to ? () => b.things.get(to)?.pos ?? null : () => [Number(args.x), 0, Number(args.z)] as [number, number, number];
  if (!point()) return { status: "failed", summary: `I don't know where ${to} is` };
  const r = yield* ctx.body.walkTo(point, reach, { ...(to ? { ignore: to } : {}), sprint: !!args.run });
  if (r === "arrived") return { status: "done", summary: to ? `I'm at ${b.things.get(to)?.name ?? to}` : `I'm at ${Number(args.x)}, ${Number(args.z)}` };
  return { status: "blocked", summary: r === "lost" ? `I lost sight of ${to}` : "something is in the way and I can't get round it" };
}

/** Gathers from trees, rocks or bushes near where it started, until none is left there or it has enough. */
function* harvest(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  const kind = String(args.kind ?? "tree");
  if (!(kind in YIELD)) return { status: "failed", summary: `I can't harvest ${kind}` };
  const radius = typeof args.radius === "number" ? args.radius : 25;
  const want = typeof args.count === "number" ? args.count : null;
  const item = YIELD[kind]!;
  const anchor = (p.anchor ??= b.pos) as [number, number, number];
  const unreachable = new Set((p.unreachable ??= []) as string[]);
  const have = () => ((p.gained as Record<string, number> | undefined)?.[item] ?? 0);
  const enough = () => want !== null && have() >= want;
  const summary = () => `gathered ${Object.entries((p.gained ?? {}) as Record<string, number>).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing"} from ${Number(p.targets ?? 0)} ${kind}s`;
  p.targets ??= 0;
  const tool = kind === "bush" ? null : yield* holdBest(ctx, TOOLS[kind]!);
  let scanned = false;
  while (true) {
    if (enough()) return { status: "done", summary: summary(), data: { gained: p.gained } };
    if (b.weightFraction() > 0.95) return { status: "blocked", summary: `too heavy to carry more; ${summary()}`, data: { gained: p.gained, reason: "weight" } };
    const near = b.find((r) => r.type === kind && !unreachable.has(r.id) && Math.hypot(r.pos[0] - anchor[0], r.pos[2] - anchor[2]) <= radius);
    if (!near.length) {
      if (!scanned) {
        scanned = true;
        yield* ctx.body.scan();
        continue;
      }
      const why = want !== null ? `no ${kind}s left near; ${summary()}, short of ${want} ${item}` : summary();
      return { status: want !== null ? "blocked" : "done", summary: why, data: { gained: p.gained, reason: "none_near" } };
    }
    const candidates = near.map((r) => {
      const danger = b.dangerNear(r.pos);
      return { id: r.id, distance: Math.round(b.distance(r.pos) * 10) / 10, danger_m: danger ? Math.round(danger.distance) : null };
    });
    const target = yield* ctx.decide("harvest.target", [...near.map((r) => r.id), "stop"], { kind, tool, candidates });
    if (target === "stop") {
      const d = b.dangerNear(near[0]!.pos)!;
      return { status: "blocked", summary: `every ${kind} left is near the ${d?.type ?? "danger"} I saw ${Math.round((d?.age ?? 0) / 1000)} s ago; ${summary()}`, data: { gained: p.gained, reason: "danger", danger: d } };
    }
    const arrival = yield* ctx.body.walkTo(() => b.things.get(target)?.pos ?? null, kind === "rock" ? 2.2 : 1.8, { ignore: target });
    if (arrival === "lost") continue;
    if (arrival === "blocked" || !(yield* ctx.body.face(target))) {
      unreachable.add(target);
      (p.unreachable as string[]).push(target);
      continue;
    }
    let misses = 0;
    while (b.things.has(target) && !enough()) {
      const action = kind === "bush"
        ? { control: "interact" as const, target, verb: "harvest", hold_ms: 2000 }
        : { control: "use" as const, hand: "primary" as const, hold_ms: 1800 };
      const [o] = yield* ctx.body.settle(ctx.body.act([action], `harvest ${target}`), 4000);
      const got = addGained(p, o);
      misses = got ? 0 : misses + 1;
      if (o?.status === "failed" && o.code === "out_of_reach" && !(yield* ctx.body.face(target))) break;
      const next = yield* ctx.decide("harvest.next", ["continue", "next_target", "stop"], {
        kind, target, target_gone: !b.things.has(target), yield_last: got, misses, weight: Math.round(b.weightFraction() * 100) / 100, gained: { ...((p.gained ?? {}) as object) },
      });
      if (next === "stop") return { status: "done", summary: `stopped: ${summary()}`, data: { gained: p.gained } };
      if (next === "next_target") break;
    }
    if (!b.things.has(target)) p.targets = Number(p.targets) + 1;
  }
}

/** Runs from a threat until it is far, or out of sight long enough. */
function* flee(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief;
  const from = typeof args.from === "string" ? args.from : null;
  const heardYaw = typeof args.yaw === "number" ? args.yaw : null;
  const start = b.now;
  let safeSince = -1;
  while (b.now - start < 30000) {
    const t = from ? b.things.get(from) : undefined;
    const d = t ? b.distance(t.pos) : Infinity;
    const safe = !t ? b.now - start > 4000 : d > 30 || (b.age(t.seen) > 4000 && d > 15);
    if (safe) {
      if (safeSince < 0) safeSince = b.now;
      if (b.now - safeSince > 2000) {
        ctx.body.stop("safe");
        return { status: "done", summary: t ? `got away; the ${t.type} is ${Math.round(d)} m off` : "nothing followed me" };
      }
    } else safeSince = -1;
    const away = t ? b.yawTo(t.pos) + Math.PI : heardYaw !== null ? heardYaw + Math.PI : (b.self?.yaw ?? 0);
    const yaw = Math.atan2(Math.sin(away), Math.cos(away));
    ctx.body.act([{ control: "look", yaw, pitch: 0 }, { control: "move", forward: 1, strafe: 0, sprint: true, duration_ms: 500 }], "flee");
    yield { ms: 200 };
  }
  ctx.body.stop("flee timed out");
  return { status: "blocked", summary: "I couldn't shake it off" };
}

/** Fights a creature with the best weapon to hand: closes in, faces it, swings until it is dead or gone. */
function* fight(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, target = String(args.target ?? "");
  const weapon = yield* holdBest(ctx, ["stone_pick", "stone_hatchet"]);
  const start = b.now;
  let swings = 0;
  while (b.now - start < 30000) {
    const t = b.things.get(target);
    if (!t) return { status: "done", summary: `the fight is over after ${swings} swings${weapon ? ` with the ${weapon}` : ""}`, data: { swings } };
    if (b.vital("health") < 0.15) return { status: "blocked", summary: "I'm nearly dead", data: { swings } };
    if (b.distance(t.pos) > 1.8) {
      ctx.body.act([{ control: "look", yaw: b.yawTo(t.pos), pitch: 0 }, { control: "move", forward: 1, strafe: 0, sprint: true, duration_ms: 300 }], "close in");
      yield { ms: 100 };
      continue;
    }
    ctx.body.act([{ control: "look", yaw: b.yawTo(t.pos), pitch: 0 }, { control: "use", hand: "primary", hold_ms: 600 }], `strike ${target}`);
    swings++;
    yield { ms: 600 };
  }
  return { status: "blocked", summary: "it won't die", data: { swings } };
}

// --- Building ---------------------------------------------------------------------------------------------------

interface Spot {
  key: string;
  piece: string;
  /** Where the piece stands, from the first foundation's centre: x east, z south, in cells of 3 m (halves for edges). */
  at: [number, number];
  /** Which way is out of the house from it, to stand there and look in. */
  out: [number, number];
}

/** A blueprint: pieces in an order that keeps each one supported. */
const BLUEPRINTS: Record<string, Spot[]> = {
  hut_2x2: (() => {
    const spots: Spot[] = [];
    const cells: [number, number, [number, number]][] = [[0, 0, [-1, -1]], [1, 0, [1, -1]], [0, 1, [-1, 1]], [1, 1, [1, 1]]];
    for (const [cx, cz, out] of cells) spots.push({ key: `f${cx}${cz}`, piece: "wood_foundation", at: [cx, cz], out });
    const edges: [string, [number, number], [number, number]][] = [
      ["n0", [0, -0.5], [0, -1]], ["n1", [1, -0.5], [0, -1]], ["e0", [1.5, 0], [1, 0]], ["e1", [1.5, 1], [1, 0]],
      ["s1", [1, 1.5], [0, 1]], ["s0", [0, 1.5], [0, 1]], ["w1", [-0.5, 1], [-1, 0]], ["w0", [-0.5, 0], [-1, 0]],
    ];
    for (const [key, at, out] of edges) spots.push({ key, piece: key === "s0" ? "wood_doorframe" : "wood_wall", at, out });
    spots.push({ key: "door", piece: "wood_door", at: [0, 1.5], out: [0, 1] });
    for (const [cx, cz, out] of cells) spots.push({ key: `c${cx}${cz}`, piece: "wood_ceiling", at: [cx, cz], out });
    return spots;
  })(),
};

type P2 = [number, number];

/** Whether a segment passes through a rectangle (x0, z0, x1, z1): Liang–Barsky clipping. */
function crosses(a: P2, b: P2, r: [number, number, number, number]): boolean {
  let t0 = 0, t1 = 1;
  const d = [b[0] - a[0], b[1] - a[1]];
  const edges: [number, number][] = [[-d[0]!, a[0] - r[0]], [d[0]!, r[2] - a[0]], [-d[1]!, a[1] - r[1]], [d[1]!, r[3] - a[1]]];
  for (const [pp, q] of edges) {
    if (pp === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / pp;
    if (pp < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return t1 - t0 > 1e-6;
}

/** Ways round a rectangle: through one corner, or two neighbouring ones, the shortest that never cuts through it. */
function around(from: P2, to: P2, r: [number, number, number, number], margin: number): P2[] {
  if (!crosses(from, to, r)) return [];
  const c: P2[] = [[r[0] - margin, r[1] - margin], [r[2] + margin, r[1] - margin], [r[2] + margin, r[3] + margin], [r[0] - margin, r[3] + margin]];
  const len = (pts: P2[]) => pts.slice(1).reduce((n, q, i) => n + Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]), 0);
  const ok = (pts: P2[]) => pts.slice(1).every((q, i) => !crosses(pts[i]!, q, r));
  let best: P2[] | null = null;
  for (let i = 0; i < 4; i++) {
    for (const way of [[c[i]!], [c[i]!, c[(i + 1) % 4]!], [c[i]!, c[(i + 3) % 4]!]]) {
      const pts = [from, ...way, to];
      if (ok(pts) && (!best || len(pts) < len([from, ...best, to]))) best = way;
    }
  }
  return best ?? [];
}

function* build(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  const name = String(args.blueprint ?? "hut_2x2");
  const plan = BLUEPRINTS[name];
  if (!plan) return { status: "failed", summary: `I don't know the blueprint ${name}: ${Object.keys(BLUEPRINTS).join(", ")}` };
  const placed = ((p.placed ??= {}) as Record<string, string>);
  const left = () => plan.filter((s) => !placed[s.key] || !b.things.has(placed[s.key]!));
  // What is needed that is not in hand: craft it from materials, or say what is short.
  const needs: Record<string, number> = {};
  for (const s of left()) needs[s.piece] = (needs[s.piece] ?? 0) + 1;
  for (const [piece, n] of Object.entries(needs)) {
    const missing = n - b.count(piece);
    if (missing <= 0) continue;
    const recipe = b.inventory?.craftable.find((r) => r.item === piece);
    if (!recipe || recipe.can < missing) {
      const short = recipe ? Object.entries(recipe.needs).map(([i, k]) => `${k * missing - b.count(i) > 0 ? `${k * missing - b.count(i)} more ${i}` : ""}`).filter(Boolean).join(", ") : "a recipe";
      return { status: "blocked", summary: `I need ${missing} more ${piece} and can make ${recipe?.can ?? 0}: short of ${short}`, data: { needs, missing: { [piece]: missing } } };
    }
    const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "craft", item: piece, count: missing }], `craft ${missing} ${piece}`), recipe.seconds * missing * 1000 + 3000);
    if (o?.status !== "completed") return { status: "failed", summary: `crafting ${piece} ${o?.status ?? "never finished"}${o?.code ? `: ${o.code}` : ""}` };
    yield { until: () => b.count(piece) >= n, ms: 2000 };
  }
  let origin = p.origin as [number, number] | undefined;
  for (const spot of left()) {
    if (!(yield* hold(ctx, spot.piece))) return { status: "blocked", summary: `I have no ${spot.piece} left`, data: { placed } };
    let want: [number, number, number] | null = null;
    if (origin) {
      want = [origin[0] + spot.at[0] * 3, 0, origin[1] + spot.at[1] * 3];
      const stand: [number, number, number] = [want[0] + spot.out[0] * 3 / Math.hypot(...spot.out), 0, want[2] + spot.out[1] * 3 / Math.hypot(...spot.out)];
      // Round the outside of the house, never through it: its walls are in the way once they stand.
      const foot: [number, number, number, number] = [origin[0] - 1.6, origin[1] - 1.6, origin[0] + 4.6, origin[1] + 4.6];
      const here = b.pos;
      let r: string = "arrived";
      for (const w of [...around([here[0], here[2]], [stand[0], stand[2]], foot, 1.4), [stand[0], stand[2]] as P2]) {
        const last = w[0] === stand[0] && w[1] === stand[2];
        r = yield* ctx.body.walkTo(() => [w[0], 0, w[1]], last ? 0.5 : 1.0);
        if (r !== "arrived") break;
      }
      if (r !== "arrived") return { status: "blocked", summary: `I can't get to where the ${spot.piece} goes`, data: { placed } };
      yield* ctx.body.turnTo(b.yawTo(want));
    }
    // Read the preview the game shows, and place only where the blueprint wants the piece.
    const after = b.now;
    yield { until: () => b.focusAt > after && b.focus.placement?.piece === spot.piece, ms: 1500 };
    const pv = b.focus.placement;
    const off = pv && want ? Math.hypot(pv.pos[0] - want[0], pv.pos[2] - want[2]) : 0;
    const choice = yield* ctx.decide("build.spot", ["place", "skip"], { piece: spot.piece, spot: spot.key, valid: pv?.valid ?? false, reason: pv?.reason ?? "no preview", off_m: Math.round(off * 100) / 100, snapped: pv?.snapped ?? null });
    if (choice !== "place" || !pv?.valid || off > 0.5 || pv.piece !== spot.piece) {
      return { status: "blocked", summary: `the ${spot.piece} won't go at ${spot.key}: ${pv ? (pv.valid ? `the preview is ${off.toFixed(1)} m off` : pv.reason) : "no preview"}`, data: { placed, preview: pv } };
    }
    const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "use", hand: "primary" }], `place ${spot.piece} ${spot.key}`), 3000);
    const id = o?.detail?.placed;
    if (typeof id !== "string") return { status: "failed", summary: `placing the ${spot.piece} failed: ${o?.code ?? o?.status}`, data: { placed } };
    placed[spot.key] = id;
    if (!origin) origin = p.origin = [pv.pos[0], pv.pos[2]] as [number, number];
    yield { until: () => b.things.has(id), ms: 1500 };
  }
  ctx.body.stop("built");
  return { status: "done", summary: `built the ${name}: ${Object.keys(placed).length} pieces`, data: { placed, origin } };
}

function* craft(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const item = String(args.item ?? ""), count = Math.max(1, Number(args.count ?? 1));
  const recipe = ctx.belief.inventory?.craftable.find((r) => r.item === item);
  if (!recipe) return { status: "failed", summary: `I don't know how to make ${item}` };
  if (recipe.can < count) return { status: "blocked", summary: `I can make ${recipe.can} ${item}, not ${count}: it needs ${Object.entries(recipe.needs).map(([k, v]) => `${v} ${k}`).join(", ")} each`, data: { can: recipe.can, needs: recipe.needs } };
  const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "craft", item, count }], `craft ${count} ${item}`), recipe.seconds * count * 1000 + 3000);
  if (o?.status === "completed") return { status: "done", summary: `made ${count} ${item}` };
  return { status: "failed", summary: `crafting ${item} ${o?.status ?? "never finished"}${o?.code ? `: ${o.code}` : ""}` };
}

function* say(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const text = String(args.text ?? "");
  const channel = (["local", "global", "group"].includes(String(args.channel)) ? args.channel : "local") as "local" | "global" | "group";
  yield* ctx.body.settle(ctx.body.act([{ control: "chat", channel, text }], "say"), 2000);
  return { status: "done", summary: `said "${text}"` };
}

export const SKILLS: Record<string, Skill> = {
  look_around: { name: "look_around", describe: "Turn the whole way round, so that everything about is seen.", params: {}, body: true, run: lookAround },
  walk_to: {
    name: "walk_to", describe: "Walk to a place (x, z) or to a thing or person by id, steering round what is in the way.",
    params: { x: "number", z: "number", to: "entity id, in place of x and z", reach: "metres (default 1.5, or 2.5 to a thing)", run: "boolean: sprint" },
    body: true, run: walkTo,
  },
  harvest: {
    name: "harvest", describe: "Gather from trees, rocks or bushes near where it starts (best tool in hand), until none is left near, or until `count` of the main yield.",
    params: { kind: "tree | rock | bush", count: "number (optional): stop at this much wood, stone or fiber", radius: "metres around the start (default 25)" },
    body: true, run: harvest,
  },
  flee: { name: "flee", describe: "Run from a threat until it is far or lost.", params: { from: "entity id", yaw: "the world yaw it was heard from" }, body: true, run: flee },
  fight: { name: "fight", describe: "Fight a creature with the best weapon to hand until it is dead or gone.", params: { target: "entity id" }, body: true, run: fight },
  build: {
    name: "build", describe: "Build a blueprint where the character stands, the first foundation where its placement preview is: it crafts missing pieces from materials, then places each in order.",
    params: { blueprint: "hut_2x2" }, body: true, run: build,
  },
  craft: { name: "craft", describe: "Craft items from the inventory, by the recipes the inventory screen shows.", params: { item: "item name", count: "number" }, body: false, run: craft },
  say: { name: "say", describe: "Say a line in chat.", params: { text: "string", channel: "local | global | group" }, body: false, run: say },
};
