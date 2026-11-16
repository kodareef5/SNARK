// The asset library streaming levels over a slow, lossy network: what is drawn is always on the card, the card stays
// within its budget, and what cannot be had is given up on without the scene going bare.
import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { IN_FLIGHT, IN_FLIGHT_SHARED, OVERFLOW, SMALL_LANES, SMALL_LANES_SHARED, SMALL_PART } from "../../client/core/assets/residency.ts";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { stressSet } from "../../tools/pack/stress.ts";
import { FakeNet, type NetOptions } from "../fixtures/assetnet.ts";
import { stressThings } from "../../client/core/stress.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { FRAME_MS, assetWorld, type Thing } from "../fixtures/assetworld.ts";
import { coreRegistry } from "../fixtures/world.ts";

const SET = stressSet({ rocks: 24, detail: 4, plate: 64 });
const BOOT = parsePack(SET.files[0]!.bytes);
const REG = coreRegistry();
const FRAME = FRAME_MS;
const meshOf = (id: string): number => SET.manifest.meshes.findIndex((m) => m.id === id);
/** The finest level of a mesh that the boot pack holds. */
const inBoot = (mesh: number): number => SET.manifest.meshes[mesh]!.levels.findIndex((l) => l.file === 0);
const ROCKS = Array.from({ length: 24 }, (_, i) => ({ mesh: meshOf(`stress:rock_${String(i).padStart(2, "0")}`), z: 10 + 12 * i }));

const world = (net: NetOptions = {}, tier: Partial<Tier> = {}, things: readonly Thing[] = ROCKS) => assetWorld(SET, things, net, tier);

test("flying through a field of rocks on a slow, lossy link: nothing is drawn that the card lacks, and nothing is left out", () => {
  const w = world({ latencyMs: 300, bytesPerSecond: 1.5e6, loss: 0.02, seed: 3 });
  w.frame(0);
  // The first frame draws every rock from the boot pack: its two coarsest levels, of four.
  expect([inBoot(ROCKS[0]!.mesh), w.coarse(), [...w.wanted].some((l) => l < 2)]).toEqual([2, true, true]);
  expect(w.r.stats.skipped).toBe(0);
  const end = w.run(14, 0, 20);
  expect(end).toBeCloseTo(280, 0);
  expect(w.r.stats.skipped).toBe(0);
  // Standing still at the end, every rock comes to the level wanted of it, and then nothing more is asked or let go.
  w.run(8, end);
  expect(w.settled()).toBe(true);
  const { requests, evicted } = w.r.stats;
  w.run(5, end);
  expect([w.r.stats.requests - requests, w.r.stats.evicted - evicted, w.r.flying]).toEqual([0, 0, 0]);

  // Requests under way never pass the cap, a large part never takes a small part's lane, and a frame's uploads keep to the tier's bytes.
  expect(w.port.mostAtOnce).toBeLessThanOrEqual(IN_FLIGHT);
  expect(w.port.mostAtOnce).toBeGreaterThan(1);
  expect(w.mostUploaded()).toBeLessThanOrEqual(tierOf("medium").uploadBytes);
  // No rock changes level more than twice in any second.
  for (const times of w.switches) for (let i = 2; i < times.length; i++) expect(times[i]! - times[i - 2]!).toBeGreaterThan(1000);
  // Most of what was fetched was drawn.
  expect(w.r.stats.fetched / w.r.stats.used).toBeLessThan(1.6);
});

test("over HTTP/2 or 3 more requests are under way at once, and the flight settles as it does over HTTP/1.1", () => {
  const [one, shared] = ["http/1.1", "h2"].map((protocol) => {
    const w = world({ latencyMs: 300, bytesPerSecond: 1.5e6, protocol });
    w.run(8, 0);
    return w;
  });
  expect([one!.port.mostAtOnce, shared!.port.mostAtOnce > IN_FLIGHT, shared!.port.mostAtOnce <= IN_FLIGHT_SHARED]).toEqual([IN_FLIGHT, true, true]);
  expect([one!.settled(), shared!.settled(), shared!.r.stats.skipped, shared!.r.stats.used]).toEqual([true, true, 0, one!.r.stats.used]);
});

