// Houses as blueprint pieces, a base raised from them straight into a server's rows, and a survivor set up with the
// template hammer: for tests of templates and plans.

import type { ClientSession } from "../../client/core/session.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { StructureDef } from "../../shared/content/defs.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_MOVE, CMD_PLAN_PART } from "../../shared/net/protocol.ts";
import type { BlueprintPiece } from "../../shared/world/blueprint.ts";
import { FORM_LAYERS, SLOT_CLASSES } from "../../shared/world/lattice/forms.ts";
import { canon, canonical, key0, key1 } from "../../shared/world/lattice/module.ts";
import { PLAN_PART_BYTES, frameFor, pieceBook } from "../../shared/world/plan.ts";
import { freePose, type Pose } from "../../shared/world/snap.ts";
import type { Harness } from "./net.ts";

export const THATCH = 0, WOOD = 1, STONE = 2, METAL = 3;
export const TIER_NAMES = ["thatch", "wood", "stone", "metal"];

const S = new Int32Array(8);

/** A piece of a form named from the corner `m` along `dir`, at its canonical key. */
export function at(reg: Registry, form: string, tier: number, m: readonly number[], lvl: number, dir: number, rot = 0, flip = 0): BlueprintPiece {
  const f = pieceBook(reg).forms[form]!;
  const cls = SLOT_CLASSES.indexOf(f.cls);
  S.set(m);
  canonical(cls, S, 0, dir, S, 4, f.size ?? 2);
  return { form, tier, k0: key0(cls, S[4]!, S[5]!, S[6]!), k1: key1(S[7]!, lvl, canon.dir, FORM_LAYERS.indexOf(f.layer), rot, flip) };
}

/** The corner of a square grid, `i` whole sides along +X and `j` along +Z. */
export const grid = (i: number, j: number): number[] => [2 * i, 0, 0, 2 * j];

/**
 * A house of `wide` by `deep` squares that stands: foundations, outside walls with a door at the front and a window in
 * each other side, and a ceiling over every storey. Its first piece is the foundation at the corner.
 */
export function house(reg: Registry, wide: number, deep: number, storeys: number, tier = WOOD): BlueprintPiece[] {
  const out: BlueprintPiece[] = [];
  for (let i = 0; i < wide; i++) for (let j = 0; j < deep; j++) out.push(at(reg, "foundation", tier, grid(i, j), 0, 0));
  for (let s = 0; s < storeys; s++) {
    const lvl = 4 * s;
    for (let i = 0; i < wide; i++) {
      const front = s === 0 && i === 0;
      out.push(at(reg, front ? "doorframe" : "wall", tier, grid(i, 0), lvl, 0, 1));
      if (front) out.push(at(reg, "door", tier, grid(i, 0), lvl, 0, 1));
      out.push(at(reg, i === wide - 1 ? "windowframe" : "wall", tier, grid(i, deep), lvl, 0));
    }
    for (let j = 0; j < deep; j++) {
      out.push(at(reg, "wall", tier, grid(0, j), lvl, 3));
      out.push(at(reg, j === 0 ? "windowframe" : "wall", tier, grid(wide, j), lvl, 3, 1));
    }
    for (let i = 0; i < wide; i++) for (let j = 0; j < deep; j++) out.push(at(reg, "ceiling", tier, grid(i, j), lvl + 4, 0));
  }
  return out;
}

/**
 * A base of exactly `n` pieces that stands: storeys of `side` by `side` squares with a wall on every line of the grid,
 * so every ceiling has a wall under each side, cut off where the count is reached.
 */
export function keep(reg: Registry, n: number, side = 10, tier = STONE): BlueprintPiece[] {
  const out: BlueprintPiece[] = [];
  for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) out.push(at(reg, "foundation", tier, grid(i, j), 0, 0));
  for (let s = 0; out.length < n; s++) {
    const lvl = 4 * s;
    for (let i = 0; i < side && out.length < n; i++) for (let j = 0; j <= side && out.length < n; j++) out.push(at(reg, "wall", tier, grid(i, j), lvl, 0));
    for (let i = 0; i <= side && out.length < n; i++) for (let j = 0; j < side && out.length < n; j++) out.push(at(reg, "wall", tier, grid(i, j), lvl, 3));
    for (let i = 0; i < side && out.length < n; i++) for (let j = 0; j < side && out.length < n; j++) out.push(at(reg, "ceiling", tier, grid(i, j), lvl + 4, 0));
  }
  return out.slice(0, n);
}

const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
const origin = { ox: 0, oy: 0, oz: 0 };

/**
 * Sets `pieces` down as rows of `team`'s in a new frame, the first of them (a foundation) where one set down by hand at
 * (x, z) facing `yaw` would be. Nothing is asked: this is a base that stands already. Returns the frame and the refs.
 */
export function raise(h: Harness, pieces: readonly BlueprintPiece[], team: number, x: number, z: number, yaw = 0): { fr: number; refs: number[] } {
  const world = h.world;
  const reg = world.reg;
  const book = pieceBook(reg);
  const kindOf = (p: BlueprintPiece): number => book.kindOf(p.form, p.tier);
  const first = pieces[0]!;
  if (!freePose((gx, gz) => world.hf.heightAt(gx, gz), reg, kindOf(first), x, z, yaw, 0, pose)) throw new Error("the first piece is no foundation");
  frameFor(reg.forms, kindOf(first), first.k0, first.k1, pose.x, pose.y, pose.z, yaw, origin);
  const f = world.structs.frames.make(origin.ox, origin.oy, origin.oz, yaw, team);
  const refs = pieces.map((p) => {
    const kind = kindOf(p);
    const ref = world.structs.place(kind, f.gid, p.k0, p.k1, team, (reg.defs[kind] as StructureDef).hp);
    if (ref < 0) throw new Error(`${p.form} would not go down`);
    return ref;
  });
  return { fr: f.gid, refs };
}

/** Gives a survivor the template hammer in hotbar slot `slot`, and holds it. */
export function giveHammer(h: Harness, s: ClientSession, slot = 7): void {
  const reg = h.world.reg;
  const hammer = reg.index.get("core:template_hammer")!;
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  h.host.items.mint(rec, hammer, 1);
  h.run(200);
  const inv = s.inventory!;
  const from = inv.item.indexOf(hammer);
  s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + slot), w.u16(0), w.u16(hammer)));
  h.run(150);
}

/** Sends a blueprint's bytes as CMD_PLAN_PART commands, a few a tick, as the client's hammer does without waiting. */
export function uploadParts(h: Harness, s: ClientSession, bytes: Uint8Array): number {
  let parts = 0;
  for (let at = 0; at < bytes.length; at += PLAN_PART_BYTES) {
    const part = bytes.subarray(at, Math.min(bytes.length, at + PLAN_PART_BYTES));
    s.command(CMD_PLAN_PART, (w: BitWriter) => (w.varint(bytes.length), w.varint(at), w.blob(part)));
    parts++;
    if (parts % 3 === 0) h.run(100);
  }
  h.run(150);
  return parts;
}
