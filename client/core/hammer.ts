// The template hammer in hand: it copies a base as a template, sets a template down as a plan, and fills a plan from
// what the builder carries. The template being set down follows the look as holograms, joined to a base in reach as a
// foundation beside it would be, or free on open ground, and is judged here as the server will judge it
// (shared/world/plan.ts PlanJudge) before anything is sent.

import type { Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { writeFill } from "../../shared/net/place.ts";
import type { Placed as PlacedAnswer } from "../../shared/net/placed.ts";
import { PLAN_ASKED, PLAN_OK, makePlanCommit, makePlanReport, writePlanCommit, type PlanCommit, type PlanReport } from "../../shared/net/plan.ts";
import { CMD_PLACE, CMD_PLAN_CANCEL, CMD_PLAN_COMMIT, CMD_PLAN_PART, RESULT_BUSY, RESULT_NO_SUPPORT, RESULT_OK, RESULT_RATE, RESULT_SHORT } from "../../shared/net/protocol.ts";
import { nearestColour } from "../../shared/pack/palette.ts";
import { encodeBlueprint, type Blueprint } from "../../shared/world/blueprint.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { Frame, poseOf, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { keyAnchor, keyDir, keyLayer, keyLvl } from "../../shared/world/lattice/module.ts";
import { candidates, makeCandidates, type Site } from "../../shared/world/lattice/place.ts";
import {
  GID_UNMADE,
  PIECE_BUILT,
  PIECE_ENEMY,
  PIECE_FINE,
  PIECE_PLAN,
  PIECE_STATES,
  PIECE_UNSUPPORTED,
  PIECE_WORDS,
  PLAN_PART_BYTES,
  PlanJudge,
  filledAt,
  pieceBook,
  placePieces,
  planCost,
  planFooting,
  planGround,
  spotOf,
  type PieceBook,
  type Placed,
  type PlanAsks,
} from "../../shared/world/plan.ts";
import { HIT_STRUCTURE, HIT_TERRAIN, castWorld, rayHit } from "../../shared/world/ray.ts";
import { BUILD_REACH, ROLE_FOUNDATION, ROLE_PILLAR } from "../../shared/world/snap.ts";
import { Support } from "../../shared/world/support.ts";
import { BUILD_REASONS, ENEMY_FOUNDATION, ENEMY_PILLAR, GHOST_BAD } from "./build.ts";
import { PlanSlots, open, plansOf, reportWords, type PlanView } from "./plans.ts";
import { MAX_HOLOGRAMS } from "./render/packet.ts";
import type { Ghost } from "./render/passes/ghost.ts";
import type { ClientSession } from "./session.ts";
import { Templates, copyBase, copyBox, faultWords } from "./templates.ts";

export { HAMMER_ITEM } from "./editor-load.ts";
import { HAMMER_ITEM } from "./editor-load.ts";
/** Pieces of the template being set down that are judged a frame. */
const JUDGE_FRAME = 240;
/** Parts of an upload sent and not yet answered. */
const PARTS_AT_ONCE = 3;
/** Pieces a fill asks for in one command. */
const FILL_RUN = 32;
/** Milliseconds a fill waits after the server says to slow down, and between two askings for the limits. */
const RATE_MS = 600;
const ASK_MS = 1000;
/** Metres a plan's hologram may be from the look's line, and from the builder, to be the plan the hammer acts on. */
const AIM_OFF = 1.2;
const AIM_FAR = 40;
/** Quarter storeys a copied box reaches up from its lower corner until the arrows say otherwise. */
const BOX_LEVELS = 16;

const U = STRUCT_UNITS;
const lattice: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
const origin = { ox: 0, oy: 0, oz: 0 };
const T = new Int32Array(8);

/** The template being set down, where the look has it now. */
interface Preview {
  blueprint: Blueprint;
  placed: Placed;
  frame: Frame;
  commit: PlanCommit;
  /** What the preview was made of: a change in it makes the preview again. */
  key: string;
  x: Float64Array;
  y: Float32Array;
  z: Float64Array;
  yaw: Uint16Array;
  tw: Uint8Array;
}

interface Upload {
  bytes: Uint8Array;
  commit: PlanCommit;
  /** Offsets still to send, and those sent by the command that carried each. */
  left: number[];
  sent: Map<number, number>;
  commitSeq: number;
  /** Parts and bytes sent, with the commit. */
  messages: number;
  sentBytes: number;
}

interface Fill {
  plan: number;
  from: number;
  seq: number;
  placed: number;
  skipped: number;
  commands: number;
  waitUntil: number;
}

export class Hammer {
  /** The hammer is in hand. */
  active = false;
  readonly templates = new Templates();
  readonly slots = new PlanSlots();
  /** The template being set down, by its place in the list, or -1; and how it is turned. `turn` is quarter turns on a base and steps of 30 degrees on open ground. */
  chosen = -1;
  turn = 0;
  mirror = false;
  raise = 0;
  /** The list of templates is open, with the pointer free; and the row of it chosen. */
  panel = false;
  selected = 0;
  /** The text typed to import, and the last template's text given out. */
  importText = "";
  exported = "";
  /** The structure the look is on, or -1, and the plan whose hologram it is on or that stands nearest, or 0. */
  looked = -1;
  aimedPlan = 0;
  /** The first corner of a box to copy, or -1, and how far up the box reaches. */
  corner = -1;
  boxLevels = BOX_LEVELS;
  /** Words for a moment: what was copied, why not, what the server said. */
  notice = "";
  /** The judge of the template being set down, and whether its place joins a base. */
  readonly judge = new PlanJudge();
  joined = false;
  preview: Preview | null = null;
  /** The limits the server last told (S_PLAN_REPORT), and its last answer to a paste. */
  readonly limits: PlanReport = makePlanReport();
  readonly answer: PlanReport = makePlanReport();
  answered = 0;
  /** A paste on its way, and a fill under way. */
  upload: Upload | null = null;
  filling: Fill | null = null;
  /** What the last upload and the last fill came to, for a test and the debug bar. */
  readonly sent = { messages: 0, bytes: 0, commands: 0, pieces: 0 };
  /** Copies text to the clipboard, where the page can (the shell sets it). */
  copyText: ((text: string) => void) | null = null;
  private noticeUntil = 0;
  private session: ClientSession | null = null;
  private reg: Registry | null = null;
  private book: PieceBook | null = null;
  private item = -1;
  private asks: PlanAsks | null = null;
  private site: Site | null = null;
  private readonly offered = makeCandidates();
  private enemies: number[] = [];
  private judgedKey = "";
  private judgedShapes = -1;
  private askedAt = -Infinity;
  private askedKey = "";
  private nowMs = 0;
  private cancelArmed = 0;
  private cancelAt = 0;
  private skipFrom = new Map<number, number>();
  private colours: [number, number, number] | null = null;
  private far = new Float64Array(0);
  private cut = Infinity;
  private cutAt = -Infinity;
  private wheel = 0;

  /** The eye is at (ox, oy, oz), looking along the unit direction (dx, dy, dz). `yaw` is the body's facing in radians. */
  update(session: ClientSession, world: CollisionWorld, reg: Registry, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, yaw: number, nowMs: number): void {
    this.nowMs = nowMs;
    if (this.session !== session) {
      this.session = session;
      plansOf(session).onReport = (r) => this.report(r);
    }
    if (this.reg !== reg) {
      this.reg = reg;
      this.book = pieceBook(reg);
      this.item = reg.index.get(HAMMER_ITEM) ?? -1;
      this.asks = null;
    }
    if (this.notice !== "" && nowMs >= this.noticeUntil) this.notice = "";
    const inv = session.inventory;
    const slot = inv && inv.hotbar >= 0 && session.held >= 0 ? inv.hotbar + session.held : -1;
    this.active = slot >= 0 && inv!.count[slot]! > 0 && inv!.item[slot] === this.item;
    this.pump(session, nowMs);
    if (!this.active) {
      this.preview = null;
      this.panel = false;
      this.looked = -1;
      this.corner = -1;
      return;
    }
    const hit = castWorld(world, ox, oy, oz, dx, dy, dz, BUILD_REACH);
    this.looked = hit === HIT_STRUCTURE ? rayHit.ref : -1;
    const reach = rayHit.t;
    this.aim(session, world, ox, oy, oz, dx, dy, dz);
    const t = this.chosen >= 0 ? this.templates.list[this.chosen] : undefined;
    const bp = t ? this.templates.blueprint(t, this.book!) : null;
    if (!bp) {
      this.chosen = -1;
      this.preview = null;
      return;
    }
    this.place(session, world, reg, bp, hit, reach, ox, oy, oz, dx, dy, dz, yaw);
    this.judging(session, world, reg, nowMs);
  }

  /** What the shared checks ask of this client, made for the world it is in. */
  private asksFor(session: ClientSession, world: CollisionWorld, reg: Registry): PlanAsks {
    if (this.asks?.site.structs === world.structs) return this.asks;
    const structs = world.structs;
    const heightAt = (x: number, z: number): number => world.hf.heightAt(x, z);
    this.site = { structs, tables: reg, heightAt };
    return (this.asks = {
      site: this.site,
      support: new Support(structs, reg, heightAt),
      enemy: (x, z) => {
        const e = this.enemies;
        for (let i = 0; i < e.length; i += 3) if ((e[i]! - x) * (e[i]! - x) + (e[i + 1]! - z) * (e[i + 1]! - z) < e[i + 2]! * e[i + 2]!) return true;
        return false;
      },
      other: (fr, k0, k1, x, y, z) => {
        const spot = spotOf(x, y, z, keyLayer(k1));
        for (const v of plansOf(session).plans.values()) {
          if (v.record.fr !== 0 && v.record.fr === fr) {
            const i = v.cells.at(k0, k1);
            if (i >= 0 && !filledAt(v.record.filled, i)) return true;
          }
          for (let i = 0; i < v.placed.n; i++) if (!filledAt(v.record.filled, i) && spotOf(v.x[i]!, v.y[i]!, v.z[i]!, keyLayer(v.placed.k1[i]!)) === spot) return true;
        }
        return false;
      },
    });
  }

  /** The other tribes' foundations and pillars that could be too near a piece within `reach` metres of (x, z): x, z and the metres each needs. */
  private scout(world: CollisionWorld, reg: Registry, team: number, x: number, z: number, reach: number): void {
    const out = this.enemies;
    out.length = 0;
    const structs = world.structs;
    const dims = structs.dims;
    const pad = reach + ENEMY_FOUNDATION;
    for (let cz = Math.max(0, Math.floor((z - pad) / 64)); cz <= Math.min(dims.chunksZ - 1, Math.floor((z + pad) / 64)); cz++) {
      for (let cx = Math.max(0, Math.floor((x - pad) / 64)); cx <= Math.min(dims.chunksX - 1, Math.floor((x + pad) / 64)); cx++) {
        const t = structs.chunks[cz * dims.chunksX + cx];
        if (!t) continue;
        for (let s = 0; s < t.high; s++) {
          const owner = t.owner[s]!;
          const role = reg.role[t.kind[s]!]!;
          if (owner === 0 || owner === team || (role !== ROLE_FOUNDATION && role !== ROLE_PILLAR)) continue;
          out.push(t.x[s]!, t.z[s]!, role === ROLE_FOUNDATION ? ENEMY_FOUNDATION : ENEMY_PILLAR);
        }
      }
    }
  }

  /** Works out where the template stands for this look: beside a base that offers its footing a slot, else on the ground looked at. */
  private place(session: ClientSession, world: CollisionWorld, reg: Registry, bp: Blueprint, hit: number, reach: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, yaw: number): void {
    const book = this.book!;
    const forms = reg.forms;
    const team = session.tribe.team;
    this.asksFor(session, world, reg);
    const quarter = ((this.turn % 4) + 4) % 4;
    // On a base the template is turned in the lattice, by quarters: no piece is built at any other turn yet.
    const turned = placePieces(book, bp, this.mirror, quarter * 3, [0, 0, 0, 0], 0);
    let made: Preview | null = null;
    this.joined = false;
    if (turned.ok) {
      const foot = planFooting(forms, turned.placed);
      const kind = turned.placed.kind[foot]!;
      const k0 = turned.placed.k0[foot]!;
      const k1 = turned.placed.k1[foot]!;
      const n = candidates(this.site!, kind, team, ox, oy, oz, dx, dy, dz, reach, this.offered);
      for (let c = 0; c < n && !made; c++) {
        const s0 = this.offered.k0[c]!;
        const s1 = this.offered.k1[c]!;
        if (keyDir(s1) !== keyDir(k1)) continue;
        keyAnchor(s0, s1, T, 0);
        keyAnchor(k0, k1, T, 4);
        const by = [T[0]! - T[4]!, T[1]! - T[5]!, T[2]! - T[6]!, T[3]! - T[7]!];
        const lvl = keyLvl(s1) - keyLvl(k1) + this.raise;
        const fr = this.offered.fr[c]!;
        const key = `j${fr}/${by.join(",")}/${lvl}/${quarter}/${this.mirror}/${this.chosen}`;
        if (this.preview?.key === key) made = this.preview;
        else {
          const moved = placePieces(book, bp, this.mirror, quarter * 3, by, lvl);
          const frame = world.structs.frames.get(fr);
          if (!moved.ok || !frame) continue;
          made = this.shown(reg, bp, moved.placed, frame, { ...makePlanCommit(), fr, m0: by[0]!, m1: by[1]!, m2: by[2]!, m3: by[3]!, lvl, turn: quarter * 3, mirror: this.mirror }, key);
        }
        this.joined = true;
      }
    }
    if (!made && hit === HIT_TERRAIN) {
      // On open ground the template's own frame is turned with the builder, a step of 30 degrees at a time.
      const plain = placePieces(book, bp, this.mirror, 0, [0, 0, 0, 0], 0);
      if (plain.ok) {
        const placed = plain.placed;
        const y = (Math.round((yaw / (2 * Math.PI)) * YAW_UNITS) + Math.round(((((this.turn % 12) + 12) % 12) * YAW_UNITS) / 12)) & (YAW_UNITS - 1);
        // The footing lies where a foundation set down by hand at the look's end would: the frame is the one that puts it there.
        if (planGround(this.site!.heightAt, reg, forms, placed, ox + dx * reach, oz + dz * reach, y, this.raise, origin)) {
          const key = `n${origin.ox}/${origin.oy}/${origin.oz}/${y}/${this.mirror}/${this.chosen}`;
          if (this.preview?.key === key) made = this.preview;
          else made = this.shown(reg, bp, placed, new Frame(GID_UNMADE, origin.ox, origin.oy, origin.oz, y, team), { ...makePlanCommit(), ox: origin.ox, oy: origin.oy, oz: origin.oz, yaw: y, mirror: this.mirror }, key);
        }
      }
    }
    this.preview = made;
  }

  private shown(reg: Registry, blueprint: Blueprint, placed: Placed, frame: Frame, commit: PlanCommit, key: string): Preview {
    const n = placed.n;
    const p: Preview = { blueprint, placed, frame, commit, key, x: new Float64Array(n), y: new Float32Array(n), z: new Float64Array(n), yaw: new Uint16Array(n), tw: new Uint8Array(n) };
    for (let i = 0; i < n; i++) {
      poseOf(frame, placed.k0[i]!, placed.k1[i]!, reg.forms, placed.kind[i]!, lattice);
      p.x[i] = lattice.x / U;
      p.y[i] = lattice.y / U;
      p.z[i] = lattice.z / U;
      p.yaw[i] = lattice.yaw;
      p.tw[i] = lattice.tw;
    }
    return p;
  }

  /** Judges the template where it is shown, a part each frame, and asks the server its limits once the place has stood still. */
  private judging(session: ClientSession, world: CollisionWorld, reg: Registry, nowMs: number): void {
    const p = this.preview;
    if (!p) {
      this.judgedKey = "";
      return;
    }
    const structs = world.structs;
    if (this.judgedKey !== p.key || this.judgedShapes !== structs.shapes) {
      this.judgedKey = p.key;
      this.judgedShapes = structs.shapes;
      let far = 0;
      for (let i = 0; i < p.placed.n; i++) far = Math.max(far, Math.hypot(p.x[i]! - p.x[0]!, p.z[i]! - p.z[0]!));
      this.scout(world, reg, session.tribe.team, p.x[0]!, p.z[0]!, far);
      this.judge.begin(this.book!, p.placed, p.frame, session.tribe.team, this.asksFor(session, world, reg));
    }
    this.judge.step(JUDGE_FRAME);
    if (this.judge.done && this.askedKey !== p.key && nowMs - this.askedAt >= ASK_MS && !this.upload) {
      this.askedKey = p.key;
      this.askedAt = nowMs;
      session.command(CMD_PLAN_COMMIT, (w: BitWriter) => writePlanCommit(w, { ...p.commit, ask: true }));
    }
  }

  /** Finds the plan the hammer acts on: the one with an open piece nearest the look's line, else the nearest in reach. */
  private aim(session: ClientSession, world: CollisionWorld, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): void {
    let best = AIM_OFF * AIM_OFF;
    let near = AIM_FAR * AIM_FAR;
    let aimed = 0;
    let nearest = 0;
    for (const v of plansOf(session).plans.values()) {
      for (let i = 0; i < v.placed.n; i++) {
        const px = v.x[i]! - ox, py = v.y[i]! - oy, pz = v.z[i]! - oz;
        const d2 = px * px + py * py + pz * pz;
        if (d2 > AIM_FAR * AIM_FAR || !open(world.structs, v, i)) continue;
        if (d2 < near) [near, nearest] = [d2, v.record.id];
        const along = px * dx + py * dy + pz * dz;
        if (along > 0 && d2 - along * along < best) [best, aimed] = [d2 - along * along, v.record.id];
      }
    }
    this.aimedPlan = aimed !== 0 ? aimed : nearest;
    if (this.cancelArmed !== 0 && (this.cancelArmed !== this.aimedPlan || this.nowMs - this.cancelAt > 3000)) this.cancelArmed = 0;
  }

  private say(words: string): void {
    this.notice = words;
    this.noticeUntil = this.nowMs + 4000;
  }

  /** The plan the hammer acts on, as this client holds it. */
  get plan(): PlanView | null {
    return this.session && this.aimedPlan !== 0 ? (plansOf(this.session).plans.get(this.aimedPlan) ?? null) : null;
  }

  /** The hammer's first action: sets the template down where it is shown, or copies the base looked at. */
  act(): void {
    if (!this.active || !this.session) return;
    if (this.chosen >= 0) this.setDown();
    else this.copy();
  }

  /** Copies the base the look is on, and keeps it as the first template. */
  copy(): void {
    const s = this.session;
    if (!this.active || !s?.world || !this.book) return;
    if (this.looked < 0) return this.say("Look at a piece of your tribe's base to copy it");
    const got = copyBase(s.world.structs, this.book, this.looked, s.tribe.team, `Base ${this.templates.list.length + 1}`, s.name);
    this.kept(got);
  }

  /** Marks the piece looked at as one corner of a box, and with a corner marked copies what of the base lies between it and the piece looked at. */
  box(): void {
    const s = this.session;
    if (!this.active || !s?.world || !this.book) return;
    if (this.looked < 0) return this.say("Look at a piece of your tribe's base to mark a corner");
    if (this.corner < 0) {
      this.corner = this.looked;
      return this.say("Corner marked: look at the opposite corner and copy the box");
    }
    const got = copyBox(s.world.structs, this.book, this.corner, this.looked, this.boxLevels, s.tribe.team, `Part ${this.templates.list.length + 1}`, s.name);
    this.corner = -1;
    this.kept(got);
  }

  private kept(got: ReturnType<typeof copyBase>): void {
    if (!got.ok) return this.say(got.reason);
    const why = this.templates.add(got.blueprint, this.book!);
    if (why !== "") return this.say(why);
    this.selected = 0;
    if (this.chosen >= 0) this.chosen++;
    this.say(`Copied ${got.blueprint.pieces.length} pieces as "${got.blueprint.name}"`);
  }

  /** Takes template `i` in hand to set down, or puts the one in hand away with -1. */
  choose(i: number): void {
    this.chosen = i >= 0 && i < this.templates.list.length ? i : -1;
    this.turn = this.raise = 0;
    this.mirror = false;
    this.preview = null;
    this.panel = false;
  }

  rotate(by: number): void {
    this.turn += by;
  }

  /** The mouse wheel's notches, which turn the template a step a whole notch. */
  scroll(notches: number): void {
    this.wheel += notches;
    const steps = Math.trunc(this.wheel);
    this.wheel -= steps;
    this.turn += steps;
  }

  flip(): void {
    this.mirror = !this.mirror;
  }

  /** Raises or lowers the template a level, or with a box's corner marked the box's top a storey. */
  lift(by: number): void {
    if (this.chosen < 0 && this.corner >= 0) this.boxLevels = Math.max(0, Math.min(255, this.boxLevels + 4 * by));
    else this.raise += by;
  }

  /** Keeps the template a text holds. */
  takeText(text = this.importText): void {
    if (!this.book) return;
    const why = this.templates.takeText(text, this.book);
    if (why !== "") return this.say(why);
    this.importText = "";
    this.selected = 0;
    if (this.chosen >= 0) this.chosen++;
    this.say(`Imported "${this.templates.list[0]!.name}", ${this.templates.list[0]!.pieces} pieces`);
  }

  /** Gives out template `i`'s text: to the clipboard where the page can, and in the panel's own field. */
  export(i = this.selected): void {
    const t = this.templates.list[i];
    if (!t) return;
    this.exported = t.text;
    this.copyText?.(t.text);
    this.say(this.copyText ? `Copied the text of "${t.name}"` : `The text of "${t.name}" is in the field`);
  }

  remove(i = this.selected): void {
    this.templates.remove(i);
    if (this.chosen === i) this.choose(-1);
    else if (this.chosen > i) this.chosen--;
    this.selected = Math.max(0, Math.min(this.selected, this.templates.list.length - 1));
  }

  /** Sends the template in hand to the server to set down where it is shown: its bytes in parts, then where it stands. */
  setDown(): void {
    const p = this.preview;
    const s = this.session;
    if (!p || !s || !this.book) return this.say("Look at open ground, or at your base, to set the template down");
    if (this.upload) return this.say("The last plan is still on its way");
    const bytes = encodeBlueprint(p.blueprint, this.book.forms);
    if (!bytes.ok) return this.say(faultWords(bytes.fault));
    const left: number[] = [];
    for (let at = bytes.bytes.length - (bytes.bytes.length % PLAN_PART_BYTES || PLAN_PART_BYTES); at >= 0; at -= PLAN_PART_BYTES) left.push(at);
    this.upload = { bytes: bytes.bytes.slice(), commit: { ...p.commit, ask: false }, left, sent: new Map(), commitSeq: 0, messages: 0, sentBytes: 0 };
    this.pump(s, this.nowMs);
  }

  /** Fills the plan the hammer acts on from what the builder carries, a run of pieces a command, until it is done or stops. */
  fill(): void {
    const s = this.session;
    const v = this.plan;
    if (!s || !v) return this.say("No plan of your tribe's is near");
    if (this.filling) {
      this.filling = null;
      return this.say("Stopped filling");
    }
    this.filling = { plan: v.record.id, from: this.skipFrom.get(v.record.id) ?? 0, seq: 0, placed: 0, skipped: 0, commands: 0, waitUntil: 0 };
    this.skipFrom.delete(v.record.id);
    this.pump(s, this.nowMs);
  }

  /** Takes the plan the hammer acts on away. The first press asks, and a second within three seconds does it. */
  cancel(): void {
    const s = this.session;
    const v = this.plan;
    if (!s || !v) return this.say("No plan of your tribe's is near");
    if (this.cancelArmed !== v.record.id) {
      this.cancelArmed = v.record.id;
      this.cancelAt = this.nowMs;
      return this.say("Press again to take the plan away");
    }
    this.cancelArmed = 0;
    if (this.filling?.plan === v.record.id) this.filling = null;
    s.command(CMD_PLAN_CANCEL, (w: BitWriter) => w.varint(v.record.id));
    this.say("Plan taken away");
  }

  /** Sends what is waiting to go: the next parts of an upload, its commit, the next run of a fill. */
  private pump(session: ClientSession, nowMs: number): void {
    const up = this.upload;
    if (up && up.commitSeq === 0) {
      while (up.left.length > 0 && up.sent.size < PARTS_AT_ONCE) {
        const at = up.left[up.left.length - 1]!;
        const part = up.bytes.subarray(at, Math.min(up.bytes.length, at + PLAN_PART_BYTES));
        const seq = session.command(CMD_PLAN_PART, (w: BitWriter) => (w.varint(up.bytes.length), w.varint(at), w.blob(part)));
        if (seq === 0) break;
        up.left.pop();
        up.sent.set(seq, at);
        up.messages++;
        up.sentBytes += part.length + 10;
      }
      if (up.left.length === 0 && up.sent.size === 0) {
        up.commitSeq = session.command(CMD_PLAN_COMMIT, (w: BitWriter) => writePlanCommit(w, up.commit));
        if (up.commitSeq !== 0) {
          up.messages++;
          up.sentBytes += 24;
        }
      }
    }
    const f = this.filling;
    if (f && f.seq === 0 && nowMs >= f.waitUntil) {
      f.seq = session.command(CMD_PLACE, (w: BitWriter) => writeFill(w, f.plan, -1, f.from, FILL_RUN));
      if (f.seq !== 0) f.commands++;
    }
  }

  /** A command's result: a part of an upload that landed or must go again, a commit or a fill the server never judged. */
  result(seq: number, code: number): void {
    const up = this.upload;
    if (up?.sent.has(seq)) {
      const at = up.sent.get(seq)!;
      up.sent.delete(seq);
      if (code === RESULT_BUSY) up.left.push(at);
      else if (code !== RESULT_OK) {
        this.upload = null;
        this.say("The template could not be sent");
      }
      return;
    }
    if (up && seq === up.commitSeq && code !== RESULT_OK) {
      // Busy is the server's queue: the commit goes again, its parts having landed.
      if (code === RESULT_BUSY) up.commitSeq = 0;
      else {
        this.upload = null;
        this.say("The plan could not be set down");
      }
      return;
    }
    const f = this.filling;
    if (f && seq === f.seq) {
      // The answer came first where the fill was judged, and cleared the sequence number: this is a fill that was not.
      f.seq = 0;
      if (code === RESULT_BUSY) f.waitUntil = this.nowMs + RATE_MS;
      else this.filled(code);
    }
  }

  /** The server's answer to a placement. True if it was a fill's of this hammer. */
  placed(p: PlacedAnswer): boolean {
    const f = this.filling;
    if (!f || p.seq !== f.seq) return false;
    f.seq = 0;
    f.placed += p.refs.length;
    f.skipped += p.skipped;
    const size = this.session ? (plansOf(this.session).plans.get(f.plan)?.placed.n ?? 0) : 0;
    if (p.next >= 0) f.from = p.next;
    if (p.code === RESULT_RATE) f.waitUntil = this.nowMs + RATE_MS;
    else if (p.code === RESULT_OK && p.next >= 0 && p.next < size) f.waitUntil = 0;
    else {
      if (p.code === RESULT_NO_SUPPORT && p.next >= 0) this.skipFrom.set(f.plan, p.next + 1);
      this.filled(p.code);
    }
    return true;
  }

  private filled(code: number): void {
    const f = this.filling;
    if (!f) return;
    this.filling = null;
    this.sent.commands = f.commands;
    this.sent.pieces = f.placed;
    const blocked = f.skipped > 0 ? `, ${f.skipped} blocked` : "";
    if (code === RESULT_OK) this.say(`Built ${f.placed} pieces${blocked}`);
    else if (code === RESULT_SHORT) this.say(`Built ${f.placed} pieces${blocked}: you carry no more of what it needs`);
    else if (code === RESULT_NO_SUPPORT) this.say(`Built ${f.placed} pieces${blocked}: nothing would hold the next one up. Fill again to pass over it`);
    else this.say(`Built ${f.placed} pieces${blocked}: ${BUILD_REASONS[code] ?? "it stopped"}`);
  }

  /** S_PLAN_REPORT: the limits asked for, or what became of the paste. */
  private report(r: PlanReport): void {
    const copy = (to: PlanReport): void => {
      Object.assign(to, r, { index: [...r.index], state: [...r.state] });
    };
    if (r.code === PLAN_ASKED) return copy(this.limits);
    copy(this.limits);
    const up = this.upload;
    if (!up || r.seq !== up.commitSeq) return;
    copy(this.answer);
    this.answered++;
    this.sent.messages = up.messages;
    this.sent.bytes = up.sentBytes;
    this.upload = null;
    this.say(reportWords(r));
    if (r.code === PLAN_OK) this.choose(-1);
  }

  /** The lines of the report on the template being set down: what is fine, what is in the way, what it costs, the limits. */
  lines(session: ClientSession, reg: Registry, nameOf: (kind: number) => string): string[] {
    const p = this.preview;
    const j = this.judge;
    if (!p) return this.chosen >= 0 ? ["Look at open ground, or at your base"] : [];
    const out: string[] = [];
    const n = p.placed.n;
    if (!j.done) return [`Checking ${n} pieces`];
    const c = j.counts;
    out.push(`${c[PIECE_FINE]} of ${n} to build${c[PIECE_BUILT]! > 0 ? `, ${c[PIECE_BUILT]} built already` : ""}${j.blocked > 0 ? `, ${j.blocked} blocked` : ""}${c[PIECE_UNSUPPORTED]! > 0 ? `, ${c[PIECE_UNSUPPORTED]} with nothing to hold them` : ""}`);
    const structs = session.world?.structs;
    for (let state = 0; state < PIECE_STATES; state++) {
      if (state === PIECE_FINE || state === PIECE_BUILT || state === PIECE_UNSUPPORTED || c[state] === 0) continue;
      let by = "";
      for (let i = 0; i < n && by === "" && structs; i++) {
        if (j.state[i] !== state || j.by[i] === 0xffffffff) continue;
        const t = structs.chunks[Math.floor(j.by[i]! / 65536)];
        if (t && (j.by[i]! & 0xffff) < t.high && t.kind[j.by[i]! & 0xffff] !== 0) by = ` (${nameOf(t.kind[j.by[i]! & 0xffff]!)})`;
      }
      out.push(`${c[state]} blocked: ${PIECE_WORDS[state]}${by}`);
    }
    if (c[PIECE_ENEMY]! > 0 || c[PIECE_PLAN]! > 0) out.push("The server will refuse it here");
    const inv = session.inventory;
    const cost = planCost(reg, p.placed, (i) => j.state[i] !== PIECE_FINE);
    const parts = cost.slice(0, 4).map(({ item, count }) => {
      const have = inv ? inv.total(item) : 0;
      return `${count} ${nameOf(reg.places[item]![0]!)} (${have >= count ? `have ${have}` : `${count - have} short`})`;
    });
    if (parts.length > 0) out.push(`Needs ${parts.join(", ")}${cost.length > 4 ? ` and ${cost.length - 4} more kinds` : ""}`);
    const l = this.limits;
    if (l.piecesCap > 0) {
      const after = l.have + c[PIECE_FINE]!;
      out.push(`${l.cap > 0 ? `${after.toLocaleString("en-US")} of ${l.cap.toLocaleString("en-US")} structures here once built` : `${after.toLocaleString("en-US")} structures here once built`}; plans ${l.plans} of ${l.plansCap}${l.wait > 0 ? `; wait ${Math.ceil(l.wait / 30)} s` : ""}`);
      if (n > l.piecesCap) out.push(`Too many pieces: ${l.piecesCap} at most here`);
    }
    return out;
  }

  /** Gives template `i` a new name, keeping its description. */
  renameTemplate(i: number, name: string, reg: Registry): void {
    const t = this.templates.list[i];
    if (t) this.templates.rename(i, name, t.description, pieceBook(reg));
  }

  /** What template `i` costs to build whole, the most first; null where it has a piece this game does not build. */
  templateCost(reg: Registry, i: number): readonly { item: number; count: number }[] | null {
    const book = pieceBook(reg);
    const bp = this.templates.blueprint(this.templates.list[i]!, book);
    const placed = bp ? placePieces(book, bp, false, 0, [0, 0, 0, 0], 0) : null;
    return placed?.ok ? planCost(reg, placed.placed, () => false) : null;
  }

  /**
   * Adds the holograms to the frame's marks (the ghost pass's): the template being set down, each piece in the colour of
   * what the judge says of it, then the open pieces of the tribe's plans. Where there are more than MAX_HOLOGRAMS, the
   * nearest to the camera.
   */
  holograms(out: Ghost, session: ClientSession, palette: Uint8Array, cx: number, cy: number, cz: number, nowMs: number): void {
    let shown = 0;
    const structs = session.world?.structs;
    const plans = plansOf(session).plans;
    const p = this.active ? this.preview : null;
    if (!structs || (!p && plans.size === 0)) return;
    const [fine, wait, plan] = (this.colours ??= [nearestColour(palette, 90, 200, 255), nearestColour(palette, 255, 190, 70), nearestColour(palette, 150, 170, 255)]);
    let total = p ? p.placed.n : 0;
    for (const v of plans.values()) total += v.placed.n;
    // Past what a frame shows, how far the nearest reach is worked out now and then.
    if (total <= MAX_HOLOGRAMS) this.cut = Infinity;
    else if (nowMs - this.cutAt > 250) {
      this.cutAt = nowMs;
      if (this.far.length < total) this.far = new Float64Array(total);
      let k = 0;
      const near = (x: number, y: number, z: number): void => void (this.far[k++] = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz));
      if (p) for (let i = 0; i < p.placed.n; i++) if (this.judge.state[i] !== PIECE_BUILT) near(p.x[i]!, p.y[i]!, p.z[i]!);
      for (const v of plans.values()) for (let i = 0; i < v.placed.n; i++) if (open(structs, v, i)) near(v.x[i]!, v.y[i]!, v.z[i]!);
      this.cut = k <= MAX_HOLOGRAMS ? Infinity : this.far.subarray(0, k).sort()[MAX_HOLOGRAMS - 1]!;
    }
    const cut = this.cut;
    const within = (x: number, y: number, z: number): boolean => (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz) <= cut;
    if (p) {
      const judged = this.judge.n === p.placed.n && this.judgedKey === p.key;
      for (let i = 0; i < p.placed.n; i++) {
        const state = judged ? this.judge.state[i]! : PIECE_FINE;
        if (state === PIECE_BUILT || !within(p.x[i]!, p.y[i]!, p.z[i]!)) continue;
        if (shown++ === MAX_HOLOGRAMS) return;
        out.piece(p.placed.kind[i]!, p.x[i]!, p.y[i]!, p.z[i]!, p.yaw[i]!, p.tw[i]!, state === PIECE_FINE ? fine : state === PIECE_UNSUPPORTED ? wait : GHOST_BAD);
      }
    }
    for (const v of plans.values()) {
      for (let i = 0; i < v.placed.n; i++) {
        if (!within(v.x[i]!, v.y[i]!, v.z[i]!) || !open(structs, v, i)) continue;
        if (shown++ === MAX_HOLOGRAMS) return;
        out.piece(v.placed.kind[i]!, v.x[i]!, v.y[i]!, v.z[i]!, v.yaw[i]!, v.tw[i]!, plan);
      }
    }
  }
}
