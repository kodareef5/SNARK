// CLIENT_DIR=client/dist bun tools/bench/weapon-effects.ts starts two fresh browsers on a flat range.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { App } from "../../client/core/app.ts";
import { DRAW_SKINNED, DRAW_TEXTURED } from "../../client/core/render/packet.ts";
import { startServer } from "../../server/main.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { shapedLink } from "../map/link.ts";
import { gameBrowser, until } from "./driving-browser.ts";

interface Seen {
  plasma: Record<string, number>;
  flat: number;
  frames: number;
  rocket: number;
  flame: number;
  lobes: number;
}

function observe(app: App, seen: Seen, skinned: number, textured: number): void {
  const drawn = app.drawn.bind(app);
  app.drawn = (packet, ...args) => {
    drawn(packet, ...args);
    seen.frames++;
    const scene = app.scene!;
    for (let i = 0; i < packet.drawCount; i++) {
      const flags = packet.drawFlags[i]!;
      if (!(flags & skinned)) continue;
      const mesh = scene.assets.manifest.meshes[packet.drawMesh[i]!]!.id;
      if (!["core:plasma_bolt", "core:plasma_flash", "core:plasma_burst"].includes(mesh)) continue;
      seen.plasma[mesh] = (seen.plasma[mesh] ?? 0) + 1;
      const material = scene.assets.table.materials[packet.drawMaterial[i]!]?.id;
      if (!(flags & textured) || material !== "core:plasma/plasma") seen.flat++;
    }
    if (app.shots.flying.some((round) => round.rocket)) seen.rocket++;
    if (scene.blasts.flames) seen.flame++;
    if (scene.blasts.lobes) seen.lobes++;
  };
}

interface Samples {
  active: boolean;
  gpu: number[];
  wall: number[];
  card: string;
}

async function measure(app: App, samples: Samples): Promise<void> {
  const port = await app.debugPort!();
  const drawn = app.drawn.bind(app);
  const last = new Float64Array(1);
  let previous = 0;
  app.drawn = (packet, ...args) => {
    drawn(packet, ...args);
    const at = port.now();
    if (samples.active) {
      if (port.gpu(1, last)) samples.gpu.push(last[0]!);
      if (previous) samples.wall.push(at - previous);
      previous = at;
    } else {
      port.gpu(0, last);
      previous = 0;
    }
  };
  samples.card = port.page().card;
}

function times(values: number[]) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return { frames: values.length, medianMs: values[Math.floor(values.length / 2)], p99Ms: values[Math.floor(values.length * 0.99)] };
}

