// Moving things between containers: looting bodies, stashing the bag, emptying a harvester into a vault, sorting vaults,
// moving a base's stores to another. Each is trips of the same few moves: walk to a container, open it, "transfer all"
// with a filter (the inventory screen's own, through the protocol), walk to the next, put down what was picked up. A
// trip ends when the character can carry no more or the container is empty; a destination full goes on to the next.

import type { Remembered } from "./belief.ts";
import type { Run } from "./body.ts";
import type { Slot, Vec3 } from "./protocol.ts";
import type { SkillContext, SkillResult } from "./skills.ts";

export interface Filter {
  items?: string[];
  kinds?: string[];
}

type Moved = Record<string, number>;
const add = (into: Moved, more: Moved) => {
  for (const [k, v] of Object.entries(more)) into[k] = (into[k] ?? 0) + v;
  return into;
};
const said = (m: Moved) => Object.entries(m).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing";

/** Containers for keeping things in (not bodies), about a point. */
export function stores(b: SkillContext["belief"], near: Vec3 = b.pos, radius = 60): Remembered[] {
  return b.find((t) => t.kind === "container" && t.type !== "corpse" && Math.hypot(t.pos[0] - near[0], t.pos[2] - near[2]) <= radius);
}

/** A container by id, or by name ("stone vault"), or the nearest whose name has the word. */
export function resolve(b: SkillContext["belief"], what: unknown): Remembered | null {
  if (typeof what !== "string") return null;
  const byId = b.things.get(what);
  if (byId) return byId;
  const w = what.toLowerCase();
  return b.find((t) => (t.kind === "container" || !!t.tags?.includes("inventory")) && !!t.name && t.name.toLowerCase().includes(w))[0] ?? null;
}

/** Walks to a container (or a creature carrying things), faces it and opens it. */
export function* openUp(ctx: SkillContext, id: string): Run<boolean> {
  const b = ctx.belief;
  if (b.inventory?.open?.id === id) return true;
  let r = yield* ctx.body.goTo(() => b.things.get(id)?.pos ?? null, 2.0, { ignore: id });
  // Among boxes the map is crowded with what they take up: the last few metres straight, steering round them.
  if (r !== "arrived" && (b.things.get(id) && b.distance(b.things.get(id)!.pos) < 15)) r = yield* ctx.body.walkTo(() => b.things.get(id)?.pos ?? null, 2.0, { ignore: id });
  // A box or vault takes its own patch of the map: the way may end just short of it, within reach all the same.
  const there = b.things.get(id);
  if ((r !== "arrived" && (!there || b.distance(there.pos) > 3.2)) || !(yield* ctx.body.face(id))) return false;
  const at = b.now;
  yield* ctx.body.settle(ctx.body.act([{ control: "interact", target: id, verb: "open" }], `open ${id}`), 2000);
  yield { until: () => b.inventoryAt > at && b.inventory?.open?.id === id, ms: 2000 };
  return b.inventory?.open?.id === id;
}

/** "Transfer all" between the bag and the open container, and a fresh look at both after. */
export function* transfer(ctx: SkillContext, from: "self" | "open", f: Filter, keep?: Record<string, number>): Run<{ moved: Moved; reason: string | null }> {
  const b = ctx.belief;
  const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "items", op: "transfer", from, to: from === "self" ? "open" : "self", ...(f.items ? { items: f.items } : {}), ...(f.kinds ? { kinds: f.kinds } : {}), ...(keep ? { keep } : {}) }], `transfer ${from === "self" ? "in" : "out"}`), 2000);
  const at = b.now;
  yield { until: () => b.inventoryAt > at, ms: 1500 };
  const d = (o?.detail ?? {}) as { moved?: Moved; reason?: string | null };
  return { moved: d.moved ?? {}, reason: d.reason ?? (o?.status === "completed" ? null : (o?.code ?? "failed")) };
}

const matches = (s: Slot, f: Filter) => (!f.items || f.items.includes(s.item)) && (!f.kinds || (!!s.kind && f.kinds.includes(s.kind)));

/** Carries what matches out of one container into others, trip after trip, until the source has none left, the
 * destinations are full, or a trip moves nothing. */
