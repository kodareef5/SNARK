// bun tools/bench/collision-drive.ts tree | bridge path/to/san-francisco.snmap [--software]
// Drives the built desktop client through keyboard input. Uses a fresh local session and an ephemeral world.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../server/main.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { drivingBrowser, until } from "./driving-browser.ts";

const course = process.argv[2];
if (course !== "bridge" && course !== "tree") throw new Error("Choose tree or bridge followed by a built San Francisco map path.");
const city = course === "bridge";
const profile = mkdtempSync(join(tmpdir(), "snark-collision-"));
let server: ReturnType<typeof startServer> | undefined;
let browser: Awaited<ReturnType<typeof drivingBrowser>> | undefined;

try {
  let path = process.argv[3];
  if (city && (!path || !existsSync(path))) throw new Error("The bridge course requires a built San Francisco map.");
  if (!city) {
    path = join(profile, "tree.snmap");
    const first = new Uint32Array(17); first.fill(1, 7);
    writeFileSync(path, writeMap(flatMap(4, { nodes: [{ kinds: ["core:tree"], first, kind: new Uint8Array([0]), x: new Uint16Array([24576]), z: new Uint16Array([28672]), yaw: new Uint16Array([0]) }],
      spawns: [{ name: "Course", x: 147, z: 35, yaw: 0 }] })));
  }
  server = startServer({ dev: true, hostname: "127.0.0.1", port: 0, map: path });
  const host = server.host, { world } = host, ents = world.ents;
  const x = city ? 158.519 : 152, z = city ? 110.690 : 35;
  const yaw = city ? Math.atan2(210.477 - x, 106.761 - z) : 0, dx = Math.sin(yaw), dz = Math.cos(yaw);
  if (city) Object.assign(world.spawn, { x, z, yaw: Math.round(yaw * 65536 / (2*Math.PI)) & 65535 });
  let car = -1;
  for (const lift of [0, .25, .55, 1.1]) {
    car = host.spawnVehicle("core:compact", x, z, 0, yaw, city ? { y: 22.705 + lift } : {});
    if (car >= 0) break;
  }
  if (car < 0) throw new Error("Car placement failed.");
  browser = await drivingBrowser(server, "course");
  const { tab, client } = browser;
  const seat = world.reg.vehicle[ents.kind[car]!]!.seats[0]!, at = [0,0,0];
  host.urban.door(car, seat, world.reg.move[ents.kind[client.ent]!]!.radius, at);
  ents.setPosition(client.ent, at[0]!, at[1]!, at[2]!); world.history.discontinuity(client.ent);
  if (host.urban.mount(client, car) !== 0) throw new Error("Driver seat unavailable");
  await until(() => client.drive === car, "Boarding");
  await Bun.sleep(700);
  for (const type of ["mousePressed", "mouseReleased"]) await tab.send("Input.dispatchMouseEvent", { type, x: 260, y: 180, button: "left", clickCount: 1 });
  const driver = host.records.byPid.get(client.pid)!, vehicle = host.records.byPid.get(ents.pid[car]!)!;
  const hp = () => host.survival.value(vehicle, V_HEALTH), health = hp(), crew = host.survival.value(driver, V_HEALTH), xp = driver.xp;
  const sx = ents.x[car]!, sz = ents.z[car]!, begin = world.tick;
  let speedBefore = 0, speedAfter = 0, maxSide = 0, minUp = 1, peak = 0, broke = false;
  const speed = () => Math.hypot(ents.vx[car]!, ents.vz[car]!);
  const tick = host.game.tick.bind(host.game);
  host.game.tick = () => {
    const before = speed(); tick();
    peak = Math.max(peak, speed());
    const v = ents.vrow[car]!;
    minUp = Math.min(minUp, 1 - 2*(ents.vehicleQx[v]!**2 + ents.vehicleQz[v]!**2));
    maxSide = Math.max(maxSide, Math.abs((ents.x[car]!-sx)*dz - (ents.z[car]!-sz)*dx));
    if (!city && !broke && host.harvest!.crushed(6, 0)) { broke = true; speedBefore = before; speedAfter = speed(); }
  };
  const key = (down: boolean) => tab.send("Input.dispatchKeyEvent", { type: down ? "rawKeyDown" : "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
  await key(true);
  const distance = () => (ents.x[car]!-sx)*dx + (ents.z[car]!-sz)*dz;
  await until(() => city ? distance() >= 52.1 : broke && ents.z[car]! >= 112, course+" crossing");
  await key(false);
  const result = { course, distance: distance(), seconds: (world.tick-begin)/30, peak, minUp, maxSide, broke, speedBefore, speedAfter, hullDamage: health-hp(), occupantDamage: crew-host.survival.value(driver,V_HEALTH), xp: driver.xp-xp, seated: client.drive === car };
  console.log(JSON.stringify(result));
  if (!result.seated || result.occupantDamage || (city ? minUp < .85 || maxSide > 3 : !broke || speedAfter >= speedBefore || !result.hullDamage || result.xp)) throw new Error("Course outcome failed");
} catch (error) {
  if (browser) console.error(await browser.tab.value<string>("document.body.innerText.slice(-1400)").catch(() => "Browser closed"));
  throw error;
} finally {
  await browser?.close();
  server?.stop(); rmSync(profile, { recursive: true, force: true });
}
