import { expect, test } from "bun:test";
import { seedDinosaurPreview } from "../../tools/carbonemys-rex/dev.ts";
import { dinosaurCourse } from "../../tools/carbonemys-rex/course.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";

test("new paddock visitors receive separate pairs and returning visitors keep their animals", () => {
  const h = new Harness({}, 1, 60, {dev: true, map: writeMap(dinosaurCourse())});
  try {
    for (const name of ["Ada", "Lin", "Ren"]) {
      const s = h.join(name);
      h.run(300);
      const owner = h.host.records.byPid.get(h.client(s)!.pid)!;
      expect(seedDinosaurPreview(h.host, owner)).toBe(2);
      expect(seedDinosaurPreview(h.host, owner)).toBe(0);
    }
    const mounts = [...h.host.records.byPid.values()].filter(r => r.saddle !== 0);
    expect(mounts).toHaveLength(6);
    for (const [i, a] of mounts.entries()) {
      for (const b of mounts.slice(i + 1)) {
        const reach = (kind: number) => h.world.anims[kind]?.rig.reach ?? h.reg.bodyRadius[kind]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(reach(a.kind) + reach(b.kind));
      }
    }
  } finally {
    h.host.shutdown();
  }
});
