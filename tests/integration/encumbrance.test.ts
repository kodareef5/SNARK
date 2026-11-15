import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_CLOSE, CMD_DROP, CMD_MOVE, CMD_OPEN, RESULT_OK } from "../../shared/net/protocol.ts";
import { MF_ROOTED } from "../../shared/sim/character.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

function yard(dbPath?: string) {
  const h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0, dbPath });
  const s = h.join("ada");
  h.run(300);
  const c = h.client(s)!;
  const me = h.host.records.byPid.get(c.pid)!;
  const at = flatGround(h, 30, 30);
  h.say(s, "enablecheats");
  h.say(s, `tp ${at.x + 10} ${at.z + 10}`);
  const e = h.host.spawnCreature("core:raptor", at.x + 10, at.z + 12, 1);
  const pet = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  h.host.taming.give(pet, me, 0, "forced");
  h.host.creatures.mind.stay(e, 0xffffffff);
  const id = (name: string): number => h.reg.index.get(`core:${name}`)!;
  pet.saddle = id("saddle_raptor");
  const rooted = (): boolean => (h.world.ents.mflags[e]! & MF_ROOTED) !== 0;
  const send = (op: number, args?: (w: BitWriter) => void): number => {
    let code = -1;
    s.onResult = (_, result) => { code = result; };
    s.command(op, args);
    h.run(100);
    return code;
  };
  return { h, s, c, me, e, pet, id, rooted, send };
}

test("transferring a tame's load updates encumbrance in both directions without observing or refreshing its body", () => {
  const { h, me, e, pet, id, rooted, send } = yard();
  try {
    h.host.items.mint(me, id("stone"), 1000);
    h.run(100);
    expect(send(CMD_OPEN, (w) => w.u32(e))).toBe(RESULT_OK);
    for (let slot = 0; slot < 10; slot++) {
      expect(send(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(slot), w.bits(BOX_OPEN, 1), w.varint(slot), w.u16(0), w.u16(id("stone"))))).toBe(RESULT_OK);
    }
    expect(send(CMD_CLOSE)).toBe(RESULT_OK);
    expect(rooted()).toBe(true);
    expect(h.host.items.inv(pet).weight(h.host.items.table)).toBe(500);
    expect(send(CMD_OPEN, (w) => w.u32(e))).toBe(RESULT_OK);
    for (let slot = 0; slot < 10; slot++) {
      expect(send(CMD_MOVE, (w) => (w.bits(BOX_OPEN, 1), w.varint(slot), w.bits(BOX_SELF, 1), w.varint(slot), w.u16(0), w.u16(id("stone"))))).toBe(RESULT_OK);
    }
    expect(rooted()).toBe(false);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a mounted rider's changing inventory updates the mount's load", () => {
  const { h, c, me, e, id, rooted, send } = yard();
  try {
    h.host.items.mint(me, id("stone"), 400);
    h.run(100);
    expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
    expect(rooted()).toBe(true);
    for (let slot = 0; slot < 4; slot++) expect(send(CMD_DROP, (w) => (w.varint(slot), w.u16(0), w.u16(id("stone"))))).toBe(RESULT_OK);
    expect(rooted()).toBe(false);
    // Non-command changes, such as a harvest or craft completing, take the same path.
    h.host.items.mint(me, id("stone"), 400);
    h.run(100);
    expect(rooted()).toBe(true);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a loaded tame starts encumbered after a restart without anyone opening its inventory", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-load-"));
  const dbPath = join(dir, "world.db");
  let h: Harness | undefined;
  try {
    const made = yard(dbPath);
    h = made.h;
    const pid = made.pet.pid;
    h.host.items.mint(made.pet, made.id("stone"), 1000);
    h.run(100);
    const config = h.host.rules;
    h.host.shutdown();
    h = undefined;
    h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0, dbPath, config });
    const e = h.host.records.entOf.get(pid)!;
    expect(h.world.ents.mflags[e]! & MF_ROOTED).toBe(MF_ROOTED);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h?.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
