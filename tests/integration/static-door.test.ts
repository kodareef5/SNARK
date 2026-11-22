import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { shapeHalf, type Def, type ShapeDef, type StructureDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { RESULT_OBSTRUCTED } from "../../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

const forms: ShapeDef[] = [
  { type: "shape", id: "test:static_door_shape", role: "door", boxes: [{ at: [0, 0, 0], half: [.6, 1.3, .04] }] },
  { type: "shape", id: "test:static_door_open_shape", role: "door", boxes: [{ at: [-.56, 0, .6], half: [.04, 1.3, .6] }] },
];
const pieces: StructureDef[] = forms.map((shape, i) => ({ type: "structure", class: "static", id: i ? "test:static_door_open" : "test:static_door",
  mesh: "shape", shape: shape.id, half: shapeHalf(shape.boxes), color: 3, hp: 1000, opens: i ? "test:static_door" : "test:static_door_open" }));
const compiled = compileContent([...CORE_CONTENT, ...forms, ...pieces] as Def[]);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const reg = compiled.registry;

/** Isolated native proof for public map doors; yacht geometry is covered by its own route checks. */
test("public static doors use E, preserve collision on blocked closing, replicate and survive restart without acquiring support or ownership", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-static-door-")), dbPath = join(dir, "world.db");
  const map = writeMap(flatMap(2, { spawns: [{ name: "Door approach", x: 64, z: 60, yaw: 0 }], statics: [
    { kind: "test:static_door", x: 64, y: 1.3, z: 64, yaw: 0 },
  ] }));
  const opts = { dev: true, clips: NO_CLIPS, rigs: [], map, dbPath };
  let h = new Harness({}, 1, 60, opts, reg);
  try {
    const s = h.join("visitor"), observer = h.join("other-tribe", { latencyMs: 50, jitterMs: 8, loss: .02 }); h.run(500);
    const closed = reg.index.get("test:static_door")!, open = reg.index.get("test:static_door_open")!;
    const chunk = 3, slot = 0, ref = chunk * 65536 + slot;
    const row = () => h.world.structs.chunks[chunk]!;
    expect(reg.role[closed]).toBe(-1); expect(reg.role[open]).toBe(-1); expect(row().owner[slot]).toBe(0);
    expect(h.host.build.decay.expired(ref, 1e9)).toBe(false);
    const walkTo = (index: number, x: number, z: number) => {
      const p = h.pilots[index]!, session = h.sessions[index]!; p.pitch = 0;
      for (let i = 0; i < 180 && Math.hypot(session.own.x - x, session.own.z - z) > .09; i++) {
        p.yaw = Math.atan2(x - session.own.x, z - session.own.z);
        p.moveZ = Math.min(1, Math.hypot(session.own.x - x, session.own.z - z) * 2); h.run(1000 / 60);
      }
      p.moveZ = 0; h.run(100);
    };
    const walk = (z: number) => walkTo(0, 64, z);
    const use = (x: number, z: number) => {
      const p = h.pilots[0]!, eye = s.own.y + stanceEye(reg.move[s.ownKind]!, s.own.stance);
      p.yaw = Math.atan2(x - s.own.x, z - s.own.z); p.pitch = Math.atan2(1.3 - eye, Math.hypot(x - s.own.x, z - s.own.z));
      let code = -1; s.onResult = (seq, result) => { if (!seq) code = result; };
      p.buttons = BTN_USE; h.run(100); p.buttons = 0; h.run(250); return code;
    };
    walk(63.5); expect(s.own.z).toBeGreaterThan(63.3); expect(row().kind[slot]).toBe(closed);
    use(64, 64); expect(row().kind[slot]).toBe(open);
    expect(observer.world!.structs.chunks[chunk]!.kind[slot]).toBe(open);
    walk(64); expect(Math.abs(s.own.z - 64)).toBeLessThan(.15);
    expect(use(63.44, 64.6)).toBe(RESULT_OBSTRUCTED); expect(row().kind[slot]).toBe(open);
    walk(66); expect(s.own.z).toBeGreaterThan(65.8);
    // Survivors block one another (server/blocking.ts): the second comes through to stand beside the first.
    walkTo(1, 64.9, 66.6); expect(observer.own.z).toBeGreaterThan(65.8); walkTo(1, 65.2, 66);
    use(63.44, 64.6); expect(row().kind[slot]).toBe(closed);
    walkTo(1, 63.44, 64.65);
    expect(use(64, 64)).toBe(RESULT_OBSTRUCTED); expect(row().kind[slot]).toBe(closed);
    walkTo(1, 65, 66);
    use(64, 64); expect(row().kind[slot]).toBe(open);
    h.host.shutdown(); h = new Harness({}, 1, 60, opts, reg);
    expect(h.world.structs.count).toBe(1); expect(row().kind[slot]).toBe(open); expect(row().owner[slot]).toBe(0);
    const back = h.join("visitor"); h.run(400);
    expect(back.own.z).toBeGreaterThan(65.8); expect(reg.role[row().kind[slot]!]).toBe(-1);
  } finally { h.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