const folder = mkdtempSync(join(tmpdir(), "snark-weapon-effects-"));
const map = join(folder, "range.snmap");
const range = flatMap(8);
await Bun.write(map, writeMap(range));
const server = startServer({ map, hostname: "127.0.0.1", port: 0, dev: true, probeScene: true, clientDir: resolve(process.env.CLIENT_DIR ?? "client/dist") });
const wire = shapedLink(server.port, 48, 150);
const clients: Awaited<ReturnType<typeof gameBrowser>>[] = [];
try {
  const spawn = range.spawns[0]!;
  const x = spawn.x - 2, z = spawn.z - 14;
  const world = server.host.world;
  for (let side = -9; side <= 9; side += 3) for (let row = 0; row < 3; row++) {
    world.structs.add(world.reg.index.get("core:wall_metal")!, x + side, 1.5 + row * 3, z + 90, 0, 0, 100000);
  }
  for (const [i, name] of ["Shooter", "Observer"].entries()) {
    const player = await gameBrowser(server, name, new URLSearchParams({ tier: "medium", trip: "1" }), i === 0 ? server.port : wire.port);
    clients.push(player);
    await until(() => player.tab.value<boolean>("!!globalThis.snarkTrip?.app?.session.inventory"), name + " inventory");
    await player.tab.value("globalThis.app = snarkTrip.app; globalThis.s = app.session; globalThis.ctrl = app.controls; app.ui.settings.steady=false; s.text('enablecheats')");
  }
  const [shooter, observer] = clients.map((c) => c.tab);
  const say = async (tab: typeof shooter, line: string) => {
    await tab.value("s.text(" + JSON.stringify(line) + ")");
    await Bun.sleep(500);
  };
  await say(shooter, `tp ${x} ${z}`);
  await say(observer, `tp ${x + 4} ${z - 6}`);
  await say(shooter, "kit plasma");
  await say(shooter, "give core:rocket_launcher 1");
  await say(shooter, "give core:rocket 4");
  await shooter.value("ctrl.yaw=0; ctrl.pitch=.012; ctrl.mouseButton(2,true)");
  await observer.value("ctrl.yaw=-.11; ctrl.pitch=.015");
  const empty: Seen = { plasma: {}, flat: 0, frames: 0, rocket: 0, flame: 0, lobes: 0 };
  for (const { tab } of clients) {
    await tab.value(`globalThis.seen=${JSON.stringify(empty)}; (${observe})(app, seen, ${DRAW_SKINNED}, ${DRAW_TEXTURED})`);
  }
  const equip = async (tab: typeof shooter, slot: number, weapon: string) => {
    const item = world.reg.index.get("core:" + weapon)!;
    await tab.value(`{
      const inv = s.inventory, from = inv.item.indexOf(${item}), to = inv.hotbar + ${slot};
      if (from < 0) throw Error("Missing ${weapon}");
      if (from !== to) s.command(${CMD_MOVE}, w => {
        w.bits(${BOX_SELF},1); w.varint(from); w.bits(${BOX_SELF},1); w.varint(to); w.u16(0); w.u16(${item});
      });
    }`);
    await Bun.sleep(300);
    await tab.value(`s.command(${CMD_SELECT}, w => w.u8(${slot}))`);
    await until(() => tab.value<boolean>(`s.held === ${slot} && s.own.rounds > 0 && s.inventory.item[s.inventory.hotbar+s.held] === ${item}`), weapon + " ready");
  };
  for (const [slot, weapon] of ["rifle_plasma", "pistol_plasma", "rocket_launcher"].entries()) {
    if (weapon === "rocket_launcher") {
      await say(observer, `tp ${x + 4} ${z + 35}`);
      await observer.value("ctrl.yaw=-.07; ctrl.pitch=.02");
    }
    await equip(shooter, slot, weapon);
    await Bun.sleep(750);
    for (const { tab } of clients) await tab.value(`Object.assign(seen, ${JSON.stringify(empty)})`);
    const before = server.host.projectiles.fired;
    await shooter.value("ctrl.mouseButton(0,true)");
    await until(() => server.host.projectiles.fired > before, weapon + " fired", 4000);
    await shooter.value("ctrl.mouseButton(0,false)");
    await Bun.sleep(weapon === "rocket_launcher" ? 2800 : 900);
    for (const { tab, client } of clients) {
      const seen = await tab.value<Seen>("seen");
      console.log(client.name, weapon, seen);
      const ok = weapon === "rocket_launcher" ? seen.rocket && seen.flame && seen.lobes : Object.keys(seen.plasma).length === 3 && seen.flat === 0;
      if (!ok) throw Error(client.name + " missed an effect from " + weapon);
    }
  }
  await say(observer, "give core:rocket_launcher 1");
  await say(observer, "give core:rocket 3");
  await Promise.all([equip(shooter, 0, "rifle_plasma"), equip(observer, 0, "rocket_launcher")]);
  await say(observer, `tp ${x + 2} ${z + 82}`);
  await observer.value("ctrl.yaw=-.12; ctrl.pitch=.015; ctrl.mouseButton(2,true)");
  await observer.value(`globalThis.samples={active:false,gpu:[],wall:[],card:null}; void (${measure})(app,samples)`);
  await until(() => observer.value<boolean>("samples.card !== null"), "GPU probe");
  const phase = async (name: string, run: () => Promise<void>) => {
    await observer.value("Object.assign(samples,{active:true,gpu:[],wall:[]})");
    await run();
    const row = await observer.value<Samples>("samples.active=false; samples");
    console.log(name, row.card, { gpu: times(row.gpu), wall: times(row.wall) });
  };
  await Bun.sleep(2000);
  await phase("Idle", () => Bun.sleep(6500));
  const fired = server.host.projectiles.fired, blasts = server.host.projectiles.blasts;
  await phase("Mixed fire", async () => {
    await shooter.value("ctrl.mouseButton(0,true)");
    for (let i = 0; i < 2; i++) {
      await observer.value("ctrl.mouseButton(0,true)");
      await until(() => server.host.projectiles.blasts > blasts + i, "rocket impact", 6000);
      await observer.value("ctrl.mouseButton(0,false)");
      await Bun.sleep(3500);
    }
    await shooter.value("ctrl.mouseButton(0,false)");
  });
  if (server.host.projectiles.fired - fired < 15) throw Error("The rifle stopped during the mixed fight");
} finally {
  await Promise.all(clients.map((c) => c.close()));
  wire.stop();
  server.stop();
  rmSync(folder, { recursive: true, force: true });
}
