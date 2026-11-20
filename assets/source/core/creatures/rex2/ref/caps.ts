// Lists a creature pack's hit capsules (the bone each rides on, its zone, length and radius) and where its sockets are.
//   bun assets/source/core/creatures/rex2/ref/caps.ts assets/source/core/creatures/rex2/rex2.snpk
import { readFileSync } from "node:fs";
import { parsePack } from "../../../../../../shared/pack/pack.ts";

const pack = parsePack(readFileSync(process.argv[2]!));
for (const rig of pack.header.rigs) {
  const caps = rig.caps ?? [];
  console.log(`${rig.id}: ${caps.length / 9} capsules`);
  for (let i = 0; i < caps.length; i += 9) {
    const [bone, zone, ax, ay, az, bx, by, bz, r] = caps.slice(i, i + 9) as number[];
    const length = Math.hypot(bx! - ax!, by! - ay!, bz! - az!);
    console.log(`  ${(rig.names?.[bone!] ?? String(bone)).padEnd(13)} zone ${zone}  length ${length.toFixed(2)} m  radius ${r!.toFixed(2)} m`);
  }
}
for (const rig of pack.header.rigs) {
  for (const s of rig.sockets ?? []) {
    const at = [s.x + rig.rest[s.bone * 3]!, s.y + rig.rest[s.bone * 3 + 1]!, s.z + rig.rest[s.bone * 3 + 2]!];
    console.log(`  socket ${s.name.padEnd(9)} on ${rig.names![s.bone]!.padEnd(10)} at x ${at[0]!.toFixed(2)}, up ${at[1]!.toFixed(2)}, forward ${at[2]!.toFixed(2)}`);
  }
}