export function* haul(ctx: SkillContext, source: string, dests: string[], f: Filter): Run<{ moved: Moved; trips: number; left: boolean; why?: string }> {
  const b = ctx.belief;
  const moved: Moved = {};
  let trips = 0;
  for (; trips < 40; trips++) {
    if (!(yield* openUp(ctx, source))) return { moved, trips, left: true, why: `I can't get at ${source}` };
    const there = (b.inventory?.open?.slots ?? []).filter((s) => matches(s, f));
    if (!there.length) return { moved, trips, left: false };
    // What the bag held of these before: kept back when putting down, so the character's own things stay with it.
    const before = Object.fromEntries([...new Set(there.map((s) => s.item))].map((i) => [i, b.count(i)]));
    const took = yield* transfer(ctx, "open", f);
    if (!Object.keys(took.moved).length) return { moved, trips, left: true, why: took.reason === "weight" ? "I'm carrying too much to take any" : `nothing would come out (${took.reason ?? "?"})` };
    const picked = Object.keys(took.moved);
    let pending = true;
    for (const d of dests) {
      if (!(yield* openUp(ctx, d))) continue;
      const put = yield* transfer(ctx, "self", { items: picked }, before);
      add(moved, put.moved);
      if (picked.every((i) => b.count(i) <= (before[i] ?? 0))) {
        pending = false;
        break;
      }
    }
    if (pending) return { moved, trips: trips + 1, left: true, why: "every place to put it is full" };
    if (took.reason !== "weight" && took.reason !== "full") return { moved, trips: trips + 1, left: false };
  }
  return { moved, trips, left: true, why: "too many trips" };
}

// --- The skills -------------------------------------------------------------------------------------------------

/** Loot: bodies (and any container named) into the bag, as much as it can carry. */
export function* loot(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief;
  const f: Filter = { ...(Array.isArray(args.items) ? { items: args.items as string[] } : {}), ...(Array.isArray(args.kinds) ? { kinds: args.kinds as string[] } : {}) };
  const one = resolve(b, args.target);
  const bodies = () => b.find((t) => t.type === "corpse" && b.distance(t.pos) < 60);
  // A kill this moment: its body comes into view a moment later.
  if (!one && !bodies().length) yield { until: () => bodies().length > 0, ms: 1500 };
  const targets = one ? [one] : bodies();
  if (!targets.length) return { status: "done", summary: "nothing to loot about" };
  const got: Moved = {};
  for (const t of targets) {
    if (!(yield* openUp(ctx, t.id))) continue;
    const r = yield* transfer(ctx, "open", f);
    add(got, r.moved);
    if (r.reason === "weight" || r.reason === "full") return { status: "blocked", summary: `my bag is full; looted ${said(got)}`, data: { got, reason: "weight" } };
  }
  return { status: "done", summary: `looted ${said(got)} from ${targets.length} ${targets.length > 1 ? "bodies" : "body"}`, data: { got } };
}

/** Stash: the bag's things into a container (by default resources, food and pieces; never the tools in use). */
export function* stash(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief;
  const to = resolve(b, args.to) ?? stores(b)[0];
  if (!to) return { status: "failed", summary: "there is no box or vault about to put things in" };
  const f: Filter = Array.isArray(args.items) ? { items: args.items as string[] } : { kinds: Array.isArray(args.kinds) ? (args.kinds as string[]) : ["resource", "food", "structure"] };
  if (!(yield* openUp(ctx, to.id))) return { status: "blocked", summary: `I can't get at ${to.name ?? to.id}` };
  const r = yield* transfer(ctx, "self", f);
  return { status: r.reason === "full" ? "blocked" : "done", summary: `put ${said(r.moved)} in ${to.name ?? to.id}${r.reason === "full" ? "; it is full" : ""}`, data: { moved: r.moved, ...(r.reason ? { reason: r.reason } : {}) } };
}

/** Empty: everything (or what matches) out of a container or a carrying creature (a harvester), into stores. */
export function* empty(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief;
  const from = resolve(b, args.from);
  if (!from) return { status: "failed", summary: `I don't know ${String(args.from)}` };
  const named = resolve(b, args.to);
  const dests = [...(named ? [named] : []), ...stores(b).filter((s) => s.id !== named?.id && s.id !== from.id).sort((a, c) => Number(c.type === "vault") - Number(a.type === "vault") || b.distance(a.pos) - b.distance(c.pos))];
  if (!dests.length) return { status: "failed", summary: "there is nowhere to put it" };
  const f: Filter = { ...(Array.isArray(args.items) ? { items: args.items as string[] } : {}), ...(Array.isArray(args.kinds) ? { kinds: args.kinds as string[] } : { kinds: ["resource", "food"] }) };
  const r = yield* haul(ctx, from.id, dests.map((d) => d.id), f);
  const where = named?.name ?? named?.id ?? "the stores";
  return r.left
    ? { status: "blocked", summary: `moved ${said(r.moved)} from ${from.name ?? from.type} to ${where} in ${r.trips} trips, then stopped: ${r.why}`, data: { moved: r.moved, reason: "haul" } }
    : { status: "done", summary: `emptied ${from.name ?? from.type} into ${where}: ${said(r.moved)} in ${r.trips} trip${r.trips === 1 ? "" : "s"}`, data: { moved: r.moved, trips: r.trips } };
}

