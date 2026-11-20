// Building through the game's build helper (the plan control): a layout from the library or the Director, laid out on
// the game's grid, checked whole at once, sited where it fits, its pieces crafted, then placed in sections of a few
// dozen from a spot within the helper's reach, the character never aiming. It stops on the first piece that cannot
// go and says which and why; taken up again, it goes on from there (the pieces standing count as built).

import { BLUEPRINTS } from "./blueprints.ts";
import type { Run } from "./body.ts";
import { compile, type Laid, type Layout } from "./layout.ts";
import { BLOCKED, DEEP } from "./nav.ts";
import { BASIC_FORMS, type Building, type PieceForm, type PieceVerdict, type Plan, type PlanPiece, type Side, type Vec3 } from "./protocol.ts";
import { fetch, stores } from "./haul.ts";
import type { SkillContext, SkillResult } from "./skills.ts";

const SIDES: Side[] = ["n", "e", "s", "w"];
/** Classes of place whose pieces nothing else stands on: one that will not go is left out, and the rest goes on. */
const SKIPPABLE = new Set(["in_frame", "thing"]);

/** What a game and tier can build of a layout's pieces: each form the tier has, its item; one it lacks, a substitute
 * (a wall for a window, a ceiling for a sloped roof, stairs for a ramp or ladder) or left out, with a note; a thing,
 * the game's item of that name. Strict: anything lacking is a problem instead. */
export function adapt(laid: Laid[], caps: Building, tier: string, strict = false): { pieces: PlanPiece[]; notes: string[]; problems: string[] } {
  const kit = caps.tiers[tier] ?? {};
  const known = new Set<string>(caps.forms ? caps.forms.map((f) => f.form) : BASIC_FORMS);
  const things = caps.things;
  const pieces: PlanPiece[] = [], notes = new Set<string>(), problems = new Set<string>();
  for (const x of laid) {
    if (x.form === "thing") {
      const want = x.item ?? "";
      const item = !things ? want : things.find((t) => t === want || t === `piece_${want}` || t.endsWith(`_${want}`));
      if (item) pieces.push({ ...x, item });
      else (strict ? problems : notes).add(`no ${want} in this game${strict ? "" : ": left out"}`);
      continue;
    }
    if (kit[x.form]) {
      pieces.push({ ...x, item: kit[x.form]! });
      continue;
    }
    const why = known.has(x.form) ? `${tier} has no ${x.form}` : `this game has no ${x.form} yet`;
    if (strict) {
      problems.add(why);
      continue;
    }
    const sub = SUBSTITUTE[x.form];
    if (sub && kit[sub]) {
      pieces.push({ ...x, form: sub, item: kit[sub]! });
      notes.add(`${why}: a ${sub} in its place`);
    } else notes.add(`${why}: left out`);
  }
  return { pieces, notes: [...notes], problems: [...problems] };
}

/** What stands in for a form a game or tier lacks (none: the piece is left out). */
const SUBSTITUTE: Record<string, string> = {
  windowframe: "wall", sloped_roof: "ceiling", hatchframe: "ceiling", ramp: "stairs", ladder: "stairs", behemoth_gateway: "gateway",
  behemoth_gate: "gate", triangle_foundation: "foundation", triangle_ceiling: "ceiling",
};

