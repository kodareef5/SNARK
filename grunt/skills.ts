// The skills: small autonomous machines a task runs. Each one is a generator over the body's steps; it asks policies
// the narrow questions (decision points) and returns how it ended. A skill can be stopped between any two steps and
// started again with the same progress (a resumed task restarts its skill), so each is written to pick up from what it
// finds: its progress, and the world as believed.

import { type Belief, compass } from "./belief.ts";
import { type Costs, type Danger, type Route, WALK } from "./nav.ts";
import type { Body, Run } from "./body.ts";
import type { Outcome, Vec3 } from "./protocol.ts";

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

/** Remembered dangers as costs on the ground near them: a way that keeps clear of them is worth some extra metres. */
export function dangerCosts(b: Belief): Danger[] {
  // 35 m: wider than a hunter notices a body (about 20 m for a raptor), so a way round is not a way into it.
  return [...b.dangers.values()].filter((d) => b.now - d.t < 120000).map((d) => ({ pos: d.pos, radius: 35, cost: 40 }));
}

/** Metres of a route by kind, as words: "180 m: 140 ground, 40 bridge". */
function describeRoute(r: Route): string {
  const parts = Object.entries(r.metres).sort((a, b) => b[1] - a[1]).map(([k, m]) => `${m} ${k}`);
  return `${r.length} m (${parts.join(", ")})`;
}

function destination(b: Belief, args: Record<string, unknown>): { point: () => Vec3 | null; to: string | null; label: string } {
  const to = typeof args.to === "string" ? args.to : null;
  const point = to ? () => b.things.get(to)?.pos ?? null : () => [Number(args.x), 0, Number(args.z)] as Vec3;
  return { point, to, label: to ? (b.things.get(to)?.name ?? to) : `${Number(args.x)}, ${Number(args.z)}` };
}

/** An errand: somewhere it knows, by the best way it knows. */
function* walkTo(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief;
  const { point, to, label } = destination(b, args);
  const reach = typeof args.reach === "number" ? args.reach : to ? 2.5 : 1.5;
  if (!point()) return { status: "failed", summary: `I don't know where ${to} is` };
  const r = yield* ctx.body.goTo(point, reach, { ...(to ? { ignore: to } : {}), sprint: !!args.run, dangers: () => dangerCosts(b) });
  if (r === "arrived") return { status: "done", summary: `I'm at ${label}` };
  return { status: "blocked", summary: r === "lost" ? `I lost sight of ${to}` : r === "unreachable" ? `I know no way to ${label}` : "something is in the way and I can't get round it", data: { reason: r } };
}

/** A trek: a long way, over the map, in legs, keeping clear of known danger, and saying how the way goes. */
function* travel(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  const { point, to, label } = destination(b, args);
  if (!point()) return { status: "failed", summary: `I don't know where ${to} is` };
  const start = b.pos, t0 = b.now;
  let told = Infinity, detours = Number(p.detours ?? 0);
  const r = yield* ctx.body.goTo(point, typeof args.reach === "number" ? args.reach : 3, {
    ...(to ? { ignore: to } : {}), sprint: !!args.run, dangers: () => dangerCosts(b),
    onRoute: (route, replans, why) => {
      const said: Record<string, string> = {
        bumped: "something the map does not show is in the way", "blocked ahead": "the way ahead turned out blocked",
        "worse ground ahead": "the ground ahead is not what the map shows (water where a bridge was, or worse)",
        "danger ahead": "I saw danger near the way", "target moved": `${label} moved`,
      };
      if (replans === 0 && !p.route) ctx.note(`on my way to ${label}: ${describeRoute(route)}`);
      else if (replans > 0) (p.detours = ++detours), ctx.note(`${said[why ?? "bumped"]}; new way: ${describeRoute(route)} from here`);
      p.route = describeRoute(route);
    },
    onLeg: (left) => {
      if (left < told * 0.66 && left > 30) {
        told = left;
        ctx.note(`${left} m to go to ${label}`);
      }
    },
  });
  const walked = Math.round(Math.hypot(b.pos[0] - start[0], b.pos[2] - start[2]));
  const time = Math.round((b.now - t0) / 1000);
  if (r === "arrived") return { status: "done", summary: `I'm at ${label}, after ${time} s${detours ? ` and ${detours} detour${detours > 1 ? "s" : ""}` : ""}`, data: { seconds: time, detours } };
  if (r === "unreachable") return { status: "blocked", summary: `I know no way to ${label} from here (${walked} m from where I set out): explore toward it, or another way of travelling`, data: { reason: "unreachable" } };
  return { status: "blocked", summary: r === "lost" ? `I lost track of ${label}` : `I can't get through to ${label}`, data: { reason: r, detours } };
}

