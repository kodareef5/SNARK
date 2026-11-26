// A dropped bag of one stack is drawn as that stack's item lying. The server says which item in the bag's gear, as the
// item in hand, and keeps it right as the bag is put into and taken from; a client draws the item's #dropped mesh in place
// of the bag where the pack has one.
import { expect, test } from "bun:test";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { authoredClips } from "../../shared/anim/authored.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_DROP, CMD_MOVE, RESULT_OK } from "../../shared/net/protocol.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { BTN_USE } from "../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_HELD } from "../../shared/sim/entities.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { lying } from "../../tools/pack/lying.ts";
import { mannequinMeshes } from "../../tools/pack/mannequin.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { weaponMeshes } from "../../tools/pack/weapons.ts";
import { boxMesh, buildPack } from "../../tools/pack/write.ts";
import { Harness } from "../fixtures/net.ts";
import { sceneWorld } from "../fixtures/sceneworld.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

test("a bag of one stack carries that stack's item as its gear, and everyone sees it change as the bag does", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  const bo = h.join("bo");
  h.run(400);
  h.say(ada, "enablecheats");
  h.say(bo, "enablecheats");
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(ada)]!)!;
  const codes = new Map<number, number>();
  ada.onResult = (seq, code) => codes.set(seq, code);
  const send = (who: ClientSession, op: number, args: (w: BitWriter) => void): number => {
    const seq = who.command(op, args);
    h.run(150);
    return codes.get(seq) ?? -1;
  };
  const items = h.host.items;
  const give = (name: string, n: number): number => {
    expect(items.mint(rec, id(name), n)).toBe(n);
    h.run(100);
    return items.inv(rec).item.lastIndexOf(id(name));
  };
  const bags = () => [...h.host.records.byPid.values()].filter((r) => r.kind === id("bag"));
  /** The bag's gear as the server holds it, and as bo's view of the world has it. */
  const shows = (): [number, number] => {
    const bag = bags()[0]!;
    const e = h.host.records.entOf.get(bag.pid)!;
    const seen = new RemoteSample();
    bo.sampleRemote(seen);
    const k = [...seen.kind.subarray(0, seen.count)].indexOf(id("bag"));
    expect(k).toBeGreaterThanOrEqual(0);
    return [h.world.ents.gears.get(e)?.[GEAR_HELD] ?? 0, seen.gear[k * GEAR_COUNT + GEAR_HELD]!];
  };

  // One stack dropped is a bag that shows it.
  const stone = give("stone", 40);
  expect(send(ada, CMD_DROP, (w) => (w.u8(stone), w.u16(30), w.u16(id("stone"))))).toBe(RESULT_OK);
  expect(bags().length).toBe(1);
  expect(shows()).toEqual([id("stone"), id("stone")]);
  // More of the same goes on the same stack, and it still shows the stone.
  expect(send(ada, CMD_DROP, (w) => (w.u8(stone), w.u16(5), w.u16(id("stone"))))).toBe(RESULT_OK);
  expect([items.inv(bags()[0]!).used(), ...shows()]).toEqual([1, id("stone"), id("stone")]);
  // A second stack makes it a bag again.
  const fiber = give("fiber", 3);
  expect(send(ada, CMD_DROP, (w) => (w.u8(fiber), w.u16(0), w.u16(id("fiber"))))).toBe(RESULT_OK);
  expect([bags().length, ...shows()]).toEqual([1, 0, 0]);

  // Bo opens it and takes the fibre out: one stack again, and it shows the stone.
  const bag = bags()[0]!;
  h.say(bo, `tp ${(bag.x - 1.2).toFixed(2)} ${bag.z.toFixed(2)}`);
  const p = h.pilots[1]!;
  [p.yaw, p.pitch] = [Math.PI / 2, -0.9];
  h.run(300);
  p.buttons = BTN_USE;
  h.run(100);
  p.buttons = 0;
  h.run(300);
  expect(bo.open?.name).toBe("bag");
  const from = bo.open!.inventory.item.indexOf(id("fiber"));
  bo.command(CMD_MOVE, (w) => (w.bits(BOX_OPEN, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(0), w.u16(0), w.u16(id("fiber"))));
  h.run(300);
  expect(shows()).toEqual([id("stone"), id("stone")]);
  // Putting something back makes it a bag again, and taking it out once more the stone.
  bo.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(0), w.bits(BOX_OPEN, 1), w.varint(from), w.u16(0), w.u16(id("fiber"))));
  h.run(300);
  expect(shows()).toEqual([0, 0]);
  bo.command(CMD_MOVE, (w) => (w.bits(BOX_OPEN, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(0), w.u16(0), w.u16(id("fiber"))));
  h.run(300);
  expect(shows()).toEqual([id("stone"), id("stone")]);
  // Emptied, it is gone.
  const left = bo.open!.inventory.item.indexOf(id("stone"));
  bo.command(CMD_MOVE, (w) => (w.bits(BOX_OPEN, 1), w.varint(left), w.bits(BOX_SELF, 1), w.varint(1), w.u16(0), w.u16(id("stone"))));
  h.run(300);
  expect(bags().length).toBe(0);
  expect(items.audit()).toEqual([]);

  // A harvest that overflows into a new bag shows what it holds, as a drop does. A cache never shows anything.
  h.host.death.overflow(rec, id("wood"), 7);
  h.run(100);
  expect(shows()).toEqual([id("wood"), id("wood")]);
  const cache = h.host.death.spill(rec.x, rec.y, rec.z, "spill");
  items.mint(cache, id("stone"), 1);
  h.run(100);
  expect(h.world.ents.gears.get(h.host.records.entOf.get(cache.pid)!)).toBeUndefined();
});

