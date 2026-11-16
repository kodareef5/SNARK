// Smoke and poison clouds (planning/reference/weapons-plan.md, W5; M7): a grenade with a cloud leaves it where it went off,
// the cloud gives its buff every half second to the survivors inside it and to nothing else, ends on time, and is not
// saved; and each client draws it as puffs that hide what is behind it.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Clouds as CloudLooks } from "../../client/core/render/clouds.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DETAIL, DETAIL_FLOATS, FramePacket, MAX_DETAILS } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CLOUD_EVERY, MAX_CLOUDS } from "../../server/clouds.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-clouds-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const TICK_MS = 1000 / TICK_RATE;

test("the smoke and poison grenades are ARK's: no harm, their fuses, clouds of 40 s across 9 m and 20 s across 6 m, and the gas poisons", () => {
  const [smoke, poison] = [id("grenade_smoke"), id("grenade_poison")];
  expect([reg.damage[smoke], reg.blast[smoke], reg.fuseTicks[smoke], reg.cloudProp[smoke], reg.cloudTicks[smoke], reg.cloudBuff[smoke]]).toEqual([0, 0, 150, id("cloud_smoke"), 40 * TICK_RATE, 0]);
  expect([reg.damage[poison], reg.blast[poison], reg.fuseTicks[poison], reg.cloudProp[poison], reg.cloudTicks[poison], reg.cloudBuff[poison]]).toEqual([0, 0, 75, id("cloud_poison"), 20 * TICK_RATE, id("poisoned")]);
  const prop = (name: string) => reg.defs[id(name)] as { radius: number; height: number };
  expect([prop("cloud_smoke").radius, prop("cloud_smoke").height, prop("cloud_poison").radius, prop("cloud_poison").height]).toEqual([9, 5, 6, 4]);
  // A cloud has no body: nothing aims at it, opens it or meets it.
  expect([reg.bodyRadius[id("cloud_smoke")], reg.bodyHeight[id("cloud_smoke")]]).toEqual([0, 0]);
  expect(reg.defs[id("poisoned")]).toMatchObject({ torpor: 25 });
  // Made in the hand from what exists of ARK's recipes, unlocked at ARK's levels for ARK's points.
  const engram = (item: number) => reg.defs.find((d) => d?.type === "engram" && d.item === reg.ids[item]) as { level: number; cost: number };
  expect([engram(smoke).level, engram(smoke).cost, engram(poison).level, engram(poison).cost]).toEqual([24, 18, 40, 18]);
  expect([reg.weight[smoke], reg.weight[poison], reg.stack[smoke], reg.stack[poison]]).toEqual([0.5, 1.5, 10, 10]);
});

