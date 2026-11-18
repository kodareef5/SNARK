// Native fracture-adapter overhead at maximum node density, separate from an encounter or a browser frame.
// The airborne hull keeps this row about cold-node preparation rather than repeated collisions with random trunks.
import { cpus, loadavg } from "node:os";
import { COMPACT_VEHICLE } from "../../content/vehicles/compact.ts";
import { VehicleTrees } from "../../server/vehicle-trees.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { Body } from "../../shared/sim/character.ts";
import { stepVehicleBody } from "../../shared/sim/vehicle-body.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { Harness } from "../../tests/fixtures/net.ts";

export function benchVehicleTrees(section: (title: string) => void, record: (name: string, value: number, unit: string, budget?: number | null) => void): void {
  section("Vehicle trees: 256 nodes/chunk, one moving car, cold versus held sweep");
  const map = writeMap(flatMap(4, { nodes: [{ seed: 5, perChunk: 256, allowCell: 64, allow: new Uint8Array(2).fill(255), kinds: [["core:tree", 1]] }] }));
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map });
  try {
    const field = h.world.nodeField!, trees = new VehicleTrees(h.world, h.host.harvest!), body = new Body(), before = new Body();
    before.kind = h.reg.index.get("core:compact")!; before.vehicle = true; before.fuel = 40;
    before.x = 96; before.y = 30; before.z = 96; before.vx = 20;
    const at = field.source.at.bind(field.source); let reads = 0;
    field.source.at = (...args) => { reads++; at(...args); };
    for (const mode of ["cold", "held", "held without hook"] as const) {
      if (mode === "held") h.host.harvest!.retain(5, 1, 1);
      const step = () => { body.copy(before); (mode === "held without hook" ? stepVehicleBody : trees.step)(h.world, body, 0, 0, 0, COMPACT_VEHICLE); };
      for (let i = 0; i < 600; i++) step();
      reads = 0; const cpu = process.cpuUsage(), began = performance.now(), ticks = 2400;
      for (let i = 0; i < ticks; i++) step();
      const used = process.cpuUsage(cpu);
      record(`tree sweep ${mode}: CPU per car tick`, (used.user + used.system) / 1000 / ticks, "CPU ms");
      record(`tree sweep ${mode}: elapsed per car tick`, (performance.now() - began) / ticks, "ms");
      record(`tree sweep ${mode}: source nodes read per tick`, reads / ticks, "nodes");
    }
    h.host.harvest!.retain(5, 1, -1);
  } finally { h.host.shutdown(); }
}
if (import.meta.main) {
  console.log(`${cpus()[0]?.model}; ${cpus().length} logical CPUs; load ${loadavg().map(n => n.toFixed(2)).join("/")}`);
  benchVehicleTrees(console.log, (name, value, unit) => console.log(`${name}: ${value.toFixed(5)} ${unit}`));
}
