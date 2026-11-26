import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { LOOK_BYTES, LOOK_SEX, defaultLook, randomLook, validLook } from "../../shared/anim/look.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT, RESULT_OK } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ARMOR_SLOTS } from "../../shared/sim/items.ts";
import type { Body } from "../../server/corpses.ts";
import { Harness } from "../fixtures/net.ts";
import { id } from "../kit/kit.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-corpse-look-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A look unlike the default: the other sex, its sliders and colours drawn at random. */
function unusual(): Uint8Array {
  const look = randomLook(new Rng(11));
  look[LOOK_SEX] = 1 - defaultLook()[LOOK_SEX]!;
  expect(validLook(look)).toBe(true);
  expect([...look]).not.toEqual([...defaultLook()]);
  return look;
}

/** What `s` was last sent of entity `e`: its look, or null, and its gear. */
function seenOf(s: ClientSession, e: number): { look: number[] | null; gear: number[] } {
  const seen = new RemoteSample();
  s.sampleRemote(seen);
  const n = seen.id.subarray(0, seen.count).indexOf(e);
  expect(n).toBeGreaterThanOrEqual(0);
  return {
    look: seen.hasLook[n] ? [...seen.look.subarray(n * LOOK_BYTES, (n + 1) * LOOK_BYTES)] : null,
    gear: [...seen.gear.subarray(n * GEAR_COUNT, (n + 1) * GEAR_COUNT)],
  };
}

function survivorBody(h: Harness): Body {
  const survivor = h.reg.index.get("core:survivor")!;
  const bodies = [...h.host.corpses.bodies.values()].filter((b) => b.kind === survivor);
  expect(bodies.length).toBe(1);
  return bodies[0]!;
}

test("a survivor's body keeps its look and armor across a restart, not what it held", () => {
  const db = join(dir, "dressed.db");
  const look = unusual();
  const h = new Harness({}, 1, 60, { dev: true, dbPath: db });
  const s = h.join("ada", {}, { look });
  const bo = h.join("bo");
  h.run(500);
  h.say(s, "enablecheats");
  expect(h.say(s, "armor hide")[0]).not.toMatch(/^no /);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const inv = h.host.items.inv(rec);
  // A bow in hand, which the body is not to show.
  expect(h.host.items.mint(rec, id("bow"), 1)).toBe(1);
  const codes = new Map<number, number>();
  s.onResult = (seq, code) => codes.set(seq, code);
  const send = (op: number, args: (w: BitWriter) => void): number => {
    const seq = s.command(op, args);
    h.run(150);
    return codes.get(seq) ?? -1;
  };
  const bow = inv.item.indexOf(id("bow"));
  expect(send(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(bow), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(id("bow"))))).toBe(RESULT_OK);
  expect(send(CMD_SELECT, (w) => w.u8(0))).toBe(RESULT_OK);
  const e = h.ent(s);
  const worn = [...inv.item.subarray(inv.armor, inv.armor + ARMOR_SLOTS)];
  expect(worn.every((k) => k !== 0)).toBe(true);
  expect([...h.world.ents.gears.get(e)!]).toEqual([id("bow"), ...worn]);
  expect([...h.world.ents.looks.get(e)!]).toEqual([...look]);

  expect(h.say(s, "suicide")).toEqual(["You were killed."]);
  h.run(300);
  const body = survivorBody(h);
  const dressed = [0, ...worn];
  expect(body.rec.look && [...body.rec.look]).toEqual([...look]);
  expect([...h.world.ents.looks.get(body.e)!]).toEqual([...look]);
  expect([...h.world.ents.gears.get(body.e)!]).toEqual(dressed);
  expect(h.world.ents.gears.get(body.e)![GEAR_HELD]).toBe(0);
  // Its create on the wire carries both, to one who watched it die and to one who comes later.
  expect(seenOf(bo, body.e)).toEqual({ look: [...look], gear: dressed });
  const cy = h.join("cy");
  h.run(500);
  expect(seenOf(cy, body.e)).toEqual({ look: [...look], gear: dressed });
  const pid = body.rec.pid;
  h.run(500);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dev: true, dbPath: db });
  try {
    const again = survivorBody(h2);
    expect(again.rec.pid).toBe(pid);
    expect([...h2.world.ents.looks.get(again.e)!]).toEqual([...look]);
    expect([...h2.world.ents.gears.get(again.e)!]).toEqual(dressed);
    const dee = h2.join("dee");
    h2.run(500);
    expect(seenOf(dee, again.e)).toEqual({ look: [...look], gear: dressed });
  } finally {
    h2.host.shutdown();
  }
});

test("a survivor who wore nothing lies with its look and no gear", () => {
  const look = unusual();
  const h = new Harness({}, 1, 60, { dev: true });
  try {
    const s = h.join("ada", {}, { look });
    h.run(500);
    h.say(s, "enablecheats");
    expect(h.say(s, "suicide")).toEqual(["You were killed."]);
    h.run(300);
    const body = survivorBody(h);
    expect([...h.world.ents.looks.get(body.e)!]).toEqual([...look]);
    expect(h.world.ents.gears.has(body.e)).toBe(false);
  } finally {
    h.host.shutdown();
  }
});

test("a saddled creature's body has no look and no gear, and holds its saddle", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  try {
    const s = h.join("ada");
    h.run(500);
    const at = h.client(s)!;
    const e = h.host.spawnCreature("core:raptor", h.world.ents.x[at.ent]! + 4, h.world.ents.z[at.ent]! + 4, 1);
    const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
    rec.saddle = id("saddle_raptor");
    h.host.refreshBody(rec);
    expect(h.world.ents.gears.get(e)![GEAR_WORN]).toBe(id("saddle_raptor"));
    h.host.survival.hurt(rec, 1e6, 0);
    h.run(300);
    const body = [...h.host.corpses.bodies.values()].find((b) => b.kind === rec.kind)!;
    expect(body.e).toBeGreaterThanOrEqual(0);
    expect(body.rec.look).toBeNull();
    expect(h.world.ents.looks.has(body.e)).toBe(false);
    expect(h.world.ents.gears.has(body.e)).toBe(false);
    expect(h.host.items.inv(body.rec).total(id("saddle_raptor"))).toBe(1);
    expect(seenOf(s, body.e)).toEqual({ look: null, gear: [0, 0, 0, 0, 0, 0] });
  } finally {
    h.host.shutdown();
  }
});
