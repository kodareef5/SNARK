import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

// A street lamp (or a wooden pole) on flat ground in the middle of a 4-chunk map, and a car driven at it from 8 m south. A
// tree stands in a far chunk: a world with plants is one whose cars break what they hit (server/host.ts).
function camp(kind: string) {
  const first = new Uint32Array(17); for (let i = 1; i < first.length; i++) first[i] = 1;
  const nodes = [{ kinds: ["core:tree"], first, kind: new Uint8Array([0]), x: new Uint16Array([24 * 1024]), z: new Uint16Array([28 * 1024]), yaw: new Uint16Array([0]) }];
  const map = writeMap(flatMap(4, { statics: [{ kind, x: 128, y: 0, z: 128, yaw: 90 }], nodes, spawns: [{ name: "Driver", x: 100, z: 100, yaw: 0 }] }));
  const h = new Harness({}, 19, 60, { dev: true, clips: NO_CLIPS, rigs: [], map });
  const kindHere = (): string => {
    for (const t of h.world.structs.chunks) if (t) for (let s = 0; s < t.high; s++) if (t.kind[s] && Math.hypot(t.x[s]! - 128, t.z[s]! - 128) < 0.5) return h.reg.defs[t.kind[s]!]!.id;
    return "";
  };
  return { h, kindHere };
}

for (const [kind, fallen] of [["core:zzstreet_lamp", "core:zzstreet_lamp_fallen"], ["core:zzstreet_pole", "core:zzstreet_pole_leaning"]] as const) {
  test(`a car into a ${kind.slice(14)} hard enough knocks it down where it stood, and loses speed`, () => {
    const { h, kindHere } = camp(kind);
    try {
      expect(kindHere()).toBe(kind);
      const car = h.host.spawnVehicle("core:compact", 128, 120, 0); expect(car).toBeGreaterThanOrEqual(0);
      const a = h.world.ents; a.vz[car] = 22; let before = 0, after = 0;
      for (let i = 0; i < 40; i++) {
        const speed = Math.hypot(a.vx[car]!, a.vz[car]!); h.server.tick();
        if (!after && kindHere() === fallen) { before = speed; after = Math.hypot(a.vx[car]!, a.vz[car]!); }
      }
      // It lies as its ruined form lies, and the car that felled it has paid for it, and for meeting what lies there.
      expect(kindHere()).toBe(fallen);
      expect(before).toBeGreaterThan(15); expect(after).toBeLessThan(before - 1);
    } finally { h.host.shutdown(); }
  });
}

test("a car that only nudges a lamp leaves it standing and stops against it", () => {
  const { h, kindHere } = camp("core:zzstreet_lamp");
  try {
    const car = h.host.spawnVehicle("core:compact", 128, 122, 0); const a = h.world.ents; a.vz[car] = 4;
    for (let i = 0; i < 60; i++) h.server.tick();
    expect(kindHere()).toBe("core:zzstreet_lamp");
    expect(a.z[car]!).toBeLessThan(128);
  } finally { h.host.shutdown(); }
});
