// The skills: small autonomous machines a task runs. Each one is a generator over the body's steps; it asks policies
// the narrow questions (decision points) and returns how it ended. A skill can be stopped between any two steps and
// started again with the same progress (a resumed task restarts its skill), so each is written to pick up from what it
// finds: its progress, and the world as believed.

import { type Belief, compass } from "./belief.ts";
import { build } from "./build.ts";
import { fight } from "./combat.ts";
import { escort, follow, repair, upkeep } from "./company.ts";
import { empty, loot, migrate, organize, stash } from "./haul.ts";
import { kit } from "./kit.ts";
import { type Costs, costsFor, type Danger, type RideKind, rideKind, type Route, WALK } from "./nav.ts";
import type { Remembered } from "./belief.ts";
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
export function* hold(ctx: SkillContext, item: string): Run<boolean> {
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

export function* holdBest(ctx: SkillContext, tools: string[]): Run<string | null> {
  for (const tool of tools) if (ctx.belief.slotOf(tool) !== null && (yield* hold(ctx, tool))) return tool;
  return null;
}

/** A look round, for appearance: the character already knows what is about it (its senses reach all round). */
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

interface Way {
  id: string;
  how: string;
  seconds: number;
  ride?: Remembered;
  kind?: RideKind;
  /** Flying in a tek suit. */
  suit?: boolean;
}

/** A tek suit's flight: its speed, and a unit of element every two seconds aloft. */
const SUIT: RideKind = { on: "air", speed: 16 };
const SUIT_BURN_S = 2;

/** The ways the character could go: on foot, or on each ride it knows of near enough, each timed as a whole (walking
 * to it, the ride, walking on from where it must stop, mounting, climbing and landing). */
function ways(b: Belief, goal: Vec3): Way[] {
  const out: Way[] = [];
  const nav = b.nav;
  const walk = nav.w ? nav.route(b.pos, goal, WALK, dangerCosts(b)) : null;
  out.push({ id: "walk", how: "on foot", seconds: Math.round(walk ? walk.cost / 3.5 : (b.distance(goal) / 3.5) * 1.3) });
  if (!nav.w) return out;
  const riding = b.self?.mount ?? null;
  for (const r of b.find((t) => !!t.tags?.includes("rideable") && b.distance(t.pos) < 200)) {
    const kind = rideKind(r.type, r.tags);
    const toIt = r.id === riding ? 0 : (nav.route(b.pos, r.pos, WALK)?.cost ?? Infinity) / 3.5 + 4;
    const ridden = nav.route(r.pos, goal, costsFor(kind), kind.on === "air" ? [] : dangerCosts(b));
    if (!ridden || !isFinite(toIt)) continue;
    const end = ridden.points.at(-1) ?? r.pos;
    const rest = ridden.near ? (nav.route(end, goal, WALK)?.cost ?? Infinity) / 3.5 + 4 : 0;
    const overhead = kind.on === "air" ? 16 : 2;
    const seconds = toIt + ridden.cost / 3.5 + rest + overhead;
    if (isFinite(seconds)) out.push({ id: `ride:${r.id}`, how: `the ${r.type} ${r.id}${r.id === riding ? " (riding it)" : ""}`, seconds: Math.round(seconds), ride: r, kind });
  }
  // A tek suit, worn or in the bag, with element enough to stay aloft the whole way (and a margin).
  if (b.count("tek_suit") > 0 || b.self?.status.includes("tek_suit")) {
    const flown = nav.route(b.pos, goal, costsFor(SUIT), []);
    if (flown) {
      const aloft = flown.cost / 3.5 + 10;
      const burn = Math.ceil(aloft / SUIT_BURN_S) + 2;
      if (b.count("element") >= burn) out.push({ id: "suit", how: `the tek suit (${burn} element)`, seconds: Math.round(aloft + 6), kind: SUIT, suit: true });
    }
  }
  return out.sort((x, y) => x.seconds - y.seconds);
}

function* dismount(ctx: SkillContext): Run<boolean> {
  const b = ctx.belief, id = b.self?.mount;
  if (!id) return true;
  yield* ctx.body.settle(ctx.body.act([{ control: "interact", target: id, verb: "dismount" }], "dismount"), 2000);
  yield { until: () => !b.self?.mount, ms: 1500 };
  return !b.self?.mount;
}

/** Gets on a ride: walks to it, faces it, mounts; a flyer climbs to where cliffs are below it. */
export function* board(ctx: SkillContext, ride: Remembered, kind: RideKind): Run<boolean> {
  const b = ctx.belief;
  if (b.self?.mount !== ride.id) {
    if (!(yield* dismount(ctx))) return false;
    const r = yield* ctx.body.goTo(() => b.things.get(ride.id)?.pos ?? null, 2.6, { ignore: ride.id, dangers: () => dangerCosts(b) });
    if (r !== "arrived" || !(yield* ctx.body.face(ride.id))) return false;
    yield* ctx.body.settle(ctx.body.act([{ control: "interact", target: ride.id, verb: "mount" }], `mount ${ride.id}`), 2000);
    yield { until: () => b.self?.mount === ride.id, ms: 1500 };
    if (b.self?.mount !== ride.id) return false;
  }
  if (kind.on === "air") {
    for (let i = 0; i < 12 && (b.self?.pos[1] ?? 0) < 45; i++) yield* ctx.body.settle(ctx.body.act([{ control: "jump", hold_ms: 2000 }], "climb"), 3000);
  }
  return true;
}

function* land(ctx: SkillContext): Run {
  const b = ctx.belief;
  yield* ctx.body.settle(ctx.body.act([{ control: "crouch", on: true }], "descend"), 1000);
  yield { until: () => (b.self?.pos[1] ?? 0) < 1.2, ms: 25000 };
  yield* ctx.body.settle(ctx.body.act([{ control: "crouch", on: false }], "landed"), 1000);
}

/** Gets on a mount or into a vehicle by id or name (walking to it), or off it. */
function* mountUp(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief;
  const id = typeof args.target === "string" ? (b.things.has(args.target) ? args.target : b.find((t) => !!t.tags?.includes("rideable") && (t.name ?? t.type).toLowerCase() === String(args.target).toLowerCase())[0]?.id) : b.find((t) => !!t.tags?.includes("rideable"))[0]?.id;
  const ride = id ? b.things.get(id) : undefined;
  if (!ride) return { status: "failed", summary: `there is no ${String(args.target ?? "mount")} about to ride` };
  if (!(yield* board(ctx, ride, rideKind(ride.type, ride.tags)))) return { status: "blocked", summary: `I couldn't get on the ${ride.type}` };
  return { status: "done", summary: `I'm on the ${ride.type} ${ride.id}` };
}

function* getOff(ctx: SkillContext): Run<SkillResult> {
  return (yield* dismount(ctx)) ? { status: "done", summary: "I'm on foot" } : { status: "blocked", summary: "I couldn't get off here" };
}

/** A trek: a long way, over the map, by the quickest way the character has (on foot, or a ride it knows of),
 * keeping clear of known danger, and saying how the way goes. */
function* travel(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  const { point, to, label } = destination(b, args);
  const goal = point();
  if (!goal) return { status: "failed", summary: `I don't know where ${to} is` };
  const start = b.pos, t0 = b.now;
  let told = Infinity, detours = Number(p.detours ?? 0);
  // How to go: asked for, or the quickest of the ways it has.
  const all = ways(b, goal);
  const asked = typeof args.by === "string" ? all.find((w) => w.id === `ride:${args.by}` || w.id === args.by) : undefined;
  const choice = asked?.id ?? (yield* ctx.decide("travel.mode", all.map((w) => w.id), { options: all.map((w) => ({ id: w.id, how: w.how, seconds: w.seconds })) }));
  const way = all.find((w) => w.id === choice) ?? all[0]!;
  if (all.length > 1 && !p.way) ctx.note(`going ${way.how}, about ${way.seconds} s${all.length > 1 ? ` (${all.filter((w) => w !== way).map((w) => `${w.how} ${w.seconds} s`).join(", ")})` : ""}`);
  p.way = way.id;
  let costs: Costs = WALK;
  if (way.ride && way.kind) {
    if (!(yield* board(ctx, way.ride, way.kind))) return { status: "blocked", summary: `I couldn't get on the ${way.ride.type}`, data: { reason: "board" } };
    costs = costsFor(way.kind);
  } else if (way.suit) {
    if (b.self?.mount) yield* dismount(ctx);
    // Into the suit (if it is in the bag), and up.
    if (!b.self?.status.includes("tek_suit")) {
      const slot = b.slotOf("tek_suit");
      if (slot !== null) yield* ctx.body.settle(ctx.body.act([{ control: "items", op: "equip", slot }], "put on the tek suit"), 1500);
      yield { until: () => !!b.self?.status.includes("tek_suit"), ms: 1000 };
    }
    for (let i = 0; i < 12 && (b.self?.pos[1] ?? 0) < 40; i++) yield* ctx.body.settle(ctx.body.act([{ control: "jump", hold_ms: 2000 }], "climb"), 3000);
    costs = costsFor(SUIT);
  } else if (b.self?.mount) yield* dismount(ctx);
  const air = way.kind?.on === "air";
  const r0 = yield* ctx.body.goTo(point, typeof args.reach === "number" ? args.reach : 3, {
    ...(to ? { ignore: to } : {}), sprint: !!args.run, costs, ...(air ? {} : { dangers: () => dangerCosts(b) }),
    onRoute: (route, replans, why) => {
      const said: Record<string, string> = {
        bumped: "something the map does not show is in the way", "blocked ahead": "the way ahead turned out blocked",
        "worse ground ahead": "the ground ahead is not what the map shows (water where a bridge was, or worse)",
        "danger ahead": "I saw danger near the way", "target moved": `${label} moved`,
      };
      if (replans === 0 && !p.route) ctx.note(`on my way to ${label}: ${describeRoute(route)}`);
      else if (replans > 0 && route.length >= 5) (p.detours = ++detours), ctx.note(`${said[why ?? "bumped"]}; new way: ${describeRoute(route)} from here`);
      p.route = describeRoute(route);
    },
    onLeg: (left) => {
      if (left < told * 0.66 && left > 30) {
        told = left;
        ctx.note(`${left} m to go to ${label}`);
      }
    },
  });
  let r = r0;
  if (air) yield* land(ctx);
  // A ride that stops short (a boat at the shore): off, and on foot the rest of the way.
  if (r === "near" && way.ride) {
    yield* dismount(ctx);
    r = yield* ctx.body.goTo(point, typeof args.reach === "number" ? args.reach : 3, { dangers: () => dangerCosts(b) });
  }
  if (args.dismount && b.self?.mount) yield* dismount(ctx);
  const walked = Math.round(Math.hypot(b.pos[0] - start[0], b.pos[2] - start[2]));
  const time = Math.round((b.now - t0) / 1000);
  const by = way.ride ? ` by ${way.how}${b.self?.mount ? " (still on it)" : ""}` : way.suit ? ` by the tek suit (${b.count("element")} element left)` : "";
  if (r === "arrived") return { status: "done", summary: `I'm at ${label}${by}, after ${time} s${detours ? ` and ${detours} detour${detours > 1 ? "s" : ""}` : ""}`, data: { seconds: time, detours, way: way.id } };
  if (r === "unreachable") return { status: "blocked", summary: `I know no way to ${label} from here (${walked} m from where I set out): explore toward it, or another way of travelling`, data: { reason: "unreachable" } };
  return { status: "blocked", summary: r === "lost" ? `I lost track of ${label}` : `I can't get through to ${label}`, data: { reason: r, detours } };
}

const DIRS: Record<string, [number, number]> = {
  north: [0, -1], "north-east": [0.71, -0.71], east: [1, 0], "south-east": [0.71, 0.71],
  south: [0, 1], "south-west": [-0.71, 0.71], west: [-1, 0], "north-west": [-0.71, -0.71],
};
const EXPLORE: Costs = { ...WALK, unknown: 1.05 };

/** Exploring: into ground it does not know, a stretch at a time toward the goal, stopping to report the moment
 * anything hostile comes within its senses (which reach all round: no stopping to look). */
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
    // The next stretch of the route, about 25 m: then the way on is chosen again from what is known by then.
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
  }
  return { status: "done", summary: `explored ${Math.round(Math.hypot(b.pos[0] - start[0], b.pos[2] - start[2]))} m ${dir ? `${args.toward}` : "toward the point"}; found: ${tell(found()) || "nothing of note"}`, data: { found: found().map((t) => t.id) } };
}