const DIRS: Record<string, [number, number]> = {
  north: [0, -1], "north-east": [0.71, -0.71], east: [1, 0], "south-east": [0.71, 0.71],
  south: [0, 1], "south-west": [-0.71, 0.71], west: [-1, 0], "north-west": [-0.71, -0.71],
};
const EXPLORE: Costs = { ...WALK, unknown: 1.05 };

/** Exploring: into ground it does not know, carefully: a leg at a time, a look round after each, and back to report
 * the moment anything hostile is seen. */
function* explore(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  const start = (p.start ??= b.pos) as Vec3;
  const dir = typeof args.toward === "string" ? DIRS[args.toward] : undefined;
  const far = typeof args.distance === "number" ? args.distance : 120;
  const goal: Vec3 | null = dir ? [start[0] + dir[0] * far, 0, start[2] + dir[1] * far]
    : typeof args.x === "number" && typeof args.z === "number" ? [args.x, 0, args.z] : null;
  if (!goal) return { status: "failed", summary: `explore takes toward (${Object.keys(DIRS).join(", ")}) or x and z` };
  // What was known before the exploring began, kept with the task, so a find is still a find after a pause.
  const known0 = new Set((p.known0 ??= [...b.things.keys()]) as string[]);
  const found = () => [...b.things.values()].filter((t) => !known0.has(t.id) && (t.kind === "creature" || t.kind === "player" || t.kind === "structure" || t.kind === "vehicle" || t.kind === "container"));
  const tell = (list: ReturnType<typeof found>) => list.map((t) => `${t.type}${t.name ? ` ${t.name}` : ""} ${t.id} ${Math.round(Math.hypot(t.pos[0] - start[0], t.pos[2] - start[2]))} m ${compass(Math.atan2(t.pos[0] - start[0], -(t.pos[2] - start[2])))} of where I set out${t.disposition === "hostile" ? " (hostile)" : ""}`).join("; ");
  for (let leg = 0; leg < 40; leg++) {
    const hostile = found().filter((t) => t.disposition === "hostile");
    if (hostile.length) return { status: "blocked", summary: `stopped exploring: ${tell(hostile)}. Also found: ${tell(found().filter((t) => t.disposition !== "hostile")) || "nothing else"}`, data: { reason: "hostile", found: found().map((t) => t.id) } };
    if (b.distance(goal) < 6) break;
    const route = b.nav.route(b.pos, goal, EXPLORE, dangerCosts(b));
    if (!route) return { status: "blocked", summary: `no way on that I can see; found: ${tell(found()) || "nothing"}`, data: { reason: "unreachable", found: found().map((t) => t.id) } };
    // The next stretch of the route, about 25 m: then a look round before going further.
    let acc = 0, stop = route.points.at(-1)!, prev = b.pos;
    for (const pt of route.points) {
      acc += Math.hypot(pt[0] - prev[0], pt[2] - prev[2]);
      prev = pt;
      if (acc >= 25) {
        stop = pt;
        break;
      }
    }
    const r = yield* ctx.body.goTo(() => stop, 2, { costs: EXPLORE, dangers: () => dangerCosts(b), until: () => found().some((t) => t.disposition === "hostile") });
    if (r === "unreachable") continue;
    if (r === "stopped") continue;
    yield* ctx.body.scan();
  }
  return { status: "done", summary: `explored ${Math.round(Math.hypot(b.pos[0] - start[0], b.pos[2] - start[2]))} m ${dir ? `${args.toward}` : "toward the point"}; found: ${tell(found()) || "nothing of note"}`, data: { found: found().map((t) => t.id) } };
}

