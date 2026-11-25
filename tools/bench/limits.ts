// Benchmark rows for the limits a crowd meets: more bodies around one place than a server shows anyone, and a whole view
// of bodies drawn in one frame. tools/bench.ts calls them. They are functions so that they can be run on a small world too.

import { tierOf } from "../../client/core/assets/tiers.ts";
import type { Camera } from "../../client/core/render/camera.ts";
import { DRAW_ONE_BONE, MAX_BONES } from "../../client/core/render/packet.ts";
import type { Scene } from "../../client/core/render/scene.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import type { Host } from "../../server/host.ts";
import { SLOT_NAMES } from "../../shared/anim/human.ts";
import { LOOK_BYTES, randomLook } from "../../shared/anim/look.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, TICK_RATE } from "../../shared/coords.ts";
import type { LoopbackEnd } from "../../shared/net/loopback.ts";
import { MAX_VIEW, VIEW_DEFAULT } from "../../shared/net/view.ts";
import { Rng } from "../../shared/rng.ts";
import { MODE_FLYER } from "../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ACT_NONE } from "../../shared/sim/weapon.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { perCascade } from "./shadow.ts";

export interface Bench {
  section(title: string): void;
  record(name: string, value: number, unit: string, budget?: number | null): void;
  percentile(sorted: number[], q: number): number;
}

/**
 * Every survivor with a body is put in one 18 m square at (x, z), with 2,000 new creatures around them. `run` ticks the
 * server and its clients. `asker` is a whole client among them, and asks for as many bodies as a view holds.
 */