/** "did you mean" for a name not known: the nearest of the names by letters. */
export function nearest(name: string, names: string[]): string {
  const d = (a: string, b: string) => {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
    for (let j = 1; j <= b.length; j++) m[0]![j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i]![j] = Math.min(m[i - 1]![j]! + 1, m[i]![j - 1]! + 1, m[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length]![b.length]!;
  };
  const best = names.map((n) => [n, d(name, n)] as const).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= Math.max(3, name.length / 3) ? ` (did you mean ${best[0]}?)` : "";
}
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
  // What to build: a blueprint of the library or one captured, or a layout written out.
  const library = { ...BLUEPRINTS, ...b.layouts };
  const name = typeof args.blueprint === "string" ? args.blueprint : args.layout ? "layout" : "hut_2x2";
  const layout = (args.layout as Layout | undefined) ?? library[name];
  if (!layout) return { status: "failed", summary: `I don't know the blueprint ${name}${nearest(name, Object.keys(library))}; the library has ${Object.keys(library).join(", ")}` };
  const laid = compile(layout);
  if (laid.problems.length) return { status: "failed", summary: `the layout has problems: ${laid.problems.join("; ")}`, data: { reason: "layout", problems: laid.problems } };
  const tier = String(args.tier ?? layout.tier ?? "wood");
  if (!caps.tiers[tier]) return { status: "failed", summary: `there is no ${tier} tier; the game has ${Object.keys(caps.tiers).join(", ")}` };
  // The layout as this game and tier can build it: a piece it lacks substituted (a wall for a window) or left out,
  // with a note, unless strict.
  const fitted = adapt(laid.pieces, caps, tier, args.strict === true);
  if (fitted.problems.length) return { status: "failed", summary: `the ${name} cannot be built in ${tier} here: ${fitted.problems.join("; ")}`, data: { reason: "tier", problems: fitted.problems } };
  const notes = fitted.notes;
  // Extending a base (named by its id or any piece of it): the layout laid on the base's own grid, its [0, 0] at the
  // base's cell at_cell, or flush against the base's side `side` (a side of the world: n, e, s, w).
  const extend = typeof args.base === "string" ? args.base : null;
  if (extend && !p.base) {
    const seen = yield* survey(ctx, extend);
    if (!seen?.base || !seen.frame) return { status: "failed", summary: `I can't find the base ${extend}: give the id of the base or of any piece of it (a door, a wall)`, data: { reason: "base" } };
    p.base = seen.base;
    p.grid = seen.frame;
    let off: [number, number] = Array.isArray(args.at_cell) ? (args.at_cell as [number, number]) : [0, 0];
    if (typeof args.side === "string" && args.side in TURNS && !Array.isArray(args.at_cell)) {
      // The base's footprint on its grid (its ground floors, else every piece), and the side asked on that grid.
      const floors = seen.pieces.filter((x) => x.level === 0 && caps.forms?.find((f) => f.form === x.form)?.place === "floor");
      const cells = (floors.length ? floors : seen.pieces).map((x) => x.cell);
      const [bi0, bj0, bi1, bj1] = [Math.min(...cells.map((c) => c[0])), Math.min(...cells.map((c) => c[1])), Math.max(...cells.map((c) => c[0])), Math.max(...cells.map((c) => c[1]))];
      const [i0, j0, i1, j1] = laid.bounds;
      const side = SIDES[(SIDES.indexOf(args.side as Side) - seen.frame.turns + 4) % 4]!;
      off = side === "e" ? [bi1 + 1 - i0, bj0 - j0] : side === "w" ? [bi0 - 1 - i1, bj0 - j0] : side === "s" ? [bi0 - i0, bj1 + 1 - j0] : [bi0 - i0, bj0 - 1 - j1];
    }
    p.off = off;
  }
  const off = (p.off as [number, number] | undefined) ?? [0, 0];
  // Where on the grid the layout lies once moved: its footprint, from which the stand spots are found.
  const bounds: [number, number, number, number] = [laid.bounds[0] + off[0], laid.bounds[1] + off[1], laid.bounds[2] + off[0], laid.bounds[3] + off[1]];
  const pieces: PlanPiece[] = fitted.pieces.map((x) => ({ ...x, cell: [x.cell[0] + off[0], x.cell[1] + off[1]] as [number, number] }));
  if (pieces.length > 400) return { status: "failed", summary: `${pieces.length} pieces is more than one build: split it` };

  // Where: asked for, or where it was put before, or in front of the character with its front facing back to it.
  const half = [((bounds[2] - bounds[0] + 1) * caps.cell) / 2, ((bounds[3] - bounds[1] + 1) * caps.cell) / 2];
  const turns = typeof args.facing === "string" && args.facing in TURNS ? TURNS[args.facing as Side] : TURNS[facing((b.self?.yaw ?? 0) + Math.PI)];
  const centreCell: [number, number] = [((bounds[0] + bounds[2]) / 2) * caps.cell, ((bounds[1] + bounds[3]) / 2) * caps.cell];
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
  // Converging: a piece of another form where the layout wants one (a wall where a doorframe goes) is taken down first.
  if (args.replace === true && !p.replaced) {
    // Only standing pieces (by their ids), not pieces of this plan taking each other's place.
    const ids = [...new Set(verdict.verdicts.filter((v) => v.status === "occupied" && /^s:?\d+$/.test(v.by ?? "")).map((v) => v.by!))];
    if (ids.length) {
      const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "plan", op: "remove", plan: plan(grid), ids }], "swap pieces"), ids.length * 3000 + 5000);
      const removed = ((o?.detail as { removed?: string[] } | undefined)?.removed ?? []).length;
      notes.push(`swapped ${removed} piece${removed === 1 ? "" : "s"} for what the layout wants`);
      p.replaced = true;
      verdict = (yield* check(grid)) ?? verdict;
    }
  }
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
  const gt = grid.turns;
  const [cx, cz] = [grid.at[0] + rot(centreCell[0], centreCell[1], gt)[0], grid.at[1] + rot(centreCell[0], centreCell[1], gt)[1]];
  const at = `${Math.round(cx)}, ${Math.round(cz)}, front facing ${["south", "west", "north", "east"][gt]}`;

  // The bill: the pieces still to place against the bag, and what crafting the rest takes.
  const missing: Record<string, number> = {};
  for (const [item, n] of Object.entries(verdict.need)) if (n > b.count(item)) missing[item] = n - b.count(item);
  const bill: Record<string, number> = {};
  for (const [item, n] of Object.entries(missing)) {
    const r = b.inventory?.craftable.find((x) => x.item === item);
    if (!r) return { status: "failed", summary: `I can't craft ${item}`, data: { reason: "recipe", item } };
    for (const [m, k] of Object.entries(r.needs)) bill[m] = (bill[m] ?? 0) + k * n;
  }
  let short = Object.entries(bill).filter(([m, k]) => b.count(m) < k);
  // Short: what the stores about hold is fetched first (as a builder pulls from the boxes near).
  if (short.length && !args.check && stores(b).length && !p.fetched) {
    p.fetched = true;
    yield* fetch(ctx, bill);
    short = Object.entries(bill).filter(([m, k]) => b.count(m) < k);
  }
  if (args.check) {
    return {
      status: "done",
      summary: `the ${name} (${tier}) fits at ${at}: ${pieces.length} pieces (${tally(pieces)}), ${pieces.length - todo} already built; ${Object.keys(missing).length ? `to craft: ${Object.entries(missing).map(([i, n]) => `${n} ${i}`).join(", ")}, taking ${Object.entries(bill).map(([m, k]) => `${k} ${m}`).join(", ")}` : "every piece is in the bag"}${short.length ? `; short of ${short.map(([m, k]) => `${k - b.count(m)} ${m}`).join(", ")}` : ""}${notes.length ? `. Note: ${notes.join("; ")}` : ""}`,
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
  const fp = footprint(grid, bounds, caps);
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
    // A piece nothing else stands on (a door, a gate, a railing, a thing set down) that will not go: left out and told
    // at the end, and the rest goes on.
    if (SKIPPABLE.has(caps.forms?.find((f) => f.form === x.form)?.place ?? (x.form === "thing" ? "thing" : "")) || x.form === "railing") {
      ((p.skipped ??= []) as string[]).push(`the ${x.form === "thing" ? x.item : x.form} at cell ${x.cell.join(",")}: ${d.reason ?? o.code ?? o.status}${d.by ? ` (${d.by})` : ""}`);
      p.next = start = reached + 1;
      continue;
    }
    return {
      status: "blocked",
      summary: `the ${name} stopped at piece ${reached} of ${pieces.length}: the ${x.form} at cell ${x.cell.join(",")}${x.side ? ` ${x.side} side` : ""} storey ${x.level}: ${d.reason ?? o.code ?? o.status}${d.by ? ` (${d.by})` : ""}`,
      data: { reason: d.reason ?? "blocked", by: d.by, piece: x, next: reached },
    };
  }
  ctx.body.stop("built");
  const skipped = (p.skipped ?? []) as string[];
  return {
    status: "done",
    summary: `built the ${name} (${tier}) at ${at}: ${pieces.length - skipped.length} pieces (${tally(pieces)}), base ${p.base ?? "?"}${skipped.length ? `; left out ${skipped.join("; ")}` : ""}${notes.length ? `. Note: ${notes.join("; ")}` : ""}`,
    data: { base: p.base, pieces: pieces.length, skipped, notes },
  };
}

