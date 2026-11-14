// Benchmark rows for the limits a crowd meets: more bodies around one place than a server shows anyone, and a whole view
// of bodies drawn in one frame. tools/bench.ts calls them. They are functions so that they can be run on a small world too.

import { tierOf } from "../../client/core/assets/tiers.ts";
import type { Camera } from "../../client/core/render/camera.ts";
import { DRAW_ONE_BONE, MAX_BONES } from "../../client/core/render/packet.ts";
import type { Scene } from "../../client/core/render/scene.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import type { Host } from "../../server/host.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { LoopbackEnd } from "../../shared/net/loopback.ts";
import { MAX_VIEW, VIEW_DEFAULT } from "../../shared/net/view.ts";
import { Rng } from "../../shared/rng.ts";
import { ACT_NONE } from "../../shared/sim/weapon.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";

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
  run(150, null);
  const overflows = game.stats.overflows;
  const undecodable = asker.stats.undecodable;
  const sent = game.clients.map((c) => (c ? (c.conn as LoopbackEnd).bytesSent : 0));
  const ticks: number[] = [];
  const TICKS = 600;
  run(TICKS, ticks);
  ticks.sort((p, q) => p - q);
  const down = game.clients.map((c, i) => (c ? ((c.conn as LoopbackEnd).bytesSent - sent[i]!) / (TICKS / TICK_RATE) : 0)).filter((v) => v > 0);
  const shown = new RemoteSample();
  asker.sampleRemote(shown);
  // A client that never asked, and the view the server holds it to have after its newest snapshot.
  const quiet = game.clients.find((c) => c?.active && !c.closed && c.ent >= 0 && c.viewCap === 0);
  b.record("survivors there", survivors, "");
  b.record("creatures that could not be put among them, of 2,000", 2000 - herd, "", 0);
  b.record("tick time, median", b.percentile(ticks, 0.5), "ms", 8);
  b.record("tick time, 99th percentile", b.percentile(ticks, 0.99), "ms", 16);
  b.record("downstream per client", down.reduce((a, v) => a + v, 0) / down.length / 1024, "KB/s", 36);
  b.record("bodies shown to the client that asked for 2,048, of the 1,024 the server allows", shown.count, "", game.opts.viewCap);
  b.record("bodies shown to a client that never asked, of 512", quiet?.views.find(quiet.lastSnapshot)?.count ?? 0, "", VIEW_DEFAULT);
  b.record("snapshots that outgrew the server's writer and were not sent", game.stats.overflows - overflows, "", 0);
  b.record("snapshots the asking client could not decode", asker.stats.undecodable - undecodable, "", 0);
}

/** A whole view of bodies ahead of the camera, drawn on the top graphics tier and then on medium. The camera is turned to face -X. */
export function fullViewRows(b: Bench, scene: Scene, cam: Camera, reg: Registry, hf: Heightfield): void {
  b.section("Client frame build (headless): 2,048 bodies in sight, as many as a view holds, on ultra and on medium");
  const view = new RemoteSample();
  const kinds = { survivor: reg.index.get("core:survivor")!, parasaur: reg.index.get("core:parasaur")!, raptor: reg.index.get("core:raptor")! };
  const st = new AnimState();
  const rng = new Rng(11);
  // A hundred survivors and the rest creatures, in a wedge 14 to 160 m ahead. A third of them walk.
  cam.yaw = Math.PI / 2 + Math.PI;
  for (let i = 0; i < MAX_VIEW; i++) {
    const ahead = 14 + rng.float() * 146;
    view.id[i] = i + 1;
    view.kind[i] = i < 100 ? kinds.survivor : i % 3 === 0 ? kinds.raptor : kinds.parasaur;
    view.x[i] = cam.x - ahead;
    view.z[i] = cam.z + (rng.float() - 0.5) * ahead * 1.2;
    view.y[i] = hf.heightAt(view.x[i]!, view.z[i]!);
    view.yaw[i] = rng.float() * Math.PI * 2;
    view.flags[i] = 1;
    st.setMotion(i % 3 === 1 ? 2 + rng.float() * 4 : 0, 0, 0, 0);
    st.setAction(ACT_NONE, 0, 0);
    view.anim[i] = st.pack();
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
    b.record(`${name}: bodies left in their rest pose on one bone, for want of bones`, rigid.size, "");
    b.record(`${name}: bones used, of the ${Math.min(tier.bones, MAX_BONES).toLocaleString("en-US")} it has`, packet.boneCount, "", Math.min(tier.bones, MAX_BONES));
    b.record(`${name}: things the full frame left out`, packet.dropped, "", 0);
    b.record(`${name}: triangles submitted`, packet.triangles, "");
    b.record(`${name}: frame build, median`, b.percentile(built, 0.5), "ms", 6);
    b.record(`${name}: frame build, 99th percentile`, b.percentile(built, 0.99), "ms", 12);
    b.record(`${name}: draw calls`, packet.drawCount, "");
  }
  scene.assets.tier = before;
}