test("the same flight twice asks for the same things in the same order", () => {
  const logs = [0, 1].map(() => {
    const w = world({ latencyMs: 120, bytesPerSecond: 2e6, loss: 0.05, seed: 11 });
    w.run(6, 0, 30);
    return w.port.log;
  });
  expect(logs[0]!.length).toBeGreaterThan(20);
  expect(logs[1]).toEqual(logs[0]!);
});

test("the card keeps to its budget: the least lately drawn goes, and what one frame draws stays", () => {
  const finest = (mesh: number): number => SET.manifest.meshes[mesh]!.levels[0]!.parts[0]!.bytes;
  // Room for the boot levels and ten rocks at their finest: less than the flight draws in all.
  const budget = BOOT.blob.length + 10 * finest(ROCKS[0]!.mesh);
  const w = world({ bytesPerSecond: 20e6 }, { gpuBytes: budget });
  const end = w.run(20, 0, 14);
  w.run(4, end);
  expect(w.r.stats.evicted).toBeGreaterThan(8);
  expect(w.card.most).toBeLessThanOrEqual(budget * OVERFLOW);
  expect(w.card.bytes).toBe(w.r.ledger);
  expect(w.r.stats.skipped).toBe(0);

  // A budget that one frame's rocks alone pass: everything is asked for coarser until they fit.
  const tight = world({ bytesPerSecond: 50e6 }, { gpuBytes: BOOT.blob.length + finest(ROCKS[0]!.mesh) * 1.5 }, ROCKS.map((r) => ({ mesh: r.mesh, z: 8 })));
  tight.run(20, 0);
  expect(tight.r.relax).toBeGreaterThan(1);
  expect(tight.card.most).toBeLessThanOrEqual((BOOT.blob.length + finest(ROCKS[0]!.mesh) * 1.5) * OVERFLOW);
  expect(tight.r.stats.skipped).toBe(0);
  const asked = tight.r.stats.requests;
  tight.run(10, 0);
  // Settled: it does not go on fetching and letting go.
  expect(tight.r.stats.requests - asked).toBeLessThan(4);
});

test("a part that cannot be had: the wrong hash is asked for twice, a range past the end once, and a short one ever more seldom", () => {
  const bad = ["hash", "range", "short"].map((kind, i) => ({ mesh: meshOf(`stress:bad_${kind}`), z: 5 + i }));
  const w = world({ latencyMs: 20, bytesPerSecond: 50e6 }, {}, bad);
  w.run(70, 0);
  const asks = (mesh: number): string[] => w.port.log.filter((line) => line.split(" ")[2] === String(w.r.slot(mesh, 0)));
  expect(asks(bad[0]!.mesh).map((l) => l.endsWith("fresh"))).toEqual([false, true]);
  expect(asks(bad[1]!.mesh).length).toBe(1);
  // After 1, 2, 4 and 8 seconds, then every 30: six or seven tries in 70 seconds, and not one a frame.
  expect(asks(bad[2]!.mesh).length).toBeGreaterThanOrEqual(6);
  expect(asks(bad[2]!.mesh).length).toBeLessThanOrEqual(8);
  expect(w.r.stats.dead).toBe(2);
  // Each failure is counted by its kind, so a report can say which it was.
  const { failHash, failRange, failNet } = w.r.stats;
  expect([failHash, failRange, failNet >= asks(bad[2]!.mesh).length - 1, failNet <= asks(bad[2]!.mesh).length]).toEqual([2, 1, true, true]);
  // Each is drawn all the while at the next level down, which could be had.
  expect([...w.wanted]).toEqual([0, 0, 0]);
  expect([...w.drawn]).toEqual([1, 1, 1]);
  expect(w.r.stats.skipped).toBe(0);
});