/** Gathers from trees, rocks or bushes near where it started, until none is left there or it has enough. */
function* harvest(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  const kind = String(args.kind ?? "tree");
  if (!(kind in YIELD)) return { status: "failed", summary: `I can't harvest ${kind}` };
  const radius = typeof args.radius === "number" ? args.radius : 25;
  const want = typeof args.count === "number" ? args.count : null;
  // `until`: inventory counts to reach (gather's way of asking), where `count` is what this task gains of the yield.
  const until = args.until && typeof args.until === "object" ? (args.until as Record<string, number>) : null;
  const item = YIELD[kind]!;
  // Where it works: the target asked for, else here, else (none of the kind near) the nearest one it knows of.
  if (!p.anchor) {
    const asked0 = typeof args.target === "string" ? b.things.get(args.target) : undefined;
    const known = b.find((r) => r.type === kind);
    p.anchor = asked0?.pos ?? (known.some((r) => b.distance(r.pos) <= radius) || !known.length ? b.pos : known[0]!.pos);
  }
  let anchor = p.anchor as [number, number, number];
  const unreachable = new Set((p.unreachable ??= []) as string[]);
  const have = () => ((p.gained as Record<string, number> | undefined)?.[item] ?? 0);
  const enough = () => (want !== null && have() >= want) || (!!until && Object.entries(until).every(([i, n]) => b.count(i) >= n));
  let moves = 0;
  const summary = () => `gathered ${Object.entries((p.gained ?? {}) as Record<string, number>).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing"} from ${Number(p.targets ?? 0)} ${kind}s`;
  p.targets ??= 0;
  const tool = kind === "bush" ? null : yield* holdBest(ctx, TOOLS[kind]!);
  const first = typeof args.target === "string" && !p.first_done ? args.target : null;
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
      // None left here but some known elsewhere, and more wanted: move on to the nearest patch.
      const other = b.find((r) => r.type === kind && !unreachable.has(r.id) && b.distance(r.pos) < 150)[0];
      if (other && (want !== null || until) && moves < 3) {
        moves++;
        anchor = p.anchor = other.pos;
        scanned = false;
        continue;
      }
      const shortOf = until ? Object.entries(until).filter(([i, n]) => b.count(i) < n).map(([i, n]) => `${n - b.count(i)} ${i}`).join(", ") : want !== null ? `${want - have()} ${item}` : "";
      const why = shortOf ? `no ${kind}s left that I know of; ${summary()}, short of ${shortOf}` : summary();
      return { status: shortOf ? "blocked" : "done", summary: why, data: { gained: p.gained, reason: "none_near" } };
    }
    const candidates = near.map((r) => {
      const danger = b.dangerNear(r.pos);
      return { id: r.id, distance: Math.round(b.distance(r.pos) * 10) / 10, danger_m: danger ? Math.round(danger.distance) : null };
    });
    const asked = first && near.some((r) => r.id === first) ? first : null;
    p.first_done = true;
    const target = asked ?? (yield* ctx.decide("harvest.target", [...near.map((r) => r.id), "stop"], { kind, tool, candidates }));
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
  const b = ctx.belief, p = ctx.progress, target = String(args.target ?? "");
  const weapon = yield* holdBest(ctx, ["stone_pick", "stone_hatchet"]);
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
    ctx.body.act([{ control: "look", yaw: b.yawTo(t.pos), pitch: 0 }, { control: "use", hand: "primary", hold_ms: 600 }], `strike ${target}`);
    swings++;
    p.swings = swings;
    yield { ms: 600 };
  }
  return { status: "blocked", summary: "it won't die", data: { swings, won: false, foe: p.foe, weapon, health_lost: lost() } };
}

/** Where each material comes from. */
const SOURCE: Record<string, string> = { wood: "tree", thatch: "tree", stone: "rock", flint: "rock", fiber: "bush", berries: "bush" };

