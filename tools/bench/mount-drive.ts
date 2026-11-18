// bun tools/bench/mount-drive.ts raptor|parasaur [--out=directory] [--client=client/dist]
// Two ordinary desktop clients: ride a saddled mount up a cross slope, over the crest and down; bite at rider input.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../server/main.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { LOOK_SPEED } from "../../client/core/controls.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { drivingBrowser, until } from "./driving-browser.ts";

const species = process.argv[2];
if (species !== "raptor" && species !== "parasaur") throw new Error("Choose raptor or parasaur.");
const option = (prefix: string) => process.argv.find(s => s.startsWith(prefix))?.slice(prefix.length);
const out = option("--out=");
if (out) mkdirSync(out, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), "snark-mounted-course-"));
const x = 128, startZ = 50;
const map = flatMap(4, { spawns: [{ name: "Hillside", x, z: startZ - 2.5, yaw: 0 }] });
const side = Math.sqrt(map.heights.length), grade = Math.tan(20 * Math.PI / 180);
for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
  const z = j * TERRAIN_CELL;
  const h = Math.max(0, Math.min(z - 48, 112 - z)) * grade + .15 * Math.max(-12, Math.min(12, i * TERRAIN_CELL - x));
  map.heights[j * side + i] = Math.round((h - map.minY) / map.stepY);
}
const file = join(directory, "hill.snmap");
writeFileSync(file, writeMap(map));
type Browser = Awaited<ReturnType<typeof drivingBrowser>>;
let driver: Browser | undefined, watcher: Browser | undefined, server: ReturnType<typeof startServer> | undefined;
try {
  server = startServer({ hostname: "127.0.0.1", port: 0, dev: true, map: file, clientDir: option("--client="),
    routes: (_request, url) => url.pathname === "/__look" && url.searchParams.get("view") === "side"
      ? Response.json({ look: [Math.PI / 2, .10] }) : null });
  const { host } = server, { world } = host, ents = world.ents;
  driver = await drivingBrowser(server, "rider");
  const { tab, client } = driver;
  const mount = host.spawnCreature("core:"+species, x, startZ, 1);
  if (mount < 0) throw new Error("Mount placement failed.");
  const animal = host.records.byPid.get(ents.pid[mount]!)!, rider = host.records.byPid.get(client.pid)!;
  animal.team = rider.team;
  animal.saddle = world.reg.index.get("core:saddle_"+species)!;
  ents.yaw[mount] = 0;
  host.refreshBody(animal);
  host.creatures.claimed(mount);
  host.creatures.mind.stay(mount, 0xffffffff);
  ents.setPosition(client.ent, x, world.hf.heightAt(x, startZ - 2.5), startZ - 2.5);
  world.history.discontinuity(client.ent);
  if (host.riding.mount(client, mount) !== 0) throw new Error("Could not board the ground mount.");
  await until(() => client.drive === mount, "Mounting");
  watcher = await drivingBrowser(server, "watcher", "side");
  // The observer sees the slope side-on through ordinary entity snapshots.
  const w = watcher.client, wx = x - 7, wz = 71.5;
  ents.setPosition(w.ent, wx, world.hf.heightAt(wx, wz), wz);
  world.history.discontinuity(w.ent);
  await tab.send("Page.bringToFront");
  const mouse = (down: boolean) => tab.send("Input.dispatchMouseEvent", { type: down ? "mousePressed" : "mouseReleased", x: 260, y: 180, button: "left", clickCount: 1 });
  const key = (down: boolean) => tab.send("Input.dispatchKeyEvent", { type: down ? "rawKeyDown" : "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
  await mouse(true); await mouse(false);
  let ticks = 0, grounded = 0, peakHeight = -Infinity, largestLateral = 0;
  const begin = world.tick, floor = (e: number) => world.hf.heightAt(ents.x[e]!, ents.z[e]!);
  const tick = host.game.tick.bind(host.game);
  host.game.tick = () => {
    tick();
    ticks++;
    if (ents.flags[mount]! & F_GROUNDED) grounded++;
    peakHeight = Math.max(peakHeight, ents.y[mount]!);
    largestLateral = Math.max(largestLateral, Math.abs(ents.x[mount]! - x));
  };
  const climbStart = world.tick;
  await key(true);
  await until(() => ents.z[mount]! >= 71, "Climbing the 20 degree hillside");
  const climbTicks = world.tick - climbStart;
  await key(false);
  await until(() => Math.hypot(ents.vx[mount]!, ents.vz[mount]!) < .1, "Rest on the hillside");
  await Bun.sleep(350);
  if (out) {
    await tab.shot(join(out, species+"-driver.png"));
    await watcher.tab.shot(join(out, species+"-observer.png"));
  }
  const seatHeight = ents.y[client.ent]! - floor(mount);
  // A parked live target downhill of the crest is attacked through the normal mouse binding.
  await key(true);
  await until(() => ents.z[mount]! >= 91, "Crossing the crest");
  await key(false);
  await until(() => Math.hypot(ents.vx[mount]!, ents.vz[mount]!) < .1, "Rest on the descent");
  const reach = species === "raptor" ? 2.4 : 3.65;
  const victim = host.spawnCreature("core:parasaur", x, ents.z[mount]! + reach, 1);
  if (victim < 0) throw new Error("Target placement failed.");
  host.creatures.mind.stay(victim, 0xffffffff);
  const record = host.records.byPid.get(ents.pid[victim]!)!, health = host.survival.value(record, V_HEALTH);
  const targetYaw = ents.yaw[victim]! * 360 / 65536;
  // Look at the target's upper body through ordinary pointer-locked mouse input. Camera pitch is world-space;
  // a level view on a descent is no longer an implicit request to bite along the ground's slope.
  const eye = new Float64Array(3);
  if (!host.riding.eye(client.ent, eye)) throw new Error("Rider eye unavailable.");
  const aimPitch = Math.atan2(ents.y[victim]! + world.reg.bodyHeight[record.kind]! * .8 - eye[1]!,
    Math.hypot(ents.x[victim]! - eye[0]!, ents.z[victim]! - eye[2]!));
  const beforeAim = client.newestInput;
  const previousPitch = ents.pitch[mount]! * Math.PI / 32768;
  await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 260, y: 180 - (aimPitch - previousPitch) / LOOK_SPEED });
  await until(() => client.newestInput > beforeAim && Math.abs(ents.pitch[mount]! * Math.PI / 32768 - aimPitch) < .02, "World-space mouse aim");
  const sentPitch = ents.pitch[mount]! * Math.PI / 32768;
  const requested = world.tick;
  await mouse(true);
  try { await until(() => world.tick >= requested + 25, "Attack interval"); }
  finally { await mouse(false); }
  const damage = health - host.survival.value(record, V_HEALTH);
  const result = { species, targetYaw, aimPitch, sentPitch, aimError: Math.abs(sentPitch - aimPitch), travel: ents.z[mount]! - startZ, elapsedTicks: world.tick - begin, climbTicks, groundedTicks: grounded, sampledTicks: ticks,
    peakHeight, lateralDrift: largestLateral, seatHeightOnHill: seatHeight, damage, credited: host.combat.last.by === animal.pid && host.combat.last.victim === record.pid, seated: client.drive === mount, observer: w.active && !w.closed };
  console.log(JSON.stringify(result));
  if (!result.seated || !result.observer || result.travel < 41 || peakHeight < 11 || largestLateral > 2 || grounded < ticks * .9 || !damage || !result.credited) throw new Error("Mounted hillside course failed.");
} finally {
  try { await watcher?.close(); } finally {
    try { await driver?.close(); } finally {
      server?.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