test("a thrown poison grenade gasses where it lies after 2.5 s: a survivor in it gains torpor at its rate and stops soon after leaving, a dodo in it gains none, and it ends on time", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  const g = flatGround(h, 30, 40);
  const at = { x: g.x + 15, z: g.z + 4 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  // Bob stands well off to the side, out of it.
  h.say(bob, `tp ${(at.x + 13).toFixed(3)} ${(at.z + 30).toFixed(3)}`);
  const { survival, clouds, projectiles, records } = h.host;
  const ents = h.world.ents;
  const arec = records.byPid.get(ents.pid[h.ent(ada)]!)!;
  const brec = records.byPid.get(ents.pid[h.ent(bob)]!)!;
  const torpor = (rec: typeof arec): number => survival.value(rec, V_TORPOR);
  const health = (rec: typeof arec): number => survival.value(rec, V_HEALTH);
  expect(h.say(ada, "kit clouds")).toEqual(["gave 10 smoke grenade, 10 poison grenade"]);
  takeInHand(h, ada, id("grenade_poison"), 2);
  h.run(700);
  const pa = h.pilots[0]!;
  pa.yaw = 0;
  pa.pitch = 0.15;
  pa.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 12);
  pa.buttons &= ~BTN_PRIMARY;
  const thrown = h.world.tick;
  expect(projectiles.thrownCount).toBe(1);
  // Where it comes to rest, just before its fuse runs out.
  let lay = { x: 0, y: 0, z: 0 };
  while (projectiles.thrownCount > 0) {
    lay = { ...projectiles.thrownAt(0) };
    h.run(TICK_MS);
  }
  const burst = h.world.tick;
  expect(burst - thrown).toBeGreaterThanOrEqual(70);
  expect(burst - thrown).toBeLessThanOrEqual(78);
  expect([clouds.count, clouds.made, projectiles.bursts]).toEqual([1, 1, 1]);
  const ce = clouds.entityOf(0);
  expect(ents.kind[ce]).toBe(id("cloud_poison"));
  expect(Math.hypot(ents.x[ce]! - lay.x, ents.z[ce]! - lay.z)).toBeLessThan(0.5);
  // The clients are told how long it lasts and when it ends.
  const made = h.world.tick;
  expect([ents.span[ce], Math.abs(ents.grown[ce]! - (made + 600)) <= 2]).toEqual([600, true]);
  const seen = new RemoteSample();
  h.run(300);
  bob.sampleRemote(seen);
  const shown = [...seen.kind.subarray(0, seen.count)].indexOf(id("cloud_poison"));
  expect(shown).toBeGreaterThanOrEqual(0);
  expect(seen.span[shown]).toBe(600);
  // It did no harm as it went off: Ada threw it from 8 m or so, and nobody lost health.
  expect([health(arec), health(brec)]).toEqual([100, 100]);

  // Bob walks into it: his torpor rises at the gas's 25 a second, less the 4 a second a survivor sheds.
  const cx = ents.x[ce]!;
  const cz = ents.z[ce]!;
  h.say(bob, `tp ${cx.toFixed(3)} ${(cz + 2).toFixed(3)}`, 100);
  h.run(1000);
  const before = torpor(brec);
  h.run(4000);
  const rate = (torpor(brec) - before) / 4;
  expect(rate).toBeGreaterThan(20);
  expect(rate).toBeLessThan(25.5);
  expect(health(brec)).toBe(100);
  // A dodo standing in it gains nothing: creatures are immune.
  expect(h.say(ada, "spawn dodo")[0]).toMatch(/^spawned core:dodo/);
  const dodo = [...records.byPid.values()].find((r) => r.kind === id("dodo"))!;
  const de = records.entOf.get(dodo.pid)!;
  ents.setPosition(de, cx + 1, ents.y[ce]!, cz - 1);
  h.run(2000);
  expect(torpor(dodo)).toBe(0);
  expect(Math.hypot(ents.x[de]! - cx, ents.z[de]! - cz)).toBeLessThan(6);
  // Out of it, Bob's torpor stops rising within the last look's hold, and then falls.
  h.say(bob, `tp ${(cx + 20).toFixed(3)} ${cz.toFixed(3)}`, 100);
  h.run(800);
  const out = torpor(brec);
  h.run(2000);
  expect(torpor(brec)).toBeLessThan(out);
  expect(h.host.buffs.has(brec, id("poisoned"))).toBe(false);
  // It ends 20 s after it went off, to the tick, and its entity with it.
  const ends = ents.grown[ce]!;
  while (h.world.tick < ends - 1) h.run(TICK_MS);
  expect(clouds.count).toBe(1);
  h.run(TICK_MS * 3);
  expect(clouds.count).toBe(0);
  expect(ents.kind[ce] === id("cloud_poison") && ents.flags[ce] !== 0).toBe(false);
  h.run(500);
  bob.sampleRemote(seen);
  expect([...seen.kind.subarray(0, seen.count)].includes(id("cloud_poison"))).toBe(false);
  h.host.shutdown();
});

