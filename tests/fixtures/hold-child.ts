// Child process for the save lock and stop signal tests. It opens a world, walks a survivor, says where it stands and waits.
// Usage: bun tests/fixtures/hold-child.ts <db path> hold|stop

import { writeSync } from "node:fs";
import { stopOnSignals } from "../../server/signals.ts";
import { Harness } from "./net.ts";

if (import.meta.main) {
  const [db, mode] = process.argv.slice(2);
  const h = new Harness({}, 1, 60, { dbPath: db! });
  const ada = h.join("ada");
  h.pilots[0]!.moveZ = 1;
  h.run(2500);
  h.pilots[0]!.moveZ = 0;
  h.run(200);
  const e = h.ent(ada);
  if (mode === "stop") stopOnSignals(() => h.host.shutdown());
  writeSync(1, `ready ${JSON.stringify({ x: h.world.ents.x[e], z: h.world.ents.z[e], pid: h.world.ents.pid[e], tick: h.world.tick })}\n`);
  setInterval(() => {}, 1000);
}
