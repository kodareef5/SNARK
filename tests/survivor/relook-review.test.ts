// Failing cases found in review of the relook branch: hair lost on travel to a younger world, a cut that changes nothing
// still starting the clock again, grooming that skips the item.use question, the remake's byPid, and grooming while out.

import { afterAll, expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { PART_HAIR, hairStart } from "../../server/people/look.ts";
import type { EntityRecord } from "../../server/records.ts";
import { LOOK_BEARD_LENGTH, LOOK_HAIR_COLOR, LOOK_HAIR_COLOR_2, LOOK_HAIR_LENGTH, LOOK_SEX, defaultLook, randomLook } from "../../shared/anim/look.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_GROOM, CMD_REMAKE, RESULT_OK } from "../../shared/net/protocol.ts";
import { HAIR_STAGES, HAIR_TICK, beardAt, hairAt } from "../../shared/people/hair.ts";
import { Rng } from "../../shared/rng.ts";
import { TestCluster, keyAt, rec as clusterRec, rise, travel } from "../fixtures/cluster.ts";
import { listener } from "../fixtures/module.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const cluster = new TestCluster();
afterAll(() => cluster.cleanup());

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
/** One hair clock step, in the harness's milliseconds at 30 ticks a second. */
const STEP_MS = Math.ceil((HAIR_TICK * 1000) / 30);

function send(h: Harness, s: ClientSession, op: number, write: (w: BitWriter) => void): number {
  let code = -1;
  const was = s.onResult;
  const seq = s.command(op, write);
  s.onResult = (n, c) => void (n === seq && (code = c));
  for (let k = 0; k < 40 && code < 0; k++) h.run(25);
  s.onResult = was;
  h.run(100);
  return code;
}

function face(): Uint8Array {
  const look = randomLook(new Rng(21));
  look[LOOK_SEX] = 1;
  look[LOOK_HAIR_LENGTH] = 0;
  look[LOOK_BEARD_LENGTH] = 10;
  look[LOOK_HAIR_COLOR] = 3;
  look[LOOK_HAIR_COLOR_2] = 0;
  return look;
}

function grown(h: Harness, me: EntityRecord): number[] {
  return [hairAt(me.look!, hairStart(me), h.world.tick, h.world.hairRate), beardAt(me.look!, hairStart(me), h.world.tick, h.world.hairRate)];
}

test("hair grown on one map is no shorter after travel to a younger map", () => {
  const clock = { ms: Date.now() };
  const a = cluster.server("Island", "young", clock);
  const b = cluster.server("Miami", "young", clock);
  try {
    for (const s of [a, b]) expect(s.h.host.setSetting("HairGrowthSpeedMultiplier", "1000")).toBe("");
    const ada = a.h.join("ada", {}, { key: keyAt("ada", 1), look: face() });
    // This world runs on well past the other's age, and her hair grows out.
    a.h.run(8 * STEP_MS);
    const me = clusterRec(a, "ada")!;
    const here = grown(a.h, me);
    expect(here[0]).toBeGreaterThanOrEqual(HAIR_STAGES[2]!);
    expect(b.h.world.tick).toBeLessThan(a.h.world.tick - 4 * HAIR_TICK);
    const ticket = travel(a, ada, b.world);
    expect(ticket).toBeInstanceOf(Uint8Array);
    const there = b.h.join("ada", {}, { key: keyAt("ada", 2), ticket: ticket as Uint8Array });
    b.h.run(400);
    rise(b, there);
    const arrived = clusterRec(b, "ada")!;
    // Travel takes seconds; the hair must not lose what it grew.
    expect(grown(b.h, arrived)[0]).toBeGreaterThanOrEqual(here[0]!);
  } finally {
    a.h.host.shutdown();
    b.h.host.shutdown();
  }
});

test("cutting hair already at the stage leaves the beard's growth alone", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  try {
    const ada = h.join("ada", {}, { look: face() });
    h.run(600);
    const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
    // Three quarters of a unit a clock step.
    expect(h.host.setSetting("HairGrowthSpeedMultiplier", "30")).toBe("");
    expect(h.host.items.mint(me, id("scissors"), 1)).toBe(1);
    h.run(STEP_MS);
    // Left alone, eight steps grow the beard six units.
    let beard = grown(h, me)[1]!;
    h.run(8 * STEP_MS);
    expect(grown(h, me)[1]! - beard).toBeGreaterThanOrEqual(5);
    beard = grown(h, me)[1]!;
    const start = hairStart(me);
    // The hair is at its style already; each cut leaves it so, and the beard should grow as before.
    for (let k = 0; k < 8; k++) {
      h.run(STEP_MS);
      expect(h.say(ada, "cut hair 0")).toEqual(["Cut."]);
    }
    expect(me.look![LOOK_HAIR_LENGTH]).toBe(0);
    expect(grown(h, me)[1]! - beard).toBeGreaterThanOrEqual(5);
    expect(hairStart(me)).toBe(start);
  } finally {
    h.host.shutdown();
  }
});