/** Gathers from trees, rocks or bushes near where it started, until none is left there or it has enough. */
function* harvest(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  // The kind of the target, when one is named and the kind is not.
  const kind = String(args.kind ?? (typeof args.target === "string" ? b.things.get(args.target)?.type : undefined) ?? "tree");
  if (!(kind in YIELD)) return { status: "failed", summary: `I can't harvest ${kind}` };
  // Just the one, until it is gone: a rock in the way of a build.
  const only = args.only === true && typeof args.target === "string" ? args.target : null;
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
  // What is about the character is known all at once: no looking round before deciding there is none near.
  // What it could not get at is said, so "done" is never taken for "none left".
  const summary = () => `gathered ${Object.entries((p.gained ?? {}) as Record<string, number>).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing"} from ${Number(p.targets ?? 0)} ${kind}s${((p.unreachable ?? []) as string[]).filter((id) => ctx.belief.things.has(id)).length ? `; ${((p.unreachable ?? []) as string[]).filter((id) => ctx.belief.things.has(id)).length} I could not get at (${((p.unreachable ?? []) as string[]).filter((id) => ctx.belief.things.has(id)).join(", ")})` : ""}`;
  p.targets ??= 0;
  const tool = kind === "bush" ? null : yield* holdBest(ctx, TOOLS[kind]!);
  const first = typeof args.target === "string" && !p.first_done ? args.target : null;
  while (true) {
    if (only && p.first_done && !b.things.has(only)) return { status: "done", summary: `the ${kind} ${only} is gone; ${summary()}`, data: { gained: p.gained } };
    if (enough()) return { status: "done", summary: summary(), data: { gained: p.gained } };
    if (b.weightFraction() > 0.95) return { status: "blocked", summary: `too heavy to carry more; ${summary()}`, data: { gained: p.gained, reason: "weight" } };
    const near = b.find((r) => r.type === kind && !unreachable.has(r.id) && Math.hypot(r.pos[0] - anchor[0], r.pos[2] - anchor[2]) <= radius);
    if (!near.length) {
      // None left here but some known elsewhere, and more wanted: move on to the nearest patch.
      const other = b.find((r) => r.type === kind && !unreachable.has(r.id) && b.distance(r.pos) < 150)[0];
      if (other && (want !== null || until) && moves < 3) {
        moves++;
        anchor = p.anchor = other.pos;
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
    const asked = only ?? (first && near.some((r) => r.id === first) ? first : null);
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
    // The game's assist works the hands: one action takes the thing (or as much as is wanted), at the tool's pace.
    if (b.assists?.kinds.includes("harvest")) {
      const left = want !== null ? want - have() : until?.[item] !== undefined ? until[item]! - b.count(item) : undefined;
      const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "assist", kind: "harvest", target, ...(left !== undefined ? { until: { count: Math.max(1, left) } } : {}) }], `harvest ${target}`), 120_000);
      addGained(p, o);
      const res = (o?.detail as { result?: string } | undefined)?.result;
      if (res === "obstructed" || res === "out_of_reach" || res === "lost") unreachable.add(target), (p.unreachable = [...unreachable]);
      if (res === "weight") return { status: "blocked", summary: `too heavy to carry more; ${summary()}`, data: { gained: p.gained, reason: "weight" } };
      if (!b.things.has(target)) p.targets = Number(p.targets) + 1;
      if (o?.status === "interrupted") return { status: "blocked", summary: `interrupted; ${summary()}`, data: { gained: p.gained, reason: "interrupted" } };
      continue;
    }
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
/** Where each material comes from. */
const SOURCE: Record<string, string> = { wood: "tree", thatch: "tree", stone: "rock", flint: "rock", fiber: "bush", berries: "bush" };