test("with the network down everything is still drawn, coarsely, and the asking thins out", () => {
  const w = world({ latencyMs: 50, loss: 1 });
  w.run(60, 40);
  expect(w.r.stats.skipped).toBe(0);
  expect(w.coarse()).toBe(true);
  const wantedSlots = new Set(w.port.log.map((l) => l.split(" ")[2])).size;
  expect(wantedSlots).toBeGreaterThan(10);
  expect(w.r.stats.requests).toBeLessThanOrEqual(wantedSlots * 7);
  // The network comes back, and within the slow retry's wait so does the detail.
  w.port.loss = 0;
  w.run(45, 40);
  expect(w.settled()).toBe(true);
});

test("a slot given up on its way is not taken when it comes, and a card that loses everything is filled again", () => {
  // A port that delivers what was cancelled, as a careless one might.
  const w = world({ latencyMs: 900, bytesPerSecond: 5e6 });
  const cancel = w.port.cancel.bind(w.port);
  const rude: number[] = [];
  w.port.cancel = (slot) => void rude.push(slot);
  // Past the near rocks in a flash: what was asked for there is not wanted when it arrives.
  w.run(0.3, 0);
  const asked = w.r.stats.requests;
  expect(asked).toBeGreaterThan(0);
  const end = w.run(1.2, 2000);
  expect(rude.length).toBeGreaterThan(0);
  w.run(3, end);
  for (const slot of rude) expect(w.card.held.has(slot)).toBe(false);
  expect(w.r.flying).toBe(0);
  w.port.cancel = cancel;

  const back = w.run(6, 100);
  expect(w.settled()).toBe(true);
  const held = w.card.held.size;
  expect(held).toBeGreaterThan(ROCKS.length);
  // The context is lost: the card is empty and the library is told.
  w.card.held.clear();
  w.card.bytes = 0;
  w.r.reset();
  w.frame(back);
  expect(w.r.stats.skipped).toBe(0);
  expect(w.coarse()).toBe(true);
  w.run(6, back);
  expect(w.settled()).toBe(true);
  // What was held only because it had been drawn earlier is not fetched again.
  expect(w.card.held.size).toBeLessThanOrEqual(held);
  expect(w.card.held.size).toBeGreaterThan(ROCKS.length);
});

test.each([
  ["http/1.1", IN_FLIGHT - SMALL_LANES],
  ["h3", IN_FLIGHT_SHARED - SMALL_LANES_SHARED],
])("over %s a large part waits its turn without holding up small ones, and goes onto the card in pieces of a frame's bytes", (protocol, lanes) => {
  const plate = meshOf("stress:plate");
  const big = stressSet({ rocks: 2, detail: 3, plate: 512 });
  const boot = parsePack(big.files[0]!.bytes);
  const port = new FakeNet(big.files.map((f) => f.bytes), { bytesPerSecond: 40e6, protocol });
  const assets = new Assets(REG, boot, big.manifest, port);
  const packet = new FramePacket();
  const mesh = big.manifest.meshes.findIndex((m) => m.id === "stress:plate");
  expect(plate).toBeGreaterThan(0);
  const sizes = big.manifest.meshes[mesh]!.levels.map((l) => l.parts[0]!.bytes);
  expect(sizes[0]!).toBeGreaterThan(8e6);
  expect(big.manifest.meshes[mesh]!.levels.map((l) => l.index)).toEqual([4, 4, 2, 2, 2]);
  let now = 0;
  let largeAtOnce = 0;
  let mostSent = 0;
  const seen: number[] = [];
  const pieces: number[] = [];
  for (let f = 0; f < 240; f++) {
    now += FRAME;
    port.advance(now);
    packet.beginFrame();
    assets.begin(now, 720, 1.2217);
    // Every level of the plate is wanted at once, as by five things at five distances.
    for (let l = 0; l < sizes.length; l++) {
      assets.want(mesh, l, 10 * (l + 1));
      assets.level(mesh, l);
    }
    assets.end(packet, now);
    for (const u of packet.assetUploads) if ((u.at ?? 0) === 0) seen.push(u.level);
    for (const u of packet.assetUploads) if (u.whole !== undefined) pieces.push(u.data.length);
    mostSent = Math.max(mostSent, packet.assetUploads.reduce((sum, u) => sum + (u.level === sizes.length - 1 ? 0 : u.data.length), 0));
    largeAtOnce = Math.max(largeAtOnce, port.log.filter((line) => line.includes(" ask ")).length - seen.filter((l) => sizes[l]! > SMALL_PART && l !== sizes.length - 1).length);
  }
  // The coarsest came from the boot pack in the first frame. The finest is larger than a frame's bytes and went up in
  // pieces of the frame's bytes, as did any other the frame had no room left for.
  expect(seen[0]).toBe(sizes.length - 1);
  expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  expect([pieces.length > sizes[0]! / tierOf("medium").uploadBytes, mostSent]).toEqual([true, tierOf("medium").uploadBytes]);
  expect(largeAtOnce).toBeLessThanOrEqual(lanes);
  expect(assets.residency.ledger).toBe(sizes.reduce((a, b) => a + b, 0));
});