export function crowdRows(b: Bench, host: Host, run: (ticks: number, times: number[] | null) => void, asker: ClientSession, x: number, z: number): void {
  b.section("Crowd: every survivor and 2,000 more creatures in one place, twice what the server shows anyone");
  const game = host.game;
  const ents = host.world.ents;
  const hf = host.world.hf;
  const spot = new Rng(79);
  let survivors = 0;
  for (const c of game.clients) {
    if (!c?.active || c.ent < 0) continue;
    const [px, pz] = [x + spot.range(-9, 9), z + spot.range(-9, 9)];
    ents.setPosition(c.ent, px, hf.heightAt(px, pz), pz);
    survivors++;
  }
  let herd = 0;
  for (let tries = 0; herd < 2000 && tries < 100000; tries++) {
    if (host.spawnCreature("core:grazer", x + spot.range(-60, 60), z + spot.range(-60, 60), 1 + spot.int(30)) >= 0) herd++;
  }
  asker.view(MAX_VIEW, 1100);
  // Ten seconds, so that the asking client, come from far off, holds its whole view before anything is measured.
  run(300, null);
  const overflows = game.stats.overflows;
  const undecodable = asker.stats.undecodable;
  const sent = game.clients.map((c) => (c ? (c.conn as LoopbackEnd).bytesSent : 0));
  // The bodies the asking client shows, read after every tick: what it holds swings as it walks over chunk borders.
  const shown = new RemoteSample();
  const held: number[] = [];
  // Read after the client's own update, outside the tick's timer.
  const update = asker.update.bind(asker);
  asker.update = (...args: Parameters<ClientSession["update"]>) => {
    const out = update(...args);
    asker.sampleRemote(shown);
    held.push(shown.count);
    return out;
  };
  const ticks: number[] = [];
  const TICKS = 600;
  run(TICKS, ticks);
  ticks.sort((p, q) => p - q);
  const down = game.clients.map((c, i) => (c ? ((c.conn as LoopbackEnd).bytesSent - sent[i]!) / (TICKS / TICK_RATE) : 0)).filter((v) => v > 0);
  const end = held[held.length - 1]!;
  const cap = game.opts.viewCap;
  const short = held.map((n) => cap - 1 - n).sort((p, q) => p - q);
  // A client that never asked, and the view the server holds it to have after its newest snapshot.
  const quiet = game.clients.find((c) => c?.active && !c.closed && c.ent >= 0 && c.viewCap === 0);
  b.record("survivors there", survivors, "");
  b.record("creatures that could not be put among them, of 2,000", 2000 - herd, "", 0);
  b.record("tick time, median", b.percentile(ticks, 0.5), "ms", 8);
  b.record("tick time, 99th percentile", b.percentile(ticks, 0.99), "ms", 16);
  b.record("downstream per client", down.reduce((a, v) => a + v, 0) / down.length / 1024, "KB/s", 36);
  b.record(`bodies shown to the client that asked for 2,048, of the ${cap.toLocaleString("en-US")} the server allows, at the end`, end, "");
  b.record(`bodies it was short of the ${(cap - 1).toLocaleString("en-US")} others it may be shown, median over the 600 ticks`, b.percentile(short, 0.5), "", 64);
  // The floor follows the cap: 88% of what it may be shown, 900 of 1,023.
  const floor = Math.floor((cap - 1) * 0.88);
  b.record(`ticks of the 600 it was shown fewer than ${floor.toLocaleString("en-US")}`, held.filter((n) => n < floor).length, "", 30);
  b.record("bodies shown to a client that never asked, of 512", quiet?.views.find(quiet.lastSnapshot)?.count ?? 0, "", VIEW_DEFAULT);
  b.record("snapshots that outgrew the server's writer and were not sent", game.stats.overflows - overflows, "", 0);
  b.record("snapshots the asking client could not decode", asker.stats.undecodable - undecodable, "", 0);
  // The asking client steps 2 m over the nearest chunk border, still in the crowd: its view is gathered round the next chunk.
  const e = ents.resolve(asker.ownHandle);
  held.length = 0;
  if (e >= 0) {
    const [ax, az] = [ents.x[e]!, ents.z[e]!];
    const [ex, ez] = [ax - Math.floor(ax / CHUNK_SIZE) * CHUNK_SIZE, az - Math.floor(az / CHUNK_SIZE) * CHUNK_SIZE];
    const near = Math.min(ex, CHUNK_SIZE - ex, ez, CHUNK_SIZE - ez);
    const [px, pz] = near === ex ? [ax - ex - 2, az] : near === CHUNK_SIZE - ex ? [ax - ex + CHUNK_SIZE + 2, az] : near === ez ? [ax, az - ez - 2] : [ax, az - ez + CHUNK_SIZE + 2];
    ents.setPosition(e, px, hf.heightAt(px, pz), pz);
    run(3 * TICK_RATE, null);
  }
  asker.update = update;
  const least = Math.min(end, ...held);
  // None, where it never held fewer than all but 32.
  const fell = held.findIndex((n) => n < end - 32);
  const back = fell < 0 ? -1 : held.findIndex((n, i) => i > fell && n >= end - 32);
  b.record("bodies it lost at worst after a 2 m step into the next chunk", end - least, "", 128);
  b.record("ticks after the step before it held all but 32 of them again", fell < 0 ? 0 : back < 0 ? held.length : back + 1, "", 45);
}

