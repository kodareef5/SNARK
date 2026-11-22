// GameServer's three parts (server/sessions.ts, players.ts, replication.ts) and Death's two (server/death.ts,
// containers.ts): the order the tick calls them in, and the few calls the game still forwards.

import { expect, test } from "bun:test";
import type { EntityRecord } from "../../server/records.ts";
import { BOX_OPEN, BOX_SELF, CMD_DROP, CMD_MOVE, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_USE } from "../../shared/sim/character.ts";
import { camp, find, id, look, pos, press, send } from "../kit/kit.ts";

test("a tick calls its parts in one order, and replication comes last", () => {
  const { h } = camp();
  const game = h.server;
  const order: string[] = [];
  const spy = <T extends object, K extends keyof T>(of: T, name: K, as: string): void => {
    const real = (of[name] as (...args: unknown[]) => unknown).bind(of);
    of[name] = ((...args: unknown[]) => (order.push(as), real(...args))) as T[K];
  };
  spy(game, "onBeforeStep", "before");
  spy(game.players, "step", "step");
  spy(game.players, "commands", "commands");
  spy(game.sessions, "expire", "expire");
  spy(game, "onStep", "systems");
  spy(h.world.history, "record", "history");
  spy(game.replication, "send", "replication");
  game.tick();
  expect(order).toEqual(["before", "step", "commands", "expire", "systems", "history", "replication"]);
  h.host.shutdown();
});

test("the game forwards handle, take and release to the player step", () => {
  const { h, ada } = camp();
  const game = h.server;
  const c = h.client(ada)!;
  let ran = 0;
  // A code no system has taken: the table is the player step's, whoever registers.
  game.handle(250, () => (ran++, RESULT_OK));
  expect([send(h, ada, 250), ran]).toEqual([RESULT_OK, 1]);
  const e = h.host.spawnCreature("core:raptor", pos(h, ada).x + 4, pos(h, ada).z, 1);
  expect([game.take(c, e), c.drive, h.world.ents.driven[e]]).toEqual([true, e, 1]);
  game.release(c);
  expect([c.drive, h.world.ents.driven[e]]).toEqual([-1, 0]);
  h.host.shutdown();
});

test("an emptied bag is shut, then told of, then removed: Containers before Death", () => {
  const { h, ada, me } = camp({ items: { stone: 5 } });
  const slot = ada.inventory!.item.indexOf(id("stone"));
  expect(send(h, ada, CMD_DROP, (w) => (w.varint(slot), w.u16(0), w.u16(id("stone"))))).toBe(RESULT_OK);
  const bag = find(h, "bag");
  const seen: string[] = [];
  const held = (box: EntityRecord): boolean => h.host.records.byPid.has(box.pid);
  h.host.containers.onOpened.on((c, box) => void seen.push(`opened ${c.pid === me.pid && box === bag.rec}`));
  h.host.containers.onShut.on((box) => void seen.push(`shut ${box === bag.rec}, still there ${held(box)}`));
  h.host.containers.onRemoved.on((box) => void seen.push(`removed ${box === bag.rec}, still there ${held(box)}`));
  look(h, ada, { ...pos(h, bag.e), y: pos(h, bag.e).y + 0.1 });
  press(h, ada, BTN_USE);
  expect(h.client(ada)!.open).toBe(bag.rec.pid);
  // She takes the stone back, which empties it.
  expect(send(h, ada, CMD_MOVE, (w) => (w.bits(BOX_OPEN, 1), w.varint(0), w.bits(BOX_SELF, 1), w.varint(slot), w.u16(0), w.u16(id("stone"))))).toBe(RESULT_OK);
  h.run(200);
  expect(seen).toEqual(["opened true", "shut true, still there true", "removed true, still there true"]);
  expect([h.client(ada)!.open, held(bag.rec)]).toEqual([0, false]);
  h.host.shutdown();
});
