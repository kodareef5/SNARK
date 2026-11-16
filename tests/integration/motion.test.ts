import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_BUSY } from "../../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { THROW_TICKS, MOTION_STEPS, motionProgress } from "../../shared/sim/motion.ts";
import { KORU_QUAY, koruMapFile, koruPoint } from "../fixtures/koru.ts";
import { Harness } from "../fixtures/net.ts";

// Koru's sail control, a static that moves when used: thrown with E as a door is, its state on its record, told to every
// client, refused while just thrown, and as it was after a restart.

const control = KORU_LAYOUT.modules.find((m) => m.id === KORU_LAYOUT.motion.static)!;
const aim = koruPoint(control.origin.map((v, a) => v + control.boxes[0]!.at[a]!));

function walkTo(h: Harness, index: number, p: readonly number[]): void {
  const s = h.sessions[index]!, pilot = h.pilots[index]!;
  for (let i = 0; i < 1800 && Math.hypot(p[0]! - s.own.x, p[2]! - s.own.z) > 0.1; i++) {
    pilot.yaw = Math.atan2(p[0]! - s.own.x, p[2]! - s.own.z);
    pilot.moveZ = Math.min(1, Math.hypot(p[0]! - s.own.x, p[2]! - s.own.z) * 2);
    h.run(1000 / 60);
  }
  pilot.moveZ = 0;
  h.run(100);
}

/** The use button pressed aimed at the control: its refusal, or -1 where none came, since a throw that takes is told by its state. */
function throwAt(h: Harness, index: number): number {
  const s = h.sessions[index]!, pilot = h.pilots[index]!, eye = s.own.y + stanceEye(h.reg.move[s.ownKind]!, s.own.stance);
  pilot.yaw = Math.atan2(aim[0] - s.own.x, aim[2] - s.own.z);
  pilot.pitch = Math.atan2(aim[1] - eye, Math.hypot(aim[0] - s.own.x, aim[2] - s.own.z));
  let code = -1;
  s.onResult = (seq, result) => void (seq === 0 && (code = result));
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(200);
  return code;
}

test("the sail control is thrown with E, told to a guest who joins after, refused again within two seconds, and as it was after a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-motion-"));
  const opts = { dev: true, clips: NO_CLIPS, rigs: [], map: koruMapFile(), dbPath: join(dir, "world.db") };
  let h = new Harness({}, 41, 60, opts);
  try {
    h.join("deckhand");
    h.run(800);
    for (const p of [KORU_QUAY, ...KORU_LAYOUT.routes.find((r) => r.id === "shore_to_arrival")!.anchors.map(koruPoint), koruPoint([control.origin[0]!, control.origin[1]!, control.origin[2]! - 2.2])]) walkTo(h, 0, p);
    const ref = [...h.world.structs.chunks.entries()].flatMap(([c, t]) => (t ? Array.from(t.kind.subarray(0, t.high), (k, slot) => (k === h.reg.index.get(control.id) ? c * 65536 + slot : -1)) : [])).find((r) => r >= 0)!;
    expect(h.host.motion.get(ref)).toBeNull();
    expect(throwAt(h, 0)).toBe(-1);
    const set = h.host.motion.get(ref)!;
    expect([set.from, set.to]).toEqual([0, 1]);
    h.run(200);
    expect(h.sessions[0]!.motions.get(ref)).toEqual(set);
    // A public control is no strobe: thrown again at once it is busy, and two seconds on it turns back from where it is.
    expect(throwAt(h, 0)).toBe(RESULT_BUSY);
    h.run(((THROW_TICKS + 30) * 1000) / 30);
    const late = h.join("late guest");
    h.run(800);
    expect(late.motions.get(ref)).toEqual(set);
    const before = h.world.tick;
    expect(throwAt(h, 0)).toBe(-1);
    const back = h.host.motion.get(ref)!;
    expect(back.to).toBe(0);
    expect(back.from / MOTION_STEPS).toBeCloseTo(motionProgress(set, KORU_LAYOUT.motion.seconds * 30, back.at), 3);
    expect(back.at).toBeGreaterThanOrEqual(before);
    h.run(500);
    for (const s of h.sessions) expect(s.motions.get(ref)).toEqual(back);
    h.host.shutdown();
    h = new Harness({}, 41, 60, opts);
    expect(h.host.motion.get(ref)).toEqual(back);
    const again = h.join("deckhand");
    h.run(800);
    expect(again.motions.get(ref)).toEqual(back);
  } finally {
    h.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