test("smoke gives nothing; on a PvE server gas spares other tribes but not its thrower; and a cloud is not saved", () => {
  const dbPath = join(dir, "clouds.db");
  let h = new Harness({}, 1, 60, { dev: true, dbPath });
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  const g = flatGround(h, 30, 30);
  const at = { x: g.x + 15, z: g.z + 15 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  h.say(bob, `tp ${(at.x + 2).toFixed(3)} ${at.z.toFixed(3)}`);
  const { survival, clouds, records, buffs } = h.host;
  const ents = h.world.ents;
  const arec = records.byPid.get(ents.pid[h.ent(ada)]!)!;
  const brec = records.byPid.get(ents.pid[h.ent(bob)]!)!;
  expect(arec.team !== brec.team && arec.team !== 0 && brec.team !== 0).toBe(true);
  const y = h.world.hf.heightAt(at.x, at.z);
  // Smoke over both of them: no buff, no torpor.
  clouds.make(id("grenade_smoke"), at.x + 1, y, at.z, arec.pid);
  h.run(2000);
  expect([clouds.count, clouds.gave, survival.value(arec, V_TORPOR), survival.value(brec, V_TORPOR)]).toEqual([1, 0, 0, 0]);

  // On a PvE server Ada's gas takes Ada and not Bob, of another tribe (Poison Grenade, 228.2).
  expect(h.say(ada, "setting serverPVE True")[0]).toMatch(/^serverPVE=True/);
  clouds.make(id("grenade_poison"), at.x + 1, y, at.z, arec.pid);
  h.run(CLOUD_EVERY * TICK_MS * 2 + 100);
  expect([buffs.has(arec, id("poisoned")), buffs.has(brec, id("poisoned"))]).toEqual([true, false]);
  h.say(ada, "setting serverPVE False");
  h.run(CLOUD_EVERY * TICK_MS + 100);
  expect([buffs.has(arec, id("poisoned")), buffs.has(brec, id("poisoned"))]).toEqual([true, true]);
  // A look every half second, at each survivor inside.
  const gave = clouds.gave;
  h.run(CLOUD_EVERY * TICK_MS * 4);
  expect(clouds.gave - gave).toBeGreaterThanOrEqual(7);
  expect(clouds.gave - gave).toBeLessThanOrEqual(10);

  // Saved and started again, no cloud stands: the clouds are a minute at most, and are not kept.
  expect(clouds.count).toBe(2);
  h.host.persistence!.commit();
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  const back = h.world.ents;
  let standing = 0;
  for (let i = 0; i < back.cap; i++) if (back.flags[i] !== 0 && (back.kind[i] === id("cloud_smoke") || back.kind[i] === id("cloud_poison"))) standing++;
  expect([standing, h.host.clouds.count]).toEqual([0, 0]);
  h.host.shutdown();
});

test("many clouds are cheap: of the most there may be, each gas looks at who is inside it once every half second and smoke never does, and all are drawn within the particles' room", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 60, 60);
  const { clouds } = h.host;
  const y = h.world.hf.heightAt(g.x + 30, g.z + 30);
  h.say(ada, `tp ${(g.x + 30).toFixed(3)} ${(g.z + 30).toFixed(3)}`);
  const pid = h.host.records.byPid.get(h.world.ents.pid[h.ent(ada)]!)!.pid;
  for (let k = 0; k < MAX_CLOUDS + 10; k++) clouds.make(id(k % 2 ? "grenade_poison" : "grenade_smoke"), g.x + (k % 16) * 3.7, y, g.z + Math.floor(k / 16) * 3.7, pid);
  // One more than the most and the oldest ends.
  expect([clouds.count, clouds.made]).toEqual([MAX_CLOUDS, MAX_CLOUDS + 10]);
  const looked = clouds.looked;
  h.run((2 * CLOUD_EVERY * 1000) / TICK_RATE);
  expect(clouds.looked - looked).toBe(2 * (MAX_CLOUDS / 2));

  // The client draws every one in view as puffs, the cut-out core first, and never more than the packet holds.
  const looks = new CloudLooks(reg, corePack().header.details, corePack().palette);
  h.run(500);
  const r = new RemoteSample();
  ada.sampleRemote(r);
  const inView = [...r.kind.subarray(0, r.count)].filter((k) => looks.kinds[k] === 1).length;
  expect(inView).toBeGreaterThan(50);
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.pitch] = [g.x + 30, y + 30, g.z - 30, -0.6];
  cam.update();
  const p = new FramePacket();
  const range = [0, 0];
  // The first frame makes each cloud's puffs, and the next places them.
  looks.write(p, cam, r, range);
  p.detailCount = 0;
  const cut = looks.write(p, cam, r, range);
  expect(cut).toBeGreaterThan(0);
  expect(p.detailCount).toBeLessThanOrEqual(MAX_DETAILS);
  expect(looks.written + looks.dropped).toBeGreaterThan(cut);
  // The cut-out core comes near to far, so a GPU skips what nearer puffs hide, and the see-through rim far to near.
  const far = (k: number): number => Math.hypot(p.details[k * DETAIL_FLOATS + DETAIL.middle]!, p.details[k * DETAIL_FLOATS + DETAIL.middle + 1]!, p.details[k * DETAIL_FLOATS + DETAIL.middle + 2]!);
  for (let k = 1; k < cut; k++) expect(far(k)).toBeGreaterThanOrEqual(far(k - 1) - 1 / 64);
  for (let k = cut + 1; k < p.detailCount; k++) expect(far(k)).toBeLessThanOrEqual(far(k - 1) + 1 / 64);
  h.host.shutdown();
});
