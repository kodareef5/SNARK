// A thing thrown from the hand (CMD_THROW, server/loose.ts) flies as a loose body, is seen in flight by others as a bag
// pointing along its length, comes to rest lying flat as a bag of one stack showing its item, and is taken up whole with
// CMD_TAKE. Thrown at a survivor, it strikes them once.
import { expect, test } from "bun:test";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT, CMD_TAKE, CMD_THROW, RESULT_INVALID, RESULT_OK } from "../../shared/net/protocol.ts";
import { GEAR_COUNT, GEAR_HELD } from "../../shared/sim/entities.ts";
import { inFlight } from "../../shared/sim/loose.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

function setup() {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  const bo = h.join("bo");
  h.run(400);
  h.say(ada, "enablecheats");
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(ada)]!)!;
  const codes = new Map<number, number>();
  ada.onResult = (seq, code) => codes.set(seq, code);
  const send = (op: number, args: (w: BitWriter) => void, ms = 150, who: ClientSession = ada): number => {
    const seq = who.command(op, args);
    h.run(ms);
    return codes.get(seq) ?? -1;
  };
  const items = h.host.items;
  /** Puts one `name` in ada's hand. */
  const hold = (name: string): void => {
    expect(items.mint(rec, id(name), 1)).toBe(1);
    h.run(100);
    const at = items.inv(rec).item.lastIndexOf(id(name));
    const hot = items.inv(rec).hotbar;
    expect(send(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(at), w.bits(BOX_SELF, 1), w.varint(hot), w.u16(0), w.u16(id(name))))).toBe(RESULT_OK);
    expect(send(CMD_SELECT, (w) => w.u8(0))).toBe(RESULT_OK);
    expect(rec.held).toBe(0);
  };
  const bags = () => [...h.host.records.byPid.values()].filter((r) => r.kind === id("bag"));
  return { h, ada, bo, rec, send, items, hold, bags };
}

test("a pistol thrown flies, is seen in flight, lies flat as a bag showing it, and is taken up again", () => {
  const { h, ada, bo, rec, send, items, hold, bags } = setup();
  hold("pistol");
  const p = h.pilots[0]!;
  [p.yaw, p.pitch] = [0, 0.3];
  h.run(200);
  const start = { x: h.world.ents.x[h.ent(ada)]!, z: h.world.ents.z[h.ent(ada)]! };
  expect(send(CMD_THROW, () => {}, 0)).toBe(-1);
  // In flight: one bag, the hand empty, the bag marked as flying for everyone.
  let flewSeen = false;
  h.run(400, () => {
    const seen = new RemoteSample();
    bo.sampleRemote(seen);
    for (let k = 0; k < seen.count; k++) if (seen.kind[k] === id("bag") && inFlight(seen.anim[k]!)) flewSeen = true;
  });
  expect(flewSeen).toBe(true);
  expect(items.inv(rec).item.includes(id("pistol"))).toBe(false);
  expect(bags().length).toBe(1);
  expect(h.host.loose.stats.thrown).toBe(1);
  h.run(3000);
  // At rest: flying no more, lying flat some metres ahead, showing the pistol to bo.
  expect(h.host.loose.count).toBe(0);
  expect(h.host.loose.stats.rested).toBe(1);
  const bag = bags()[0]!;
  const e = h.host.records.entOf.get(bag.pid)!;
  const ents = h.world.ents;
  expect(inFlight(ents.anim[e]!)).toBe(false);
  expect(ents.pitch[e]).toBe(0);
  const ahead = Math.hypot(ents.x[e]! - start.x, ents.z[e]! - start.z);
  expect(ahead).toBeGreaterThan(3);
  expect([bag.x, bag.z]).toEqual([ents.x[e]!, ents.z[e]!]);
  const seen = new RemoteSample();
  bo.sampleRemote(seen);
  const k = [...seen.kind.subarray(0, seen.count)].indexOf(id("bag"));
  expect(seen.gear[k * GEAR_COUNT + GEAR_HELD]).toBe(id("pistol"));
  // Out of reach it is not taken; walked to, it is, whole, and the bag is gone.
  expect(send(CMD_TAKE, (w) => w.u32(e))).toBe(RESULT_INVALID);
  h.say(ada, `tp ${(ents.x[e]! - 1).toFixed(2)} ${ents.z[e]!.toFixed(2)}`);
  h.run(300);
  expect(send(CMD_TAKE, (w) => w.u32(e))).toBe(RESULT_OK);
  expect(items.inv(rec).item.includes(id("pistol"))).toBe(true);
  expect(bags().length).toBe(0);
  expect(items.audit()).toEqual([]);
});

test("a thing thrown at a survivor strikes them once, and falls back off them", () => {
  const { h, ada, bo, send, hold, bags } = setup();
  hold("pistol");
  const ents = h.world.ents;
  // Ada stands 4 m behind bo, looking at bo's back.
  const b = h.ent(bo);
  h.say(ada, `tp ${ents.x[b]!.toFixed(2)} ${(ents.z[b]! - 4).toFixed(2)}`);
  const p = h.pilots[0]!;
  [p.yaw, p.pitch] = [0, -0.05];
  h.run(300);
  const brec = h.host.records.byPid.get(ents.pid[b]!)!;
  const health = (): number => h.host.survival.value(brec, V_HEALTH);
  const before = health();
  send(CMD_THROW, () => {}, 0);
  h.run(3000);
  expect(h.host.loose.stats.struck).toBe(1);
  expect(health()).toBeLessThan(before - 5);
  // It lies between them, short of where bo stood.
  const bag = bags()[0]!;
  expect(bag.z).toBeLessThan(ents.z[b]! + 0.5);
});