test("a card that refuses a level or loses everything is asked less of: a quarter less each time, and a tier less on the third", () => {
  const w = world({ bytesPerSecond: 50e6 });
  w.run(4, 100);
  expect(w.settled()).toBe(true);
  // The card could not give memory to a level it was sent, and the shell says so.
  const slot = [...w.card.held.keys()].find((k) => SET.manifest.meshes.some((m, i) => m.levels.some((l, n) => l.file === 1 && w.r.slot(i, n) === k)))!;
  w.card.bytes -= w.card.held.get(slot)!;
  w.card.held.delete(slot);
  const [budget, ledger] = [w.r.budget, w.r.ledger];
  w.r.failed(slot);
  expect(w.r.ledger).toBeLessThan(ledger);
  expect(w.assets.pressure()).toBe(false);
  w.frame(100);
  expect(w.r.budget).toBeCloseTo(budget * 0.75, 0);
  // It is fetched and sent again, and the scene is whole.
  w.run(3, 100);
  expect([w.settled(), w.card.held.has(slot), w.r.stats.skipped]).toEqual([true, true, 0]);
  // The third time, the tier falls by one. At the lowest it falls no further.
  expect([w.assets.pressure(), w.assets.pressure(), w.assets.tier.name]).toEqual([false, true, "lowpoly"]);
  expect([w.assets.pressure(), w.assets.pressure(), w.assets.pressure(), w.assets.tier.name]).toEqual([false, false, false, "lowpoly"]);
  w.frame(100);
  expect(w.r.budget).toBeCloseTo(tierOf("lowpoly").gpuBytes * 0.75 ** 6, 0);
});

test("what the card holds besides assets comes off the budget levels and textures share, and a squeeze takes the whole card down", () => {
  // A card of a megabyte, which the rocks fill to about two thirds.
  const MB = 1024 * 1024;
  const w = world({ bytesPerSecond: 50e6 }, { gpuBytes: MB });
  w.run(4, 100);
  const held = w.card.bytes;
  expect([w.settled(), held > 0.6 * MB]).toEqual([true, true]);
  // Terrain pictures, and shadow maps asked for again at another size.
  w.r.reserve("terrain", 200_000);
  w.r.reserve("shadows", 300_000);
  w.r.reserve("shadows", 400_000);
  w.frame(100);
  expect([w.r.reserved, w.r.budget, w.r.texBudget]).toEqual([600_000, MB - 600_000, (MB - 600_000) * 0.6]);
  // Levels make way: the rocks are drawn coarser until what the card holds is within what is left.
  w.run(3, 100);
  expect([w.card.bytes < held, w.card.bytes <= w.r.budget * OVERFLOW, w.r.stats.skipped]).toEqual([true, true, 0]);
  // A squeeze takes a quarter off the whole card, and the reserve stays inside it.
  w.assets.pressure();
  w.frame(100);
  expect(w.r.budget).toBeCloseTo(MB * 0.75 - 600_000, 6);
  w.r.reserve("shadows", 0);
  w.frame(100);
  expect([w.r.reserved, w.r.budget]).toEqual([200_000, MB * 0.75 - 200_000]);
});

