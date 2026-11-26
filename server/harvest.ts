// The server keeps only the nodes that were touched: the hits each has left and, once it is used up, the tick it grows back.
// That is saved per chunk, and clients are sent the used-up slots. Everything else about nodes comes from the map on both sides.

import type { CreatureHarvestFacet, ItemDef, NodeDef } from "../shared/content/defs.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import { BitReader, BitWriter } from "../shared/net/codec.ts";
import { S_NODES } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { GAME_HOUR_TICKS } from "../shared/sim/lazy.ts";
import { leftAtPeriod } from "../shared/sim/breeding.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { chunkCount, chunkCx, chunkCz, TICK_RATE } from "../shared/coords.ts";
import type { NodeField, NodeSpot, NodeSource } from "../shared/world/nodes.ts";
import { HIT_NODE, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import { ROLE_FOUNDATION, ROLE_PILLAR } from "../shared/world/snap.ts";
import { Found } from "../shared/world/structures.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import { XP_HARVEST, type Progression } from "./progression.ts";
import type { Lists } from "./settings/lists.ts";
import type { Rules } from "./settings/rules.ts";
import type { EntityRecord, Records } from "./records.ts";
import { STAT_MELEE, statOf } from "./survival.ts";
import type { ServerWorld } from "./world.ts";
import { event } from "./events/bus.ts";
import { TreeClearance } from "./tree-clearance.ts";

/** The chunk blobs that hold used-up nodes. */
export const TAG_NODES = 2;
/** Metres from the eye, for picking with the use key. */
const REACH = 3.5;
/**
 * Metres. A node does not grow back while a survivor is this close, nor a foundation or a pillar, which is what the reference
 * game counts as built. It tries again after RETRY_TICKS. Counted from as far as its boxes reach from its middle, so a banyan
 * does not grow its outer trunks round someone standing among them.
 */
const CROWDED = 12;
const RETRY_TICKS = 30 * TICK_RATE;
/**
 * Chunks round a body's within which a client is told which nodes are used up, whatever its tier: the most a tier's near
 * field holds (ultra's 5, client/core/assets/tiers.ts) and one more, as a client's body crosses into a chunk before the
 * server's does.
 */
export const NODES_TOLD = 6;

const NODE_HARVESTED = 0, NODE_CRUSHED = 1;

interface Touched {
  hits: number;
  /** Physical breakage clears the stump as well; harvesting retains the authored depleted form. */
  crushed: boolean;
  /** Tick it grows back, or 0 while it still stands. */
  respawnAt: number;
}

const HARVEST = event("harvest");

export class Harvest {
  readonly field: NodeField;
  /** Per chunk. Changes whenever a node there is used up or grows back. */
  readonly version: Uint32Array;
  /** Chunks to save. */
  readonly dirty = new Set<number>();
  readonly tag = TAG_NODES;
  hits = 0;
  /** Bytes of used-up slots sent, to every client. */
  told = 0;
  /** A node whose boxes reach `reach` from (x, z) grew back in a chunk that is loaded, so a body may now be inside it. */
  onGrown: ((x: number, z: number, reach: number) => void) | null = null;

  private readonly world: ServerWorld;
  private readonly game: GameServer;
  private readonly records: Records;
  private readonly items: Items;
  private readonly progression: Progression;
  private readonly deadlines: DeadlineHeap;
  private readonly touched = new Map<number, Touched>();
  rules: Rules | null = null;
  lists: Lists | null = null;
  private readonly rng: Rng;
  private readonly dir = [0, 0, 0];
  private readonly spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  private readonly per: number;
  private readonly found = new Found();
  private readonly clearance: TreeClearance;
  /** Its kind in the deadline heap. */
  private readonly deadline: number;

  constructor(world: ServerWorld, game: GameServer, records: Records, items: Items, progression: Progression, deadlines: DeadlineHeap, seed: number) {
    this.world = world; this.clearance = new TreeClearance(world);
    this.game = game;
    this.records = records;
    this.items = items;
    this.progression = progression;
    this.deadlines = deadlines;
    this.deadline = deadlines.kind("node", (a, stamp) => this.due(a, stamp));
    this.field = world.nodeField!;
    this.per = this.field.source.perChunk;
    // Send an explicit initial empty state too: an observer can then distinguish its first witnessed
    // break from depletion that predated joining, and must not replay old break sounds or particles.
    this.version = new Uint32Array(chunkCount(world.dims)).fill(1);
    this.rng = new Rng(seed);
    world.unloaded!.usedUp = (chunk, index) => this.regrowsAt(chunk, index) > 0;
    world.unloaded!.crushed = (chunk, index) => this.crushed(chunk, index);
  }

  private key(chunk: number, index: number): number {
    return chunk * 256 + index;
  }

  /** A focus entered (delta 1) or left (delta -1) the chunks within `radius` of `center`. */
  retain(center: number, radius: number, delta: number, source?: NodeSource): void {
    this.field.retain(
      center,
      radius,
      delta,
      (chunk, index) => (this.touched.get(this.key(chunk, index))?.respawnAt ?? 0) > 0,
      (chunk, index) => this.touched.get(this.key(chunk, index))?.hits ?? -1,
      (chunk, index) => this.crushed(chunk, index),
      source,
    );
  }

  get goneCount(): number {
    let n = 0;
    for (const t of this.touched.values()) if (t.respawnAt > 0) n++;
    return n;
  }

  /** The node the body looks at within REACH, as chunk * 256 + slot, or -1. */
  target(c: Client): number {
    const ents = this.world.ents;
    const e = c.ent;
    const d = this.dir;
    lookDirection(c.heldYaw, c.heldPitch, d);
    const eye = stanceEye(this.world.reg.move[ents.kind[e]!]!, ents.stance[e]!);
    if (castWorld(this.world, ents.x[e]!, ents.y[e]! + eye, ents.z[e]!, d[0]!, d[1]!, d[2]!, REACH) !== HIT_NODE) return -1;
    return Math.floor(rayHit.ref / 65536) * 256 + (rayHit.ref & 0xffff);
  }

  /** A swing landed on this node (server/combat.ts found it). Returns true if that did anything. */
  struck(c: Client, chunk: number, index: number): boolean {
    return this.hit(this.records.byPid.get(c.pid), chunk, index, false);
  }

  /** The use key picks the bush the body looks at. Returns true if one was picked. */
  pick(c: Client): boolean {
    const at = this.target(c);
    return at >= 0 && this.hit(this.records.byPid.get(c.pid), at >> 8, at & 255, true);
  }

  /** For load tests. Strikes or picks the node, whichever it takes. Play goes through a swing and `pick`. */
  strike(c: Client, chunk: number, index: number): boolean {
    const kind = this.field.standing(chunk, index);
    return kind !== 0 && this.hit(this.records.byPid.get(c.pid), chunk, index, (this.world.reg.defs[kind] as NodeDef).material === undefined);
  }

  /** Physical destruction uses the same depletion/save/regrowth feed, without items, XP or harvesting callbacks.
   * The map source also identifies an untouched tree in a chunk that no survivor has loaded. */
  breakTree(chunk: number, index: number): boolean {
    if (!Number.isInteger(chunk) || chunk < 0 || chunk >= this.version.length || !Number.isInteger(index) || index < 0 || index >= this.per) return false;
    const kind = this.field.kindAt(chunk, index), def = this.world.reg.defs[kind];
    if (def?.type !== "node" || def.material !== "wood") return false;
    const prior = this.touched.get(this.key(chunk, index));
    if (prior?.respawnAt) {
      this.field.source.at(chunk, index, this.spot);
      if (prior.crushed || !this.field.forms.left[this.spot.form]) return false;
      prior.crushed = true; this.field.set(chunk, index, false, true); this.dirty.add(chunk);
      this.version[chunk] = this.version[chunk]! + 1; return true;
    }
    this.deplete(chunk, index, def, true); return true;
  }

  /**
   * An authoritative creature attack met this node. Combat owns reach, obstruction and once-per-action node dedup;
   * this method owns eligibility, yields and depletion. "plant" is a node with no material (picked by humans).
   * Damage is depletion units at 100% melee, not combat health points; power multiplies non-flat resource rolls.
   */
  creature(rec: EntityRecord, chunk: number, index: number, profile: CreatureHarvestFacet): boolean {
    const { reg, ents } = this.world;
    const def = reg.defs[rec.kind];
    const e = this.records.entOf.get(rec.pid);
    if (rec.dead || rec.out || rec.team === 0 || this.records.byPid.get(rec.pid) !== rec || e === undefined || (ents.flags[e]! & F_ALIVE) === 0 || def?.type !== "species" || def.class !== "creature") return false;
    if (!Number.isInteger(chunk) || chunk < 0 || chunk >= this.version.length || !Number.isInteger(index) || index < 0 || index >= this.per) return false;
    const kind = this.field.standing(chunk, index);
    if (kind === 0 || !this.field.store.chunks[chunk]) return false;
    const node = reg.defs[kind] as NodeDef;
    if (!profile.materials.includes(node.material ?? "plant") || !(profile.damage > 0) || !Number.isFinite(profile.damage) || !(profile.power >= 0) || !Number.isFinite(profile.power)) return false;
    const force = profile.damage * statOf(def, rec.genome, STAT_MELEE, 1) * (this.rules?.num("DinoHarvestingDamageMultiplier") ?? 1);
    return this.gather(rec, chunk, index, profile.power, force, -1, profile);
  }

  /** A mounted browser shares the same node, loot and regrowth state as a survivor picking the bush. */
  browse(mount: EntityRecord, chunk: number, index: number): boolean {
    return this.hit(mount, chunk, index, true);
  }

  private hit(rec: EntityRecord | undefined, chunk: number, index: number, byHand: boolean): boolean {
    const world = this.world;
    const reg = world.reg;
    const table = this.field.store.chunks[chunk];
    // What is left of a used-up node stands in its slot, and gives nothing.
    const kind = this.field.standing(chunk, index);
    if (!table || kind === 0 || !rec) return false;
    const def = reg.defs[kind] as NodeDef;
    // A node with no material is a bush, picked by hand. Trees and rocks are struck.
    if (byHand !== (def.material === undefined)) return false;

    let power = 1;
    let toolSlot = -1;
    const inv = this.items.inv(rec);
    const held = inv.hotbar >= 0 && rec.held >= 0 ? inv.hotbar + rec.held : -1;
    if (def.material !== undefined && held >= 0 && inv.item[held] !== 0 && inv.dur[held]! > 0) {
      const tool = (reg.defs[inv.item[held]!] as ItemDef).tool;
      if (tool && tool.on === def.material) {
        power = tool.power;
        toolSlot = held;
      }
    }
    const rules = this.rules;
    const force = byHand || !rules ? 1 : rules.num("PlayerHarvestingDamageMultiplier");
    return this.gather(rec, chunk, index, power, force, toolSlot);
  }

  /** Shared human/creature yield, XP, depletion and respawn accounting. A creature has no held tool to wear. */
  private gather(rec: EntityRecord, chunk: number, index: number, power: number, force: number, toolSlot: number, profile?: CreatureHarvestFacet): boolean {
    const world = this.world, reg = world.reg, rules = this.rules;
    const table = this.field.store.chunks[chunk]!;
    const def = reg.defs[this.field.standing(chunk, index)] as NodeDef;
    // A fractional multiplier lands its extra blow by chance, so 0.5 is one blow in two swings.
    const part = force - Math.floor(force);
    let blows = Math.floor(force) + (part > 0 && this.rng.float() < part ? 1 : 0);
    if (blows > table.hp[index]!) blows = table.hp[index]!;
    if (toolSlot >= 0) this.items.wear(rec, toolSlot, 1);
    if (blows === 0) return true;
    const amount = rules ? rules.num("HarvestAmountMultiplier") : 1;
    const each = this.lists?.multipliers("HarvestResourceItemAmountClassMultipliers");
    for (const y of def.yields) {
      if (y.tool && toolSlot < 0 && !profile) continue;
      const item = reg.index.get(y.item)!;
      let n = 0;
      for (let b = 0; b < blows; b++) n += (y.min + this.rng.int(y.max - y.min + 1)) * (y.flat ? 1 : power);
      n = Math.round(n * amount * (each?.get(item) ?? 1) * (profile?.yields?.find((entry) => entry.item === y.item)?.mult ?? 1));
      const got = n > 0 ? this.items.mint(rec, item, n, 0, 0, -1, "harvest") : 0;
      if (got > 0) this.items.bus.after(HARVEST, { pid: rec.pid, node: def.id, item: y.item, n: got });
    }
    this.progression.addXp(rec, def.xp * blows, XP_HARVEST);
    this.hits++;

    const left = table.hp[index]! - blows;
    const k = this.key(chunk, index);
    this.dirty.add(chunk);
    if (left > 0) {
      table.hp[index] = left;
      this.touched.set(k, { hits: left, respawnAt: 0, crushed: false });
      return true;
    }
    this.deplete(chunk, index, def);
    return true;
  }

  private deplete(chunk: number, index: number, def: NodeDef, crushed = false): void {
    const k = this.key(chunk, index);
    const respawnAt = this.world.tick + Math.max(1, Math.round(def.respawnHours * GAME_HOUR_TICKS * (this.rules ? this.rules.num("ResourcesRespawnPeriodMultiplier") : 1)));
    this.touched.set(k, { hits: 0, respawnAt, crushed });
    this.dirty.add(chunk);
    this.field.set(chunk, index, false, crushed);
    this.version[chunk] = this.version[chunk]! + 1;
    this.deadlines.push(respawnAt, this.deadline, k, respawnAt);
  }

  /** A deadline of its kind came due. */
  due(key: number, stamp: number): void {
    const t = this.touched.get(key);
    if (!t || t.respawnAt !== stamp) return;
    const chunk = key >> 8;
    const index = key & 255;
    this.field.source.at(chunk, index, this.spot);
    if ((!t.crushed && this.held(this.spot.x, this.spot.z, this.field.store.spread[this.spot.form]!)) || this.clearance.blocked(this.spot, t.crushed)) {
      t.respawnAt = this.world.tick + RETRY_TICKS;
      this.deadlines.push(t.respawnAt, this.deadline, key, t.respawnAt);
      this.dirty.add(chunk);
      return;
    }
    this.touched.delete(key);
    this.field.set(chunk, index, true);
    this.version[chunk] = this.version[chunk]! + 1;
    this.dirty.add(chunk);
    if (this.field.isLoaded(chunk)) this.onGrown?.(this.spot.x, this.spot.z, this.field.store.spread[this.spot.form]!);
  }

  /** Whether a survivor, or a foundation or pillar built there, keeps a node at (x, z) whose boxes reach `reach` from it from growing back. */
  held(x: number, z: number, reach: number): boolean {
    const rules = this.rules;
    const ents = this.world.ents;
    const near = CROWDED * (rules ? rules.num("ResourceNoReplenishRadiusPlayers") : 1) + reach;
    for (const c of this.game.clients) {
      if (!c?.active || c.ent < 0) continue;
      const dx = ents.x[c.ent]! - x;
      const dz = ents.z[c.ent]! - z;
      if (dx * dx + dz * dz < near * near) return true;
    }
    // A free-standing thing (a box, a fire, a bed) does not count, nor a wall or a ceiling by itself.
    const built = CROWDED * (rules ? rules.num("ResourceNoReplenishRadiusStructures") * rules.num("StructurePreventResourceRadiusMultiplier") : 1) + reach;
    const structs = this.world.structs;
    const role = this.world.reg.role;
    const n = structs.query(x - built, z - built, x + built, z + built, this.found);
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      const r = role[t.kind[slot]!];
      if (r !== ROLE_FOUNDATION && r !== ROLE_PILLAR) continue;
      const dx = t.x[slot]! - x;
      const dz = t.z[slot]! - z;
      if (dx * dx + dz * dz < built * built) return true;
    }
    return false;
  }

  /** Marks every chunk with a touched node for saving. */
  all(): void {
    for (const key of this.touched.keys()) this.dirty.add(Math.floor(key / 256));
  }

  /** A chunk's touched nodes for saving, or null if it has none. Layout: count, then slot, remaining hits (or depletion mode) and respawnAt. */
  encode(chunk: number): Uint8Array | null {
    const slots: number[] = [];
    for (let i = 0; i < this.per; i++) if (this.touched.has(this.key(chunk, i))) slots.push(i);
    if (slots.length === 0) return null;
    const w = new BitWriter(8 + slots.length * 12);
    w.varint(slots.length);
    for (const i of slots) {
      const t = this.touched.get(this.key(chunk, i))!;
      w.u8(i);
      // While depleted this field stores the depletion mode; living rows keep remaining hits.
      w.varint(t.respawnAt > 0 ? (t.crushed ? NODE_CRUSHED : NODE_HARVESTED) : t.hits);
      w.uint53(t.respawnAt);
    }
    return w.bytes().slice();
  }

  /** 0 for a node that is not used up. */
  regrowsAt(chunk: number, index: number): number {
    return this.touched.get(this.key(chunk, index))?.respawnAt ?? 0;
  }

  crushed(chunk: number, index: number): boolean {
    return this.touched.get(this.key(chunk, index))?.crushed ?? false;
  }

  /** The respawn multiplier was `was` when these nodes were used up. Rescales the time each has left to the current rule. */
  retime(was: number): void {
    const is = this.rules ? this.rules.num("ResourcesRespawnPeriodMultiplier") : 1;
    const tick = this.world.tick;
    if (was === is || !(was > 0)) return;
    for (const [key, t] of this.touched) {
      if (t.respawnAt <= tick) continue;
      t.respawnAt = tick + leftAtPeriod(t.respawnAt - tick, was, is);
      this.deadlines.push(t.respawnAt, this.deadline, key, t.respawnAt);
      this.dirty.add(Math.floor(key / 256));
    }
  }

  decode(chunk: number, data: Uint8Array): void {
    const r = new BitReader(data);
    for (let n = r.varint(); n > 0 && !r.overflow; n--) {
      const index = r.u8();
      const value = r.varint();
      const respawnAt = r.uint53();
      if (respawnAt > 0 && value !== NODE_HARVESTED && value !== NODE_CRUSHED) throw new Error("invalid saved node depletion mode");
      const crushed = respawnAt > 0 && value === NODE_CRUSHED, hits = respawnAt > 0 ? 0 : value;
      if (r.overflow) return;
      this.touched.set(this.key(chunk, index), { hits, respawnAt, crushed });
      if (respawnAt > 0) {
        this.version[chunk] = this.version[chunk]! + 1;
        this.deadlines.push(respawnAt, this.deadline, this.key(chunk, index), respawnAt);
      }
    }
  }

  /** Sends the used-up slots of each chunk within NODES_TOLD whose version the client does not have. */
  sync(c: Client): void {
    const radius = NODES_TOLD;
    const dims = this.world.dims;
    const focus = this.game.replication.cameraChunk?.(c) ?? c.chunk;
    const cx = chunkCx(dims, focus);
    const cz = chunkCz(dims, focus);
    for (let z = Math.max(0, cz - radius); z <= Math.min(dims.chunksZ - 1, cz + radius); z++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(dims.chunksX - 1, cx + radius); x++) {
        const chunk = z * dims.chunksX + x;
        if (this.version[chunk] === c.nodesKnown[chunk]) continue;
        const w = this.game.begin(S_NODES);
        w.u16(chunk);
        w.u32(this.version[chunk]!);
        // A chunk holds up to 256 nodes, and all of them may be used up, so the count takes more than a byte.
        const at = w.pos;
        w.u16(0);
        let n = 0;
        for (let i = 0; i < this.per; i++) {
          if ((this.touched.get(this.key(chunk, i))?.respawnAt ?? 0) === 0) continue;
          w.u8(i);
          w.bool(this.crushed(chunk, i));
          n++;
        }
        const end = w.pos;
        w.pos = at;
        w.u16(n);
        w.pos = end;
        this.told += w.byteLength;
        this.game.endOwn(c);
        c.nodesKnown[chunk] = this.version[chunk]!;
      }
    }
  }
}