/** Gathers until the inventory holds a whole list of materials: trees, then rocks, then bushes, as each is needed. */
function* gather(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  const items = (args.items && typeof args.items === "object" ? args.items : {}) as Record<string, number>;
  const unknown = Object.keys(items).filter((i) => !(i in SOURCE));
  if (unknown.length || !Object.keys(items).length) return { status: "failed", summary: `I can gather ${Object.keys(SOURCE).join(", ")}, not ${unknown.join(", ") || "nothing"}` };
  const short = () => Object.entries(items).filter(([i, n]) => b.count(i) < n);
  for (const kind of ["tree", "rock", "bush"]) {
    const want = Object.fromEntries(Object.entries(items).filter(([i]) => SOURCE[i] === kind));
    if (!Object.keys(want).length || Object.entries(want).every(([i, n]) => b.count(i) >= n)) continue;
    const sub: SkillContext = { ...ctx, progress: ((p[kind] ??= {}) as Record<string, unknown>) };
    const r = yield* harvest(sub, { kind, until: want, ...(typeof args.radius === "number" ? { radius: args.radius } : {}) });
    if (r.status !== "done" && Object.entries(want).some(([i, n]) => b.count(i) < n)) return { status: "blocked", summary: `gathering from ${kind}s: ${r.summary}`, data: { reason: r.data?.reason ?? "none_near", ...(r.data?.danger ? { danger: r.data.danger } : {}), short: Object.fromEntries(short().map(([i, n]) => [i, n - b.count(i)])) } };
  }
  const left = short();
  if (left.length) return { status: "blocked", summary: `still short of ${left.map(([i, n]) => `${n - b.count(i)} ${i}`).join(", ")}`, data: { reason: "none_near" } };
  return { status: "done", summary: `I have ${Object.keys(items).map((i) => `${b.count(i)} ${i}`).join(", ")}`, data: { items } };
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
  // The whole bill first: what every missing piece takes, against what is in the bag, so the shortage is told once.
  const bill: Record<string, number> = {};
  for (const [piece, n] of Object.entries(needs)) {
    const missing = Math.max(0, n - b.count(piece));
    const r = b.inventory?.craftable.find((x) => x.item === piece);
    if (!missing || !r) continue;
    for (const [item, k] of Object.entries(r.needs)) bill[item] = (bill[item] ?? 0) + k * missing;
  }
  const short = Object.entries(bill).filter(([item, k]) => b.count(item) < k).map(([item, k]) => `${k - b.count(item)} more ${item}`);
  if (short.length) {
    const all = Object.entries(bill).map(([item, k]) => `${k} ${item}`).join(", ");
    return { status: "blocked", summary: `the ${name} takes ${all} in all; I'm short of ${short.join(", ")}`, data: { bill, short, reason: "materials" } };
  }
  // Queue the crafting in the order the pieces go up, and start placing as soon as the first is made: crafting goes
  // on while the character works, as a player's queue does.
  const crafting: { piece: string; acted: ReturnType<SkillContext["body"]["act"]> }[] = [];
  if (!p.queued) {
    for (const piece of [...new Set(plan.map((x) => x.piece))]) {
      const missing = (needs[piece] ?? 0) - b.count(piece);
      if (missing > 0) crafting.push({ piece, acted: ctx.body.act([{ control: "craft", item: piece, count: missing }], `craft ${missing} ${piece}`) });
    }
    p.queued = true;
  }
  const craftFailed = () => crafting.find((c) => c.acted.state.outcomes[0] && c.acted.state.outcomes[0].status !== "completed");
  let origin = p.origin as [number, number] | undefined;
  let placedAt = -Infinity;
  for (const spot of left()) {
    // A view of the inventory from after the last placement, with the piece in it (or its crafting failed).
    yield { until: () => (b.inventoryAt > placedAt && b.count(spot.piece) > 0) || !!craftFailed(), ms: 30000 };
    const bad = craftFailed();
    if (bad && b.count(spot.piece) === 0) return { status: "failed", summary: `crafting ${bad.piece} failed: ${bad.acted.state.outcomes[0]?.code ?? bad.acted.state.outcomes[0]?.status}`, data: { placed } };
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
    placedAt = b.now;
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
    name: "walk_to", describe: "An errand: walk to a place (x, z) or a thing or person by id, nearby or in ground you know, by the best way you know.",
    params: { x: "number", z: "number", to: "entity id, in place of x and z", reach: "metres (default 1.5, or 2.5 to a thing)", run: "boolean: sprint" },
    body: true, run: walkTo,
  },
  travel: {
    name: "travel", describe: "A trek across the map: plans the way over the map, keeps clear of known danger, goes round what turns out blocked, and notes how it goes.",
    params: { x: "number", z: "number", to: "entity id, in place of x and z", reach: "metres (default 3)", run: "boolean: sprint where it can" },
    body: true, run: travel,
  },
  explore: {
    name: "explore", describe: "Explore unknown or enemy ground, carefully: a stretch at a time, looking round after each, stopping to report what it finds and anything hostile.",
    params: { toward: "north | north-east | east | ... (or x and z)", x: "number", z: "number", distance: "metres (default 120)" },
    body: true, run: explore,
  },
  harvest: {
    name: "harvest", describe: "Gather from trees, rocks or bushes near where it starts (best tool in hand), until none is left near, or until `count` of the main yield.",
    params: { kind: "tree | rock | bush", target: "entity id (optional): the one to start with", count: "number (optional): stop once this many wood, stone or fiber ITEMS are gathered (a tree gives 30 wood); leave it out to clear every one near", radius: "metres around the start (default 25)", until: "{item: count} (optional): stop when the inventory holds these" },
    body: true, run: harvest,
  },
  gather: {
    name: "gather", describe: "Gather until the inventory holds a whole list of materials (wood, thatch, stone, flint, fiber, berries): it goes to trees, rocks and bushes as each is needed, moving on to the next patch it knows of.",
    params: { items: "{material: count}, the totals to have", radius: "metres around each patch (default 25)" }, body: true, run: gather,
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
