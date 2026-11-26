import type { Host } from "../../server/host.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";
import { restPose } from "../../shared/world/snap.ts";
import { Found } from "../../shared/world/structures.ts";
import { NORTH, slot } from "../../tests/fixtures/slots.ts";

/** The first foundation faces the entrance. Its northern neighbour carries the lab's stocked Fabricator. */
export function stageTekSamples(host: Host, foundationRef: number, team: number): number {
  const { world, fixtures, items } = host, { structs, reg } = world;
  const base = reg.index.get("core:foundation_tek")!, fabricator = reg.index.get("core:fabricator")!;
  const entrance = structs.chunks[foundationRef >>> 16], entry = foundationRef & 65535;
  const key = { fr: 0, k0: 0, k1: 0 };
  if (!entrance || entrance.kind[entry] !== base || entrance.owner[entry] !== team || !slot(world, foundationRef, base, NORTH, 0, key)) throw new Error("The Tek lab needs its entrance foundation");
  const rear = structs.refAt(key.fr, key.k0, key.k1), floor = structs.chunks[rear >>> 16], s = rear & 65535;
  if (!floor || floor.kind[s] !== base || floor.owner[s] !== team) throw new Error("The Tek lab needs its crew's rear foundation");
  const yaw = floor.yaw[s]!;
  frameOf(yaw, floor.twAt(s));
  const pose = { x: 0, y: 0, z: 0, yaw };
  if (!restPose(structs, reg, rear, fabricator, floor.x[s]! + .72 * frame.sin, floor.z[s]! + .72 * frame.cos, yaw, pose)) throw new Error("The Fabricator needs a level floor");
  const x = pose.x / STRUCT_UNITS, y = pose.y / STRUCT_UNITS, z = pose.z / STRUCT_UNITS;
  const found = new Found();
  const n = structs.query(x, z, x, z, found, y, y);
  for (let i = 0; i < n; i++) {
    const ref = found.refs[i]!, row = structs.chunks[ref >>> 16]!, at = ref & 65535;
    if ((row.kind[at] === fabricator || row.kind[at] === reg.lights[fabricator]) && row.x[at] === x && row.y[at] === y && row.z[at] === z) {
      if (row.owner[at] !== team) throw new Error("Another crew owns the Fabricator in the rear bay");
      return ref;
    }
  }
  const ref = structs.add(fabricator, x, y, z, yaw, team, reg.maxHp[fabricator]!);
  if (ref < 0) throw new Error("The lab has no room for its Fabricator");
  const station = fixtures.ensure(ref);
  for (const [kind, d] of reg.defs.entries()) {
    if (d?.type === "item" && d.class === "structure" && d.places?.length && d.craft?.at === "core:fabricator" && d.id.endsWith("_tek")) {
      if (items.mint(station, kind, 4) !== 4) {
        items.burnAll(station);
        structs.remove(ref);
        throw new Error(`The Fabricator could not hold ${d.id}`);
      }
    }
  }
  return ref;
}
