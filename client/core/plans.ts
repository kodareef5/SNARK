// The plans this session's tribe has standing, as the server tells them (S_PLAN, S_PLAN_GONE), and its answer to a
// paste (S_PLAN_REPORT). A plan is no row: it is kept here, beside the world, and drawn as holograms (hammer.ts). A
// piece in hand that fits a hologram looked at is offered that hologram's slot (PlanSlots).

import type { Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { PLAN_COOLDOWN, PLAN_OK, PLAN_REASONS, makePlanReport, readPlanReport, type PlanReport } from "../../shared/net/plan.ts";
import { S_PLAN, S_PLAN_GONE, S_PLAN_REPORT } from "../../shared/net/protocol.ts";
import { BLUEPRINT_PIECES_MOST } from "../../shared/world/blueprint.ts";
import { poseOf, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { makeVerdict, validatePlan, type Site, type Verdict } from "../../shared/world/lattice/place.ts";
import { CellIndex, PLAN_FILL_REACH, filledAt, pieceBook, placePlan, planFrame, readPlan, type Placed, type PlanRecord } from "../../shared/world/plan.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import { Support } from "../../shared/world/support.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { messages } from "./readers.ts";
import type { ClientSession } from "./session.ts";

const U = STRUCT_UNITS;

/** A plan as this client holds it: the server's record, its pieces as keys, and where each stands. */
export interface PlanView {
  record: PlanRecord;
  placed: Placed;
  cells: CellIndex;
  /** Each piece's place in metres and its yaw in wire units. */
  x: Float64Array;
  y: Float32Array;
  z: Float64Array;
  yaw: Uint16Array;
  tw: Uint8Array;
  /** A bit a piece still to be built, as `open` last worked it out, and the rows and filled bits it was worked out from. */
  live: Uint8Array;
  liveShapes: number;
  liveFilled: Uint8Array | null;
}

const pose: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };

/** Works out where each piece of a plan stands: its frame's pose is the record's, made or not. */
function settle(structs: StructureStore, reg: Registry, v: PlanView): void {
  const f = planFrame(structs, v.record);
  const { placed } = v;
  for (let i = 0; i < placed.n; i++) {
    poseOf(f, placed.k0[i]!, placed.k1[i]!, reg.forms, placed.kind[i]!, pose);
    v.x[i] = pose.x / U;
    v.y[i] = pose.y / U;
    v.z[i] = pose.z / U;
    v.yaw[i] = pose.yaw;
    v.tw[i] = pose.tw;
  }
}

export function makeView(structs: StructureStore, reg: Registry, record: PlanRecord, placed: Placed): PlanView {
  const n = placed.n;
  const v: PlanView = { record, placed, cells: new CellIndex(placed), x: new Float64Array(n), y: new Float32Array(n), z: new Float64Array(n), yaw: new Uint16Array(n), tw: new Uint8Array(n), live: new Uint8Array(Math.ceil(n / 8)), liveShapes: -1, liveFilled: null };
  settle(structs, reg, v);
  return v;
}

/**
 * Whether a piece of a plan is still to be built, as this client sees it: not filled, and no row on its key. Worked out
 * for the whole plan when a row has come or gone or the server has told its filled pieces, and read from that after.
 */
export function open(structs: StructureStore, v: PlanView, i: number): boolean {
  if (v.liveShapes !== structs.shapes || v.liveFilled !== v.record.filled) {
    v.liveShapes = structs.shapes;
    v.liveFilled = v.record.filled;
    v.live.fill(0);
    const fr = v.record.fr;
    for (let k = 0; k < v.placed.n; k++) {
      if (filledAt(v.record.filled, k) || (fr !== 0 && structs.occupied.at(fr, v.placed.k0[k]!, v.placed.k1[k]!) >= 0)) continue;
      v.live[k >> 3] = v.live[k >> 3]! | (1 << (k & 7));
    }
  }
  return (v.live[i >> 3]! & (1 << (i & 7))) !== 0;
}

/** The plans a session has been told of, and the server's last answer to a paste. */
export class PlanViews {
  readonly plans = new Map<number, PlanView>();
  /** Bumped when a plan comes, changes or goes. */
  revision = 0;
  /** The last report, and how many have come. */
  readonly report: PlanReport = makePlanReport();
  reports = 0;
  /** Called with each report as it comes. */
  onReport: ((r: PlanReport) => void) | null = null;
  /** Bytes of S_PLAN read. */
  bytes = 0;
}

const views = new WeakMap<ClientSession, PlanViews>();

export function plansOf(session: ClientSession): PlanViews {
  let v = views.get(session);
  if (!v) views.set(session, (v = new PlanViews()));
  return v;
}

/** What the server said of a paste, for a player. */
export function reportWords(r: PlanReport): string {
  if (r.code === PLAN_OK) return `Plan set: ${r.fine} to build${r.built > 0 ? `, ${r.built} built already` : ""}${r.blocked > 0 ? `, ${r.blocked} blocked` : ""}${r.unsupported > 0 ? `, ${r.unsupported} with nothing to hold them` : ""}`;
  if (r.code === PLAN_COOLDOWN && r.wait > 0) return `Wait ${Math.ceil(r.wait / 30)} s before setting down another plan`;
  return PLAN_REASONS[r.code] ?? "The plan was refused";
}

messages.add({
  kind: S_PLAN,
  read(s, r) {
    const start = r.remainingBits;
    const id = r.varint();
    const whole = r.bool();
    const all = plansOf(s);
    const world = s.world;
    if (!world) return;
    if (!whole) {
      const filled = r.blob(BLUEPRINT_PIECES_MOST / 8 + 1);
      const v = all.plans.get(id);
      if (r.overflow || !v || filled.length !== v.record.filled.length) return;
      v.record.filled = filled;
    } else {
      const record = readPlan(r);
      if (!record || record.id !== id) return;
      const read = placePlan(pieceBook(s.registry), record.bytes, record.mirror, record.turn, [record.m0, record.m1, record.m2, record.m3], record.lvl);
      if (!read.ok) return;
      all.plans.set(id, makeView(world.structs, s.registry, record, read.placed));
    }
    all.bytes += (start - r.remainingBits + 15) >> 3;
    all.revision++;
  },
});

messages.add({
  kind: S_PLAN_GONE,
  read(s, r) {
    const id = r.varint();
    const all = plansOf(s);
    if (!r.overflow && all.plans.delete(id)) all.revision++;
  },
});

messages.add({
  kind: S_PLAN_REPORT,
  read(s, r) {
    const all = plansOf(s);
    if (!readPlanReport(r, all.report)) return;
    all.reports++;
    all.onReport?.(all.report);
  },
});

/** A plan's piece a held piece could fill, as the builder shows it. */
export interface PlanSlot {
  plan: number;
  index: number;
  kind: number;
  /** RESULT_OK, or why it may not go there yet. */
  problem: number;
  readonly verdict: Verdict;
}

/** Metres a look may pass from a hologram's middle and still be on it. */
const ON = 0.9;

/**
 * Finds the hologram a builder is looking at that one of the forms in hand would fill, and judges it as the server will:
 * nothing built need offer the slot, but the piece must stand there now.
 */
export class PlanSlots {
  private site: Site | null = null;
  private readonly slot: PlanSlot = { plan: 0, index: 0, kind: 0, problem: 0, verdict: makeVerdict() };

  private siteFor(world: CollisionWorld, reg: Registry): Site {
    if (this.site?.structs === world.structs) return this.site;
    const structs = world.structs;
    const heightAt = (x: number, z: number): number => world.hf.heightAt(x, z);
    const support = new Support(structs, reg, heightAt);
    return (this.site = {
      structs,
      tables: reg,
      heightAt,
      standsAt: (kind, fr, k0, k1) => {
        const form = reg.forms.def[kind]!;
        if (!structs.frames.get(fr)) return form.root === "always";
        const stability = support.stabilityAt(kind, fr, k0, k1);
        return stability >= 0 && stability >= (form.need ?? 0);
      },
    });
  }

  /**
   * The open piece of a plan nearest the look's line, within `reach` metres of the eye along it, whose kind is one of
   * `forms`; or null. The eye is at (ox, oy, oz) and looks along the unit direction (dx, dy, dz).
   */
  find(session: ClientSession, world: CollisionWorld, reg: Registry, forms: ArrayLike<number>, team: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number): PlanSlot | null {
    const all = plansOf(session);
    if (all.plans.size === 0) return null;
    const structs = world.structs;
    let best = ON * ON;
    let found: PlanView | null = null;
    let at = -1;
    for (const v of all.plans.values()) {
      if (v.record.team !== team) continue;
      const { placed } = v;
      for (let i = 0; i < placed.n; i++) {
        let fits = false;
        for (let k = 0; k < forms.length && !fits; k++) fits = forms[k] === placed.kind[i];
        if (!fits) continue;
        const px = v.x[i]! - ox, py = v.y[i]! - oy, pz = v.z[i]! - oz;
        const along = px * dx + py * dy + pz * dz;
        if (along < 0 || along > reach + 1.5) continue;
        const off = px * px + py * py + pz * pz - along * along;
        if (off >= best || !open(structs, v, i)) continue;
        best = off;
        found = v;
        at = i;
      }
    }
    if (!found) return null;
    const slot = this.slot;
    slot.plan = found.record.id;
    slot.index = at;
    slot.kind = found.placed.kind[at]!;
    slot.problem = validatePlan(this.siteFor(world, reg), slot.kind, team, planFrame(structs, found.record), found.placed.k0[at]!, found.placed.k1[at]!, ox, oy, oz, slot.verdict, PLAN_FILL_REACH);
    return slot;
  }
}