test("what goes onto the card besides assets is spent from the frame's allowance first, and an asset still goes in every frame", () => {
  const streamed = (w: ReturnType<typeof world>): number[] => w.packet.assetUploads.filter((u) => SET.manifest.meshes[u.mesh]!.levels[u.level]!.file !== 0).map((u) => u.data.length);
  const allowance = tierOf("medium").uploadBytes;
  // A quarter of the allowance left, and then none: the rocks still come, one a frame.
  for (const spent of [allowance * 0.75, allowance * 2]) {
    const w = world({ bytesPerSecond: 50e6 });
    w.spend(spent);
    let most = 0;
    for (let f = 0; f < 240; f++) {
      w.frame(100);
      const sent = streamed(w);
      if (sent.length > 1) most = Math.max(most, sent.reduce((a, b) => a + b, 0));
      if (spent > allowance) expect(sent.length).toBeLessThanOrEqual(1);
    }
    expect([most <= Math.max(0, allowance - spent), w.settled()]).toEqual([true, true]);
  }
});

test("asked to keep everything, the library asks the port for every level outside the boot pack and hands none to the card", () => {
  const w = world();
  w.frame(40);
  const before = w.card.held.size;
  const bytes = w.r.download();
  const stream = SET.manifest.meshes.flatMap((m) => m.levels.filter((l) => l.file === 1).map((l) => l.parts[0]!.bytes));
  expect([w.port.filled.length, bytes]).toEqual([stream.length, stream.reduce((a, b) => a + b, 0)]);
  expect(w.port.filled).toEqual(stream);
  expect(w.card.held.size).toBe(before);
  expect(w.r.cache).toEqual({ used: 0, limit: 0, mode: "none", filling: 0 });
});

test("the stress scene hangs three rocks ahead at distances that ask for three levels, and keeps the rest to the sides", () => {
  const flat = { heightAt: () => 0 } as unknown as Heightfield;
  const core = new Assets(REG, parsePack(corePackBytes()));
  expect(stressThings(core, flat, { x: 0, z: 0 }, 1.6)).toEqual({ things: [], marks: [] });

  const assets = new Assets(REG, BOOT, SET.manifest, new FakeNet(SET.files.map((f) => f.bytes)));
  const { things, marks } = stressThings(assets, flat, { x: 100, z: 50 }, 1.6);
  // 24 rocks, the three listed wrongly, and the plate.
  expect(things.length).toBe(28);
  expect(marks.map((m) => m.level)).toEqual([1, 2, 3]);
  for (const m of marks) {
    const far = Math.hypot(m.x - 100, m.y - 1.6, m.z - 50);
    // The level is the one that distance asks for, with room either way.
    expect([assets.choose(assets.table.error[things[m.thing]!.mesh]!, far * 0.85, -1), assets.choose(assets.table.error[things[m.thing]!.mesh]!, far * 1.15, -1)]).toEqual([m.level, m.level]);
    expect(m.y).toBeGreaterThan(1.6);
  }
  // Everything on the ground is at least 30 degrees to one side of straight ahead.
  for (const t of things.slice(3)) expect(Math.abs(Math.atan2(t.x - 100, t.z - 50))).toBeGreaterThan((29.9 * Math.PI) / 180);
  // The rocks listed wrongly are near enough that their finest level is wanted.
  for (const t of things.slice(24, 27)) expect(assets.choose(assets.table.error[t.mesh]!, Math.hypot(t.x - 100, t.z - 50), -1)).toBe(0);
  expect(assets.line()).toMatch(/^assets: 0\.0 MB on the card, 0 coming/);
});