/** Organize: every container about looked into, then each item taken to its home: the container named for it or its
 * kind ("stone vault", "food box"), else the one already holding the most of it. */
export function* organize(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief;
  const boxes = (Array.isArray(args.containers) ? (args.containers as string[]).map((c) => resolve(b, c)).filter((x): x is Remembered => !!x) : stores(b));
  if (boxes.length < 2) return { status: "done", summary: "there is only one place to keep things; nothing to sort" };
  // Look into each first (the game shows a container's contents only when it is open).
  for (const x of boxes) if (!b.stores.has(x.id) || b.now - b.stores.get(x.id)!.t > 60_000) yield* openUp(ctx, x.id);
  const held = new Map<string, Map<string, number>>(); // item → container → count
  const kindOf = new Map<string, string>();
  for (const x of boxes) for (const s of b.stores.get(x.id)?.slots ?? []) {
    if (s.kind) kindOf.set(s.item, s.kind);
    const m = held.get(s.item) ?? new Map<string, number>();
    m.set(x.id, (m.get(x.id) ?? 0) + s.count);
    held.set(s.item, m);
  }
  const home = (item: string): string => {
    const words = [item, kindOf.get(item) ?? "", item.replace(/_.*/, "")].filter(Boolean);
    const named = boxes.find((x) => x.name && words.some((w) => x.name!.toLowerCase().includes(w.toLowerCase())));
    if (named) return named.id;
    return [...held.get(item)!.entries()].sort((a, c) => c[1] - a[1])[0]![0];
  };
  // The moves: from each container, what does not live there, grouped by where it goes.
  const jobs = new Map<string, { from: string; to: string; items: string[] }>();
  for (const [item, where] of held) {
    const h = home(item);
    for (const c of where.keys()) {
      if (c === h) continue;
      const k = `${c}>${h}`;
      const j = jobs.get(k) ?? { from: c, to: h, items: [] };
      j.items.push(item);
      jobs.set(k, j);
    }
  }
  if (!jobs.size) return { status: "done", summary: "everything is already where it belongs" };
  const moved: Moved = {};
  let trips = 0;
  const name = (id: string) => boxes.find((x) => x.id === id)?.name ?? id;
  for (const j of jobs.values()) {
    const r = yield* haul(ctx, j.from, [j.to], { items: j.items });
    add(moved, r.moved);
    trips += r.trips;
    ctx.note(`${said(r.moved)}: ${name(j.from)} to ${name(j.to)}`);
    if (r.left) return { status: "blocked", summary: `sorting stopped: ${r.why}; moved ${said(moved)} so far`, data: { moved, reason: "haul" } };
  }
  return { status: "done", summary: `sorted ${boxes.length} containers in ${trips} trips: ${said(moved)} moved to their homes`, data: { moved, trips } };
}

/** Migrate: a base's stores to another: every container about one place emptied into the containers about another. */
export function* migrate(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief;
  const place = (v: unknown): Remembered[] => {
    if (Array.isArray(v)) return (v as unknown[]).map((x) => resolve(b, x)).filter((x): x is Remembered => !!x);
    const o = v as { x?: number; z?: number; radius?: number } | undefined;
    return o && typeof o.x === "number" && typeof o.z === "number" ? stores(b, [o.x, 0, o.z], o.radius ?? 20) : [];
  };
  const from = place(args.from), to = place(args.to).sort((a, c) => Number(c.type === "vault") - Number(a.type === "vault"));
  if (!from.length || !to.length) return { status: "failed", summary: `I need containers to move from (${from.length}) and to (${to.length}): give ids or {x, z, radius}` };
  const f: Filter = Array.isArray(args.kinds) ? { kinds: args.kinds as string[] } : {};
  const moved: Moved = {};
  let trips = 0;
  for (const s of from) {
    const r = yield* haul(ctx, s.id, to.map((d) => d.id), f);
    add(moved, r.moved);
    trips += r.trips;
    ctx.note(`${s.name ?? s.id} moved: ${said(r.moved)}`);
    if (r.left) return { status: "blocked", summary: `moving the stores stopped at ${s.name ?? s.id}: ${r.why}; moved ${said(moved)} in ${trips} trips`, data: { moved, reason: "haul" } };
  }
  return { status: "done", summary: `moved ${from.length} containers' things into ${to.length} in ${trips} trips: ${said(moved)}`, data: { moved, trips } };
}