test("a module that refuses item.use stops scissors used by command and console", () => {
  const veto = listener("noscissors", ["item.use"]);
  veto.heard.each = (e) => {
    if (e.name === "item.use" && e.data.item === "core:scissors") e.refuse("No scissors here.");
  };
  const h = new Harness({}, 1, 60, { dev: true, modules: [veto.def] });
  try {
    const ada = h.join("ada", {}, { look: face() });
    h.run(600);
    const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
    expect(h.host.items.mint(me, id("scissors"), 1)).toBe(1);
    me.look![LOOK_HAIR_LENGTH] = 200;
    h.run(100);
    const inv = h.host.items.inv(me), slot = inv.item.indexOf(id("scissors"));
    const code = send(h, ada, CMD_GROOM, (w) => (w.varint(slot), w.u16(id("scissors")), w.u32(0), w.u8(PART_HAIR), w.u8(0)));
    expect(code).not.toBe(RESULT_OK);
    expect(me.look![LOOK_HAIR_LENGTH]).toBe(200);
    expect(h.say(ada, "cut hair 1")).not.toEqual(["Cut."]);
    expect(me.look![LOOK_HAIR_LENGTH]).toBe(200);
  } finally {
    h.host.shutdown();
  }
});

test("session.relook gives byPid 0 for a remake, as its catalogue says", () => {
  const heard = listener("watch", ["session.relook"]);
  const seen: Record<string, unknown>[] = [];
  heard.heard.each = (e) => void seen.push({ ...e.data });
  const h = new Harness({}, 1, 60, { dev: true, modules: [heard.def] });
  try {
    const ada = h.join("ada", {}, { look: face() });
    h.run(600);
    expect(h.say(ada, "enablecheats")[0]).toMatch(/cheats/);
    expect(h.say(ada, "remake")).toEqual(["ada may make itself again in the creator."]);
    h.run(200);
    const made = defaultLook();
    expect(send(h, ada, CMD_REMAKE, (w) => (w.bool(true), [...made].forEach((b) => w.u8(b))))).toBe(RESULT_OK);
    expect(seen.at(-1)).toMatchObject({ cause: "remake", byPid: 0 });
  } finally {
    h.host.shutdown();
  }
});

test("an unconscious survivor cannot cut its hair from the console", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  try {
    const ada = h.join("ada", {}, { look: face() });
    h.run(600);
    const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
    expect(h.host.items.mint(me, id("scissors"), 1)).toBe(1);
    me.look![LOOK_HAIR_LENGTH] = 200;
    h.run(100);
    const inv = h.host.items.inv(me), slot = inv.item.indexOf(id("scissors"));
    me.out = true;
    // The command is refused while out...
    expect(send(h, ada, CMD_GROOM, (w) => (w.varint(slot), w.u16(id("scissors")), w.u32(0), w.u8(PART_HAIR), w.u8(0)))).not.toBe(RESULT_OK);
    me.out = true;
    // ...and so is the console's way to the same cut.
    h.say(ada, "cut hair 0");
    expect(me.look![LOOK_HAIR_LENGTH]).toBe(200);
  } finally {
    h.host.shutdown();
  }
});
