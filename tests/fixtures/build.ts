import { expect } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_MOVE, CMD_PLACE, CMD_SELECT, CMD_STRUCT } from "../../shared/net/protocol.ts";
import { flatGround } from "./arena.ts";
import { Harness } from "./net.ts";
import { coreRegistry } from "./world.ts";
import type { HostOptions } from "../../server/host.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;
export const PIECES = ["foundation", "wall", "ceiling", "pillar", "door", "stairs"];

/** Each builder starts with this many of each piece, as many as a survivor with all its points in weight can walk with. */
export const STOCK = 60;

/** Survivors with cheats on level ground, each with STOCK wood pieces of every kind, one kind in each of the first six hotbar slots. */
export function builder(names = ["ada"], wide = 40, deep = wide, host: HostOptions = {}) {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  const sessions = names.map((n) => h.join(n));
  h.run(600);
  const g = flatGround(h, wide, deep);
  const at = { x: g.x + wide / 2, z: g.z + 4, y: g.y };
  sessions.forEach((s, i) => {
    h.say(s, "enablecheats");
    h.say(s, `tp ${(at.x + i * 2).toFixed(3)} ${at.z.toFixed(3)}`);
    h.say(s, "setstat weight 255");
    PIECES.forEach((piece, slot) => {
      expect(h.say(s, `give piece_${piece}_wood ${STOCK}`)[0]).toContain(`gave ${STOCK}`);
      const inv = s.inventory!;
      const from = inv.item.indexOf(id(`piece_${piece}_wood`));
      s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + slot), w.u16(0), w.u16(id(`piece_${piece}_wood`))));
      h.run(100);
      expect(inv.item[inv.hotbar + slot]).toBe(id(`piece_${piece}_wood`));
    });
  });
  h.run(200);
  const structs = h.world.structs;
  const hold = (s: ClientSession, piece: string): void => {
    s.command(CMD_SELECT, (w: BitWriter) => w.u8(PIECES.indexOf(piece)));
    h.run(100);
  };
  /** Sends CMD_PLACE directly. ref is -1 if nothing was built. */
  const join = (s: ClientSession, piece: string, target: number, socket: number, turn = 0, variant = 0): { code: number; ref: number } => {
    hold(s, piece);
    let code = -1;
    s.onResult = (_seq, c) => void (code = c);
    const before = h.host.build.placed;
    s.command(CMD_PLACE, (w: BitWriter) => (w.u8(variant), w.u32(target), w.u8(socket), w.u8(turn)));
    h.run(150);
    return { code, ref: h.host.build.placed > before ? h.host.build.last : -1 };
  };
  const count = (s: ClientSession, piece: string): number => s.inventory!.total(id(`piece_${piece}_wood`));
  const rowOf = (ref: number): [number, number, number, number, number, number] => {
    const t = structs.chunks[Math.floor(ref / 65536)]!;
    const k = ref & 0xffff;
    return [t.kind[k]!, Math.round(t.x[k]! * U), Math.round(t.y[k]! * U), Math.round(t.z[k]! * U), t.yaw[k]!, t.owner[k]!];
  };
  /** `action` is a STRUCT_ constant. Returns the result code. */
  const act = (s: ClientSession, ref: number, action: number): number => {
    let code = -1;
    s.onResult = (_seq, c) => void (code = c);
    s.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(action)));
    h.run(150);
    return code;
  };
  const has = (s: ClientSession, name: string): number => s.inventory!.total(id(name));
  return { h, sessions, at, hold, join, count, rowOf, structs, act, has };
}

