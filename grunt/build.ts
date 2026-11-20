// Building through the game's build helper (the plan control): a layout from the library or the Director, laid out on
// the game's grid, checked whole at once, sited where it fits, its pieces crafted, then placed in sections of a few
// dozen from a spot within the helper's reach, the character never aiming. It stops on the first piece that cannot
// go and says which and why; taken up again, it goes on from there (the pieces standing count as built).

import { BLUEPRINTS } from "./blueprints.ts";
import type { Run } from "./body.ts";
import { compile, type Layout } from "./layout.ts";
import { BLOCKED, DEEP } from "./nav.ts";
import type { Building, PieceForm, PieceVerdict, Plan, PlanPiece, Side, Vec3 } from "./protocol.ts";
import type { SkillContext, SkillResult } from "./skills.ts";

const SIDES: Side[] = ["n", "e", "s", "w"];
const OUT: Record<Side, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
/** Quarter turns that bring a layout's front (its south) round to face a side. */
const TURNS: Record<Side, number> = { s: 0, w: 1, n: 2, e: 3 };
const rot = (dx: number, dz: number, turns: number): [number, number] => {
  for (let t = 0; t < turns; t++) [dx, dz] = [-dz, dx];
  return [dx, dz];
};
const facing = (yaw: number): Side => SIDES[Math.round((((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2)) % 4]!;

interface Grid {
  at: [number, number];
  turns: number;
}

/** Where a piece is in the world, on a grid laid at `g` (as the game places it). */
function where(g: Grid, p: PlanPiece, caps: Building): Vec3 {
  let dx = p.cell[0] * caps.cell, dz = p.cell[1] * caps.cell;
  if (p.side) (dx += (OUT[p.side][0] * caps.cell) / 2), (dz += (OUT[p.side][1] * caps.cell) / 2);
  if (p.form === "pillar") (dx -= caps.cell / 2), (dz -= caps.cell / 2);
  const [x, z] = rot(dx, dz, g.turns);
  return [g.at[0] + x, (p.form === "ceiling" ? p.level + 1 : p.level) * caps.storey, g.at[1] + z];
}

/** The footprint in the world: x0, z0, x1, z1. */
function footprint(g: Grid, bounds: [number, number, number, number], caps: Building): [number, number, number, number] {
  const h = caps.cell / 2;
  const a = rot(bounds[0] * caps.cell - h, bounds[1] * caps.cell - h, g.turns), b = rot(bounds[2] * caps.cell + h, bounds[3] * caps.cell + h, g.turns);
  return [g.at[0] + Math.min(a[0], b[0]), g.at[1] + Math.min(a[1], b[1]), g.at[0] + Math.max(a[0], b[0]), g.at[1] + Math.max(a[1], b[1])];
}

/** What a layout needs, said plainly, for a report: "9 foundation, 12 wall, ...". */
const tally = (pieces: { form: PieceForm }[]) => {
  const n: Record<string, number> = {};
  for (const p of pieces) n[p.form] = (n[p.form] ?? 0) + 1;
  return Object.entries(n).map(([f, k]) => `${k} ${f}`).join(", ");
};

export function* build(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress, caps = b.building;
  if (!caps) return { status: "failed", summary: "this game has no build helper" };
  // What to build.
  const name = typeof args.blueprint === "string" ? args.blueprint : args.layout ? "the layout" : "hut_2x2";
  const layout = (args.layout as Layout | undefined) ?? BLUEPRINTS[name];
  if (!layout) return { status: "failed", summary: `I don't know the blueprint ${name}; the library has ${Object.keys(BLUEPRINTS).join(", ")}` };
  const laid = compile(layout);
  if (laid.problems.length) return { status: "failed", summary: `the layout has problems: ${laid.problems.join("; ")}`, data: { reason: "layout", problems: laid.problems } };
  const tier = String(args.tier ?? layout.tier ?? "wood");
  const kit = caps.tiers[tier];
  if (!kit) return { status: "failed", summary: `there is no ${tier} tier; the game has ${Object.keys(caps.tiers).join(", ")}` };
  const lacking = [...new Set(laid.pieces.filter((x) => !kit[x.form]).map((x) => x.form))];
  if (lacking.length) return { status: "failed", summary: `${tier} has no ${lacking.join(" or ")}: build it in ${Object.entries(caps.tiers).filter(([, k]) => lacking.every((f) => k[f])).map(([t]) => t).join(" or ")}, or leave them out`, data: { reason: "tier", lacking } };
  const pieces: PlanPiece[] = laid.pieces.map((x) => ({ ...x, item: kit[x.form]! }));
  if (pieces.length > 400) return { status: "failed", summary: `${pieces.length} pieces is more than one build: split it` };

  // Where: asked for, or where it was put before, or in front of the character with its front facing back to it.
  const half = [((laid.bounds[2] - laid.bounds[0] + 1) * caps.cell) / 2, ((laid.bounds[3] - laid.bounds[1] + 1) * caps.cell) / 2];
  const turns = typeof args.facing === "string" && args.facing in TURNS ? TURNS[args.facing as Side] : TURNS[facing((b.self?.yaw ?? 0) + Math.PI)];
  const centreCell: [number, number] = [((laid.bounds[0] + laid.bounds[2]) / 2) * caps.cell, ((laid.bounds[1] + laid.bounds[3]) / 2) * caps.cell];
  const gridFor = (cx: number, cz: number): Grid => {
    const [ox, oz] = rot(centreCell[0], centreCell[1], turns);
    return { at: [cx - ox, cz - oz], turns };
  };
  let grid = p.grid as Grid | undefined;
  if (!grid) {
    let cx: number, cz: number;
    if (typeof args.x === "number" && typeof args.z === "number") [cx, cz] = [args.x, args.z];
    else {
      const yaw = b.self?.yaw ?? 0, d = Math.max(...half) + 3;
      [cx, cz] = [b.pos[0] + Math.sin(yaw) * d, b.pos[2] - Math.cos(yaw) * d];
    }
    grid = gridFor(cx, cz);
  }
  const plan = (g: Grid): Plan => ({ anchor: p.base ? { base: String(p.base) } : { at: g.at, turns: g.turns }, pieces });
  const check = function* (g: Grid) {
    const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "plan", op: "check", plan: plan(g) }], "check plan"), 3000);
    return o?.detail as { verdicts: { status: PieceVerdict; by?: string }[]; need: Record<string, number>; have: Record<string, number> } | undefined;
  };
  const me = b.self?.id;
  // Ground that will not do: the ground itself or what stands on it; the character in the way is no matter (it moves).
  const unfit = (v: { status: PieceVerdict; by?: string }) => v.status === "terrain" || v.status === "occupied" || (v.status === "blocked" && v.by !== me) || v.status === "enemy_near";
  let verdict = yield* check(grid);
  if (!verdict) return { status: "failed", summary: "the game did not answer the plan check" };
  // A site that does not fit: the nearest that does, a cell at a time out to five cells, unless the place was asked for.
  if (!p.grid && !p.base && verdict.verdicts.some(unfit)) {
    const first = verdict;
    const asked = typeof args.x === "number";
    let found = false;
    const shifts: [number, number][] = [];
    for (let di = -5; di <= 5; di++) for (let dj = -5; dj <= 5; dj++) if (di || dj) shifts.push([di, dj]);
    shifts.sort((a, c) => Math.hypot(...a) - Math.hypot(...c));
    for (const [di, dj] of asked ? shifts.slice(0, 8) : shifts) {
      const g: Grid = { at: [grid.at[0] + di * caps.cell, grid.at[1] + dj * caps.cell], turns };
      const v = yield* check(g);
      if (v && !v.verdicts.some(unfit)) {
        (grid = g), (verdict = v), (found = true);
        break;
      }
    }
    if (!found) {
      const bad = first.verdicts.map((v, k) => ({ v, k })).filter(({ v }) => unfit(v)).slice(0, 4);
      const said = bad.map(({ v, k }) => `${pieces[k]!.form} at cell ${pieces[k]!.cell.join(",")}: ${v.status}${v.by ? ` (${v.by})` : ""}`).join("; ");
      return { status: "blocked", summary: `the ${name} does not fit here or within five cells: ${said}`, data: { reason: "site", problems: bad.map(({ v, k }) => ({ piece: pieces[k], ...v })) } };
    }
  }
  p.grid = grid;
  // Something in the way of a piece of a build already begun (a rock rolled onto it, a creature standing there): say
  // which, so it can be cleared, and go on from there when taken up again.
  const inWay = verdict.verdicts.findIndex(unfit);
  if (inWay >= 0) {
    const x = pieces[inWay]!, v = verdict.verdicts[inWay]!;
    return {
      status: "blocked",
      summary: `the ${name} can't go on: the ${x.form} at cell ${x.cell.join(",")}${x.side ? ` ${x.side} side` : ""} storey ${x.level}: ${v.status}${v.by ? ` (${v.by})` : ""}`,
      data: { reason: v.status, ...(v.by ? { by: v.by } : {}), piece: x, next: inWay },
    };
  }
  // A plan that cannot stand as written (no support) is the layout's fault, not the ground's.
  const unsupported = verdict.verdicts.map((v, k) => ({ v, k })).filter(({ v }) => v.status === "no_support" || v.status === "not_in_tier");
  if (unsupported.length) {
    const said = unsupported.slice(0, 4).map(({ v, k }) => `${pieces[k]!.form} at cell ${pieces[k]!.cell.join(",")} storey ${pieces[k]!.level}: ${v.status}${v.by ? ` (${v.by})` : ""}`).join("; ");
    return { status: "failed", summary: `the ${name} cannot stand as laid out: ${said}`, data: { reason: "support", problems: unsupported.map(({ v, k }) => ({ piece: pieces[k], ...v })) } };
  }
  const todo = verdict.verdicts.filter((v) => v.status !== "built").length;
  const [cx, cz] = [grid.at[0] + rot(centreCell[0], centreCell[1], turns)[0], grid.at[1] + rot(centreCell[0], centreCell[1], turns)[1]];
  const at = `${Math.round(cx)}, ${Math.round(cz)}, front facing ${["south", "west", "north", "east"][turns]}`;

  // The bill: the pieces still to place against the bag, and what crafting the rest takes.
  const missing: Record<string, number> = {};
  for (const [item, n] of Object.entries(verdict.need)) if (n > b.count(item)) missing[item] = n - b.count(item);
  const bill: Record<string, number> = {};
  for (const [item, n] of Object.entries(missing)) {
    const r = b.inventory?.craftable.find((x) => x.item === item);
    if (!r) return { status: "failed", summary: `I can't craft ${item}`, data: { reason: "recipe", item } };
    for (const [m, k] of Object.entries(r.needs)) bill[m] = (bill[m] ?? 0) + k * n;
  }
  const short = Object.entries(bill).filter(([m, k]) => b.count(m) < k);
  if (args.check) {
    return {
      status: "done",
      summary: `the ${name} (${tier}) fits at ${at}: ${pieces.length} pieces (${tally(laid.pieces)}), ${pieces.length - todo} already built; ${Object.keys(missing).length ? `to craft: ${Object.entries(missing).map(([i, n]) => `${n} ${i}`).join(", ")}, taking ${Object.entries(bill).map(([m, k]) => `${k} ${m}`).join(", ")}` : "every piece is in the bag"}${short.length ? `; short of ${short.map(([m, k]) => `${k - b.count(m)} ${m}`).join(", ")}` : ""}`,
      data: { fits: true, pieces: pieces.length, built: pieces.length - todo, missing, bill },
    };
  }
  if (short.length) {
    return {
      status: "blocked",
      summary: `the ${name} takes ${Object.entries(bill).map(([m, k]) => `${k} ${m}`).join(", ")} to craft its ${Object.values(missing).reduce((a, c) => a + c, 0)} missing pieces; I'm short of ${short.map(([m, k]) => `${k - b.count(m)} more ${m}`).join(", ")}`,
      data: { bill, short: short.map(([m, k]) => `${k - b.count(m)} more ${m}`), reason: "materials" },
    };
  }
  // Queue every missing piece at once: crafting goes on while the pieces in hand go up.
  if (!p.queued) {
    // In the order the plan first needs each.
    const order = Object.keys(missing).sort((a, c) => pieces.findIndex((x) => x.item === a) - pieces.findIndex((x) => x.item === c));
    for (const item of order) ctx.body.act([{ control: "craft", item, count: missing[item]! }], `craft ${missing[item]} ${item}`);
    p.queued = true;
    p.queuedAt = b.now;
  }
  if (!p.told) ctx.note(`building the ${name} (${tier}) at ${at}: ${todo} pieces to place`), (p.told = true);

  // Still being made: in the crafting queue, or the bag not seen since the crafting was asked for.
  const queued = (item: string) => b.inventoryAt <= Number(p.queuedAt ?? -Infinity) + 250 || !!b.inventory?.crafting.some((c) => c.item === item && c.left > 0);
  // Sections, each placed from one spot within reach of all of it, outside the footprint.
  const per = Math.max(5, Math.min(Number(args.section ?? 30), caps.max_pieces));
  const fp = footprint(grid, laid.bounds, caps);
  let start = Number(p.next ?? 0), stuck = 0;
  while (start < pieces.length) {
    const end = Math.min(pieces.length, start + per) - 1;
    const section = pieces.slice(start, end + 1).map((x) => where(grid, x, caps));
    // A spot round the footprint, 2.5 m out, every 3 m, on ground the character can stand on; the one with the
    // farthest piece nearest, then the one nearest the character.
    const spots: Vec3[] = [];
    const [x0, z0, x1, z1] = [fp[0] - 2.5, fp[1] - 2.5, fp[2] + 2.5, fp[3] + 2.5];
    for (let x = x0; x <= x1; x += 3) spots.push([x, 0, z0], [x, 0, z1]);
    for (let z = z0 + 3; z < z1; z += 3) spots.push([x0, 0, z], [x1, 0, z]);
    const fits = (s: Vec3) => {
      const k = b.nav.w ? b.nav.kindAt(s[0], s[2]) : 0;
      return k !== BLOCKED && k !== DEEP;
    };
    const far = (s: Vec3) => Math.max(...section.map((q) => Math.hypot(q[0] - s[0], q[1] - 1.5, q[2] - s[2])));
    const spot = spots.filter(fits).sort((a, c) => Math.round(far(a) / 3) - Math.round(far(c) / 3) || b.distance(a) - b.distance(c))[0];
    if (!spot || far(spot) > caps.reach - 1) return { status: "failed", summary: `no spot round the ${name} is within ${caps.reach} m of all of a section`, data: { reason: "reach" } };
    if (b.distance(spot) > 1.5) {
      const r = yield* ctx.body.goTo(() => spot, 1.2, {});
      if (r !== "arrived" && far(b.pos) > caps.reach - 1) return { status: "blocked", summary: `I can't get to a spot to build the ${name} from`, data: { reason: "path", next: start } };
    }
    // Pieces not yet crafted: wait for the first of this section.
    const first = pieces.slice(start, end + 1).find((x, k) => verdict!.verdicts[start + k]?.status !== "built");
    if (first && b.count(first.item) === 0) yield { until: () => b.count(first.item) > 0 || !queued(first.item), ms: 600_000 };
    const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "plan", op: "build", plan: plan(grid), from: start, to: end }], `build ${start}-${end}`), ((end - start + 1) / caps.rate) * 1000 + 15_000);
    const d = (o?.detail ?? {}) as { at?: number; placed?: number; base?: string; reason?: string; by?: string; item?: string };
    if (d.base) p.base = d.base;
    const reached = typeof d.at === "number" ? d.at : start;
    if (o?.status === "completed") {
      p.next = start = end + 1;
      stuck = 0;
      if (start < pieces.length) ctx.note(`${start} of ${pieces.length} pieces of the ${name} done`);
      continue;
    }
    p.next = start = reached;
    // Out of a piece: crafting is still going; wait for it and go on.
    if (d.reason === "missing_items" && d.item) {
      const was = b.count(d.item);
      yield { until: () => b.count(d.item!) > was || !queued(d.item!), ms: 600_000 };
      if (b.count(d.item) === 0) return { status: "blocked", summary: `I ran out of ${d.item} at piece ${reached} of ${pieces.length}`, data: { reason: "materials", item: d.item, next: reached } };
      continue;
    }
    // In my own way, or too far: move and try again, a few times.
    if ((d.reason === "blocked" && d.by === me) || d.reason === "too_far") {
      if (++stuck > 3) return { status: "blocked", summary: `I keep being in the way of piece ${reached} of the ${name}`, data: { reason: "self", next: reached } };
      const q = where(grid, pieces[reached]!, caps);
      const away = spots.filter(fits).sort((a, c) => Math.abs(Math.hypot(a[0] - q[0], a[2] - q[2]) - 6) - Math.abs(Math.hypot(c[0] - q[0], c[2] - q[2]) - 6))[0];
      if (away) yield* ctx.body.goTo(() => away, 1.2, {});
      continue;
    }
    if (o?.status === "interrupted" || !o) return { status: "blocked", summary: `building the ${name} was interrupted at piece ${reached} of ${pieces.length}`, data: { reason: "interrupted", next: reached } };
    const x = pieces[reached]!;
    return {
      status: "blocked",
      summary: `the ${name} stopped at piece ${reached} of ${pieces.length}: the ${x.form} at cell ${x.cell.join(",")}${x.side ? ` ${x.side} side` : ""} storey ${x.level}: ${d.reason ?? o.code ?? o.status}${d.by ? ` (${d.by})` : ""}`,
      data: { reason: d.reason ?? "blocked", by: d.by, piece: x, next: reached },
    };
  }
  ctx.body.stop("built");
  return { status: "done", summary: `built the ${name} (${tier}) at ${at}: ${pieces.length} pieces`, data: { base: p.base, pieces: pieces.length } };
}