test("a client draws a bag of one stack as the item lying, where the pack has its #dropped mesh, and as the bag otherwise", () => {
  // The scene's own world, with a lying stone in its pack.
  const meshes = [...grayboxMeshes(CORE_CONTENT), ...mannequinMeshes(), ...weaponMeshes(), lying({ id: "core:stone", lods: [boxMesh([0.08, 0.05, 0.06], 15)] }, "core:stone/dropped")];
  const { files, manifest } = splitPack(buildPack(meshes, defaultPalette(), authoredClips(), []), "dropped");
  const w = sceneWorld({}, {}, { files, manifest });
  const bagMesh = w.scene.assets.bind.mesh("core:bag", "mesh");
  const stoneMesh = w.mesh("core:stone/dropped");
  expect([bagMesh >= 0, stoneMesh >= 0, bagMesh !== stoneMesh]).toEqual([true, true, true]);
  const drawn = (): [boolean, boolean] => {
    let p = w.frame();
    for (let k = 0; k < 20; k++) p = w.frame();
    const meshes = [...p.drawMesh.subarray(0, p.drawCount)];
    return [meshes.includes(stoneMesh), meshes.includes(bagMesh)];
  };
  const bag = w.place("core:bag", 32, 23, { held: "core:stone" });
  expect(drawn()).toEqual([true, false]);
  // A bag of more than one stack, or of an item with no lying mesh, is the bag.
  w.remote.gear[bag * GEAR_COUNT + GEAR_HELD] = 0;
  expect(drawn()).toEqual([false, true]);
  w.remote.gear[bag * GEAR_COUNT + GEAR_HELD] = w.kind("core:wood");
  expect(drawn()).toEqual([false, true]);
  // Only a bag lies as its item: a cache that somehow had gear is a cache.
  w.remote.gear[bag * GEAR_COUNT + GEAR_HELD] = w.kind("core:stone");
  w.remote.kind[bag] = w.kind("core:cache");
  expect(drawn()[0]).toBe(false);
});

test("a lying item is drawn at a coarser level far off, and a pile at the level its nearest asks for", () => {
  const box = boxMesh([0.08, 0.05, 0.06], 15);
  const stone = lying({ id: "core:stone", lods: [box, { ...box, error: 0.02 }, { ...box, error: 0.08 }] }, "core:stone/dropped");
  const meshes = [...grayboxMeshes(CORE_CONTENT), ...mannequinMeshes(), ...weaponMeshes(), stone];
  const { files, manifest } = splitPack(buildPack(meshes, defaultPalette(), authoredClips(), []), "dropped-levels");
  const w = sceneWorld({}, {}, { files, manifest });
  /** The level of each draw of the lying stone, and how many lie in them, once what it wants has come. */
  const drawn = (): [number[], number] => {
    let p = w.frame();
    for (let k = 0; k < 20; k++) p = w.frame();
    const draws = w.draws(p, "core:stone/dropped");
    return [[...new Set(draws.map((d) => p.drawLod[d]!))], Math.max(0, ...draws.map((d) => p.drawInstances[d]!))];
  };
  // The camera stands at z = 20 and looks along +z.
  const bag = w.place("core:bag", 32, 23, { held: "core:stone" });
  expect(drawn()).toEqual([[0], 1]);
  w.remote.z[bag] = 110;
  expect(drawn()).toEqual([[2], 1]);
  // One draw holds every stone, so one lying near keeps the far ones fine too.
  w.place("core:bag", 32, 23, { held: "core:stone" });
  expect(drawn()).toEqual([[0], 2]);
});
