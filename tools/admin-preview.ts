// A loopback-only cluster with disposable saves for reviewing the operator console.
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { ClientSession } from "../client/core/session.ts";
import { connect } from "../agent/socket.ts";
import { defaultLook } from "../shared/anim/look.ts";
import { KEY_BYTES, TEXT_GLOBAL } from "../shared/net/protocol.ts";
import { startServer, type RunningServer } from "../server/main.ts";
import { startFront } from "../server/front.ts";
import { loadConfig } from "../server/settings/config.ts";
import { LogRecorder } from "../server/survivor-log/recorder.ts";
import { LogStore } from "../server/survivor-log/store.ts";
import { STATE_ALIVE, itemKey, logFolder } from "../server/survivor-log/format.ts";
import { OP_ADMIN } from "../server/console.ts";
import { OP_DEATH } from "../server/death.ts";
import { CAUSE_WORDS } from "../server/survival.ts";

function recordPreview(server: RunningServer): void {
  const { host } = server;
  const { world, records, persistence } = host;
  const players = host.game.clients.filter(c => c && c.pid > 0);
  if (!persistence || !players.length) throw Error("Preview survivors did not join.");
  const store = new LogStore(logFolder(persistence.store.path), 16 << 20, {
    saveId: persistence.saveId, mapId: world.mapId, world: records.worldId, opAdmin: OP_ADMIN, opDeath: OP_DEATH, causes: CAUSE_WORDS,
  });
  const end = Date.now() - 1000;
  const start = end - 30 * 60_000;
  const book = new LogRecorder(world.reg.ids, start, 0);
  const key = itemKey(world.reg.index.get("core:stone")!, 0, false);
  for (const p of players) book.enter(p!.pid, p!.name, 0, "", new Map(), start, 0);
  const steps = 60;
  for (let k = 1; k <= steps; k++) {
    const wall = start + (end - start) * k / steps;
    const tick = Math.floor((world.tick - 1) * k / steps);
    players.forEach((p, index) => {
      const from = world.spawns[index % world.spawns.length]!;
      const angle = k / steps * Math.PI * 1.5 + index;
      const x = from.x + Math.cos(angle) * 180, z = from.z + Math.sin(angle) * 130;
      book.sample(p!.pid, tick, x, world.hf.heightAt(x, z), z, STATE_ALIVE);
      if (k % 10 === 0) book.held(p!.pid, new Map([[key, k + index]]), wall, tick);
      if (k === steps) book.leave(p!.pid, "left", wall, tick);
    });
    store.write(book.flush(wall, tick));
  }
  store.close();
  host.rules.assign("SurvivorLogMegabytes", "64", "console");
}

async function preview(): Promise<void> {
  const cities = [
    { slug: "miami", name: "Miami", people: ["Marisol", "Ellis"], chat: ["I’m at the waterfront.", "Heading back to the obelisk."] },
    { slug: "tampa", name: "Tampa", people: ["Rowan"], chat: ["The supply route is clear."] },
  ];
  const maps = resolve(process.argv[2] ?? "var/maps");
  const port = Number(process.argv[3] ?? 8775);
  const root = resolve("var/admin-preview");
  mkdirSync(root, { recursive: true });
  const run = mkdtempSync(join(root, "run-"));
  const cluster = join(run, "clusters");
  const worlds = cities.map(city => {
    const { rules } = loadConfig({}, ["-clusterid=preview", `-ClusterDirOverride=${cluster}`, `?SessionName=${city.name}?SurvivorLogMegabytes=0`]);
    const server = startServer({ dev: true, hostname: "127.0.0.1", port: 0, config: rules, publicUrl: "/" + city.slug,
      dbPath: join(run, city.slug + ".db"), map: join(maps, city.slug + ".snmap"), noBackups: true });
    return { city, server };
  });
  const front = startFront(join(cluster, "preview"), port, "127.0.0.1");
  const intervals: ReturnType<typeof setInterval>[] = [];
  for (const { city, server } of worlds) {
    const { world } = server.host;
    const people = city.people.map(name => new ClientSession(connect(`ws://127.0.0.1:${server.port}/${city.slug}/ws`), {
      name, key: crypto.getRandomValues(new Uint8Array(KEY_BYTES)), registry: world.reg.source ?? world.reg,
      clipHash: world.anim.set.hash, look: defaultLook(), resolveMap: () => world.hf,
    }));
    intervals.push(setInterval(() => {
      const t = performance.now();
      people.forEach((session, i) => session.update(t, 0, 0, i, 0, 0));
    }, 100));
    const deadline = Date.now() + 45_000;
    while ((server.host.game.playerCount < people.length || world.tick < 70) && Date.now() < deadline) await Bun.sleep(120);
    if (server.host.game.playerCount < people.length) throw Error(`Could not join ${city.name}: ${people.map(p => p.closeText || p.state).join(", ")}`);
    recordPreview(server);
    people.forEach((session, i) => session.chat(TEXT_GLOBAL, city.chat[i]!));
    const operator = people[0]!;
    operator.text("enablecheats");
    await Bun.sleep(350);
    operator.text("give stone 12");
  }
  console.log(`Admin preview at http://127.0.0.1:${front.port}/admin/\nDisposable saves in ${run}`);
  const close = () => {
    intervals.forEach(clearInterval);
    front.stop();
    for (const { server } of worlds) server.stop();
    process.exit(0);
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (import.meta.main) await preview();