interface Surveyed {
  pieces: (PlanPiece & { id: string; health: number })[];
  base: string | null;
  frame?: Grid;
}

function* survey(ctx: SkillContext, base: string): Run<Surveyed | null> {
  const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "plan", op: "survey", plan: { anchor: { base }, pieces: [] } }], "survey"), 3000);
  return (o?.detail as Surveyed | undefined) ?? null;
}

/** The order to take pieces down in: what nothing stands on first (things, doors), then from the top storey down,
 * edges before the floors they stand on. */
function downOrder(pieces: Surveyed["pieces"], caps: Building): Surveyed["pieces"] {
  const place = (f: string) => caps.forms?.find((x) => x.form === f)?.place ?? (f === "thing" ? "thing" : "edge");
  const rank = (p: PlanPiece) => ({ thing: 0, in_frame: 1, centre: 2, edge: 3, edge_top: 3, corner: 4, floor: 5 })[place(p.form)] ?? 3;
  return [...pieces].sort((a, b) => b.level - a.level || rank(a) - rank(b));
}

/** Takes a base down (or the pieces named): picked up whole while the game allows, else demolished for part. */
export function* dismantle(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const caps = ctx.belief.building;
  if (!caps) return { status: "failed", summary: "this game has no build helper" };
  const base = String(args.base ?? "");
  const seen = yield* survey(ctx, base);
  if (!seen?.base) return { status: "failed", summary: `I can't find the base ${base}` };
  const named = Array.isArray(args.ids) ? (args.ids as string[]) : null;
  const keepThings = args.keep_things === true;
  const doomed = downOrder(seen.pieces, caps).filter((p) => (named ? named.includes(p.id) : !(keepThings && p.form === "thing")));
  if (!doomed.length) return { status: "done", summary: "nothing to take down" };
  const removed: string[] = [], refused: Record<string, string> = {};
  for (let k = 0; k < doomed.length; k += 20) {
    const ids = doomed.slice(k, k + 20).map((p) => p.id);
    const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "plan", op: "remove", plan: { anchor: { base }, pieces: [] }, ids }], "take down"), ids.length * 3000 + 5000);
    const d = (o?.detail ?? {}) as { removed?: string[]; refused?: Record<string, string> };
    removed.push(...(d.removed ?? []));
    Object.assign(refused, d.refused ?? {});
  }
  const left = Object.keys(refused).length;
  return {
    status: left ? "blocked" : "done",
    summary: `took down ${removed.length} piece${removed.length === 1 ? "" : "s"} of ${base}${left ? `; ${left} would not come down (${Object.values(refused).slice(0, 2).join("; ")})` : ""}`,
    data: { removed: removed.length, refused },
  };
}