/** Gathers until the inventory holds a whole list of materials: trees, then rocks, then bushes, as each is needed. */
export function* gather(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
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

// --- Building: grunt/build.ts -------------------------------------------------------------------------------

export function* craft(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
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
  walk_to: {
    name: "walk_to", describe: "An errand: walk to a place (x, z) or a thing or person by id, nearby or in ground you know, by the best way you know.",
    params: { x: "number", z: "number", to: "entity id, in place of x and z", reach: "metres (default 1.5, or 2.5 to a thing)", run: "boolean: sprint" },
    body: true, run: walkTo,
  },
  travel: {
    name: "travel", describe: "A trek across the map by the quickest way the character has: on foot or a ride it knows of (it gets on, flies, drives or sails, and gets off where it must). Keeps clear of known danger, goes round what turns out blocked, and notes how it goes.",
    params: { x: "number", z: "number", to: "entity id, in place of x and z", reach: "metres (default 3)", run: "boolean: sprint where it can", by: "a ride's id, or walk (default: the quickest way it has)", dismount: "boolean: get off at the end" },
    body: true, run: travel,
  },
  explore: {
    name: "explore", describe: "Explore unknown or enemy ground toward a direction or point, stopping to report the moment anything hostile comes within its senses, and saying what it found.",
    params: { toward: "north | north-east | east | ... (or x and z)", x: "number", z: "number", distance: "metres (default 120)" },
    body: true, run: explore,
  },
  harvest: {
    name: "harvest", describe: "Gather from trees, rocks or bushes near where it starts (best tool in hand), until none is left near, or until `count` of the main yield.",
    params: { kind: "tree | rock | bush", target: "entity id (optional): the one to start with", only: "boolean: just the target, until it is gone (to clear it away)", count: "number (optional): stop once this many wood, stone or fiber ITEMS are gathered (a tree gives about 150 wood with a hatchet); leave it out to clear every one near", radius: "metres around the start (default 25)", until: "{item: count} (optional): stop when the inventory holds these" },
    body: true, run: harvest,
  },
  gather: {
    name: "gather", describe: "Gather until the inventory holds a whole list of materials (wood, thatch, stone, flint, fiber, berries): it goes to trees, rocks and bushes as each is needed, moving on to the next patch it knows of.",
    params: { items: "{material: count}, the totals to have", radius: "metres around each patch (default 25)" }, body: true, run: gather,
  },
  flee: { name: "flee", describe: "Run from a threat until it is far or lost.", params: { from: "entity id", yaw: "the world yaw it was heard from" }, body: true, run: flee },
  fight: {
    name: "fight", describe: "Fight with what the character has: a bow from range (it keeps its distance, leads and looses) or the best blade. The game's assist works the hands; this chooses whom, with what and when to stop. all: clear every hostile creature about, one at a time.",
    params: { target: "entity id (or all)", all: "boolean: every hostile creature about, hunting and nearest first", retreat: "health fraction to break off at (default 0.3)" }, body: true, run: fight,
  },
  build: {
    name: "build", describe: "Build a base from the library (blueprint) or a layout you write (game_blueprints shows both): it checks the whole plan with the game, finds ground where it fits, crafts the pieces and places them section by section through the game's build helper. check: true only checks (fit, what is built, the bill). Stopped on a piece, it says which and why; take it up again with resume.",
    params: { blueprint: "a library name", layout: "a layout object, in place of blueprint", tier: "thatch | wood | stone (default wood)", x: "number: where its middle goes (default: in front of you)", z: "number", facing: "n | e | s | w: the side its front faces (default: toward you)", check: "boolean: only check", section: "pieces a step (default 30)" }, body: true, run: build,
  },
  craft: { name: "craft", describe: "Craft items from the inventory, by the recipes the inventory screen shows.", params: { item: "item name", count: "number" }, body: false, run: craft },
  say: { name: "say", describe: "Say a line in chat.", params: { text: "string", channel: "local | global | group" }, body: false, run: say },
  kit: { name: "kit", describe: "Make a basic loadout (a pick, a hatchet, a bow, 20 arrows, some food): what is missing, crafted in order, each one's materials gathered first.", params: {}, body: true, run: kit },
  loot: {
    name: "loot", describe: "Loot bodies about (or one container) into the bag, as much as it can carry.",
    params: { target: "a body or container (default: every body about)", items: "only these items", kinds: "only these kinds: resource, food, ammo, ..." }, body: true, run: loot,
  },
  stash: {
    name: "stash", describe: "Put the bag's things in a box or vault (default: resources, food and pieces; never the gear in use).",
    params: { to: "container id or name (default: the nearest)", items: "only these items", kinds: "only these kinds" }, body: true, run: stash,
  },
  empty: {
    name: "empty", describe: "Empty a container or a carrying creature (a harvester) into the stores, trip after trip: vaults first, then boxes.",
    params: { from: "container or creature id or name", to: "container id or name (default: the stores about)", items: "only these items", kinds: "only these kinds (default resource, food)" }, body: true, run: empty,
  },
  organize: {
    name: "organize", describe: "Sort the containers about: each item goes to the one named for it or its kind (\"stone vault\", \"food box\"), else to the one already holding most of it.",
    params: { containers: "ids or names (default: every box and vault about)" }, body: true, run: organize,
  },
  migrate: {
    name: "migrate", describe: "Move a base's stores to another: everything in the containers about one place into those about another, trip after trip.",
    params: { from: "container ids or names, or {x, z, radius}", to: "container ids or names, or {x, z, radius}", kinds: "only these kinds" }, body: true, run: migrate,
  },
  follow: {
    name: "follow", describe: "Follow someone (or a creature) through the game's follow assist: keeps a natural distance, runs when left behind, glances about while waiting. Goes by the map when it loses them.",
    params: { target: "id or name", near: "metres (default 2.5)", far: "metres (default 6)", seconds: "how long (default 600)" }, body: true, run: follow,
  },
  escort: {
    name: "escort", describe: "Escort someone: follow, and fight whatever hostile comes within guard metres of them or you; done when they reach `to`.",
    params: { target: "id or name", to: "{x, z}: where they are going", guard: "metres (default 20)", seconds: "how long at most (default 900)" }, body: true, run: escort,
  },
  upkeep: {
    name: "upkeep", describe: "Look after the base in one go: repair what the game said was damaged (fetching materials from the stores if the bag is short), empty the harvesters into the stores, stash a heavy bag.",
    params: {}, body: true, run: upkeep,
  },
  repair: {
    name: "repair", describe: "Repair a base's damaged parts (the game tells of damage) through the repair assist, for half their recipe in what they lack.",
    params: { base: "base id (default: the one with damage)" }, body: true, run: repair,
  },
  mount: { name: "mount", describe: "Get on a mount or into a vehicle (walks to it); a flyer climbs. Fighting from a mount that fights (a tame raptor) is then its own.", params: { target: "id or name (default: the nearest)" }, body: true, run: mountUp },
  dismount: { name: "dismount", describe: "Get off the mount or out of the vehicle.", params: {}, body: true, run: getOff },
  look_around: { name: "look_around", describe: "Turn the whole way round, for appearance only: you already know everything about you that the senses reach.", params: {}, body: true, run: lookAround },
};