/** A whole view of bodies ahead of the camera, drawn on the top graphics tier and then on medium. The camera is turned to face -X. */
export function fullViewRows(b: Bench, scene: Scene, cam: Camera, reg: Registry, hf: Heightfield): void {
  b.section("Client frame build (headless): 2,048 bodies in sight, as many as a view holds, on ultra and on medium");
  const view = new RemoteSample();
  const id = (name: string): number => reg.index.get(`core:${name}`)!;
  const [survivor, pteranodon, saddle] = [id("survivor"), id("pteranodon"), id("saddle_pteranodon")];
  const creatures = ["dodo", "pteranodon", "raptor", "parasaur"].map(id);
  const vehicles = ["compact", "helicopter", "boat"].map(id);
  const armour = ["hide", "chitin", "flak"].map((set) => {
    const worn = new Array<number>(SLOT_NAMES.length).fill(0);
    reg.defs.forEach((d, k) => d?.type === "item" && d.wear && d.id.startsWith(`core:${set}_`) && (worn[SLOT_NAMES.indexOf(d.wear.slot)] = k));
    return worn;
  });
  const held = [id("rifle"), id("hatchet"), id("spear")];
  const st = new AnimState();
  const rng = new Rng(11);
  // In a wedge 14 to 160 m ahead: 100 survivors dressed, armed and with looks of their own; 64 more riding saddled
  // pteranodons; 16 each of the car, the helicopter and the boat; and dodos, pteranodons (half of them flying), raptors and
  // parasaurs. A third of them walk.
  cam.yaw = Math.PI / 2 + Math.PI;
  for (let i = 0; i < MAX_VIEW; i++) {
    const rider = i >= 100 && i < 228 && i % 2 === 1;
    const ahead = 14 + rng.float() * 146;
    view.id[i] = i + 1;
    view.kind[i] = i < 100 || rider ? survivor : i < 228 ? pteranodon : i < 276 ? vehicles[i % 3]! : creatures[i % 4]!;
    view.x[i] = rider ? view.x[i - 1]! : cam.x - ahead;
    view.z[i] = rider ? view.z[i - 1]! : cam.z + (rng.float() - 0.5) * ahead * 1.2;
    view.y[i] = hf.heightAt(view.x[i]!, view.z[i]!);
    view.yaw[i] = rng.float() * Math.PI * 2;
    view.flags[i] = 1;
    [st.mode, st.grounded] = [0, true];
    if (view.kind[i] === pteranodon && i >= 276 && i % 8 === 1) [st.mode, st.grounded, view.y[i]] = [MODE_FLYER, false, view.y[i]! + 20];
    st.setMotion(i % 3 === 1 ? 2 + rng.float() * 4 : 0, 0, 0, 0);
    st.setAction(ACT_NONE, 0, 0);
    view.anim[i] = st.pack();
    if (i < 228 && i >= 100 && !rider) view.gear[i * GEAR_COUNT + GEAR_WORN] = saddle;
    if (rider) [view.seat[i], view.seatSlot[i]] = [i + 1, 0];
    if (view.kind[i] !== survivor) continue;
    view.hasLook[i] = 1;
    randomLook(rng, view.look.subarray(i * LOOK_BYTES, (i + 1) * LOOK_BYTES));
    armour[i % 3]!.forEach((item, slot) => (view.gear[i * GEAR_COUNT + GEAR_WORN + slot] = item));
    view.gear[i * GEAR_COUNT + GEAR_HELD] = held[i % 3]!;
  }
  view.count = MAX_VIEW;
  view.tick = 3000;
  const before = scene.assets.tier;
  for (const name of ["ultra", "medium"]) {
    const tier = (scene.assets.tier = tierOf(name));
    let packet = scene.build(cam, view);
    const built: number[] = [];
    for (let i = 0; i < 200; i++) {
      view.tick += 0.5;
      const t = performance.now();
      packet = scene.build(cam, view);
      built.push(performance.now() - t);
    }
    built.sort((p, q) => p - q);
    const rigid = new Set<number>();
    for (let d = 0; d < packet.drawCount; d++) {
      if ((packet.drawFlags[d]! & DRAW_ONE_BONE) === 0) continue;
      for (let k = 0; k < packet.drawInstances[d]!; k++) rigid.add(packet.transientIds[packet.drawFirst[d]! + k]!);
    }
    b.record(`${name}: bodies posed in the frame`, scene.characters.posed, "");
    b.record(`${name}: of them posed anew, the rest drawn as they last were`, scene.characters.fresh, "");
    b.record(`${name}: bodies standing in a pose on one bone, for want of bones`, rigid.size, "");
    b.record(`${name}: bones used, of the ${Math.min(tier.bones, MAX_BONES).toLocaleString("en-US")} it has`, packet.boneCount, "", Math.min(tier.bones, MAX_BONES));
    b.record(`${name}: things the full frame left out`, packet.dropped, "", 0);
    b.record(`${name}: triangles submitted`, packet.triangles, "");
    b.record(`${name}: frame build, median`, b.percentile(built, 0.5), "ms", 6);
    b.record(`${name}: frame build, 99th percentile`, b.percentile(built, 0.99), "ms", 12);
    b.record(`${name}: draw calls`, packet.drawCount, "");
    const cast = perCascade(scene, packet);
    b.record(`${name}: triangles cast into the sun's maps, and their draws`, cast.triangles.reduce((a, v) => a + v, 0), `(${cast.draws.reduce((a, v) => a + v, 0)} draws)`);
  }
  scene.assets.tier = before;
}