/** Reads a standing base back as a layout (its pieces as they stand, on its grid), kept by a name to build again. */
export function* capture(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief;
  const base = String(args.base ?? "");
  const seen = yield* survey(ctx, base);
  if (!seen?.base || !seen.pieces.length) return { status: "failed", summary: `I can't find the base ${base}` };
  // Its tier: the one most of its pieces are in.
  const tiers = new Map<string, number>();
  for (const p of seen.pieces) {
    const t = /_([a-z]+)$/.exec(p.item)?.[1];
    if (t && b.building?.tiers[t]) tiers.set(t, (tiers.get(t) ?? 0) + 1);
  }
  const tier = [...tiers].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "wood";
  const name = typeof args.name === "string" && args.name ? args.name : `base_${base.replace(/\W/g, "")}`;
  const extra = seen.pieces.map(({ id: _id, health: _health, item, ...p }) => (p.form === "thing" ? { ...p, item: item.replace(/^piece_/, "") } : p));
  b.layouts[name] = { name, about: `captured from ${base}`, tier, rooms: [], extra };
  return { status: "done", summary: `captured ${base} as ${name}: ${seen.pieces.length} pieces (${tally(seen.pieces)}), ${tier}; game_do build {"blueprint": "${name}"} builds it again`, data: { name, pieces: seen.pieces.length } };
}
