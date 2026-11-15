// A server on a built map and a client without a browser, in one process on virtual time (tests/fixtures/net.ts): the
// survivor arrives, then dies and comes back at each spawn point in turn, and at each walks a few seconds four ways.
// bun tools/mapworld/walk.ts <file.snmap>

import { readFileSync } from "node:fs";
import { CMD_RESPAWN, SESSION_ALIVE, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { parseMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../../tests/fixtures/net.ts";

const path = process.argv[2];
if (!path) {
  console.error("bun tools/mapworld/walk.ts <file.snmap>");
  process.exit(2);
}
const bytes = new Uint8Array(readFileSync(path));
const map = parseMap(bytes);
const t0 = performance.now();
const h = new Harness({}, 1, 30, { map: bytes, wild: true });
console.log(`host on ${map.id} in ${(performance.now() - t0).toFixed(0)} ms, ${h.host.spawner?.regions.length ?? 0} spawn regions`);
const s = h.join("walker");
h.run(3000);
const ents = h.world.ents;
const at = (): [number, number, number] => {
  const e = h.ent(s);
  return [ents.x[e]!, ents.y[e]!, ents.z[e]!];
};
let failed = 0;
for (let i = 0; i < map.spawns.length; i++) {
  const p = map.spawns[i]!;
  if (i > 0) {
    h.say(s, "suicide", 500);
    if (s.sessionState !== SESSION_DEAD) throw new Error("the survivor did not die");
    h.run(12000);
    s.command(CMD_RESPAWN, (w) => w.u8(i));
    h.run(1500);
    if (s.sessionState !== SESSION_ALIVE) throw new Error(`no respawn at ${p.name}`);
  }
  const [x0, y0, z0] = at();
  const off = Math.hypot(x0 - p.x, z0 - p.z);
  const legs: string[] = [];
  const yaw = (p.yaw / 65536) * 2 * Math.PI;
  for (let k = 0; k < 4; k++) {
    const [ax, , az] = at();
    const pilot = h.pilots[0]!;
    pilot.yaw = yaw + (k * Math.PI) / 2;
    pilot.moveZ = 1;
    h.run(6000);
    pilot.moveZ = 0;
    h.run(500);
    const [bx, by, bz] = at();
    legs.push(`${Math.hypot(bx - ax, bz - az).toFixed(0)} m to y ${by.toFixed(1)}`);
  }
  const [x1, , z1] = at();
  const ok = off < 3 && Math.hypot(x1 - x0, z1 - z0) >= 0 && legs.some((l) => Number(l.split(" ")[0]) > 10);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${p.name.padEnd(14)} arrived ${off.toFixed(1)} m from its point at y ${y0.toFixed(1)}; walked ${legs.join(", ")}`);
}
console.log(`${h.host.spawner?.count ?? 0} wild creatures after ${(h.now / 1000).toFixed(0)} s of virtual time`);
process.exit(failed > 0 ? 1 : 0);
