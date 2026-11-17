import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_BUSY, RESULT_OK, S_MOTION } from "../../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { THROW_TICKS, MOTION_STEPS, motionProgress } from "../../shared/sim/motion.ts";
import { writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { KORU_QUAY, koruMap, koruMapFile, koruPoint } from "../fixtures/koru.ts";
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

test("a map with more moving statics than a message holds moves every one, tells a guest of all, then of each as it is thrown, and keeps them across a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-motions-"));
  const bay = koruMap();
  const one = (bay.statics as readonly MapStatic[]).find((s) => s.kind === control.id)!;
  const many = Array.from({ length: 299 }, (_, i) => ({ ...one, x: 300 + (i % 20) * 2, y: 1.5, z: 100 + Math.floor(i / 20) * 2 }));
  const opts = { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap({ ...bay, statics: [...(bay.statics as readonly MapStatic[]), ...many] }), dbPath: join(dir, "world.db") };
  const refs = (h: Harness): number[] => {
    const kind = h.reg.index.get(control.id)!;
    return [...h.world.structs.chunks.entries()].flatMap(([c, t]) => (t ? Array.from(t.kind.subarray(0, t.high), (k, slot) => (k === kind ? c * 65536 + slot : -1)).filter((r) => r >= 0) : []));
  };
  /** S_MOTION messages the server sends while `run` runs. */
  const told = (h: Harness, run: () => void): number => {
    const begin = h.server.begin.bind(h.server);
    let n = 0;
    h.server.begin = (type) => (type === S_MOTION && n++, begin(type));
    run();
    h.server.begin = begin;
    return n;
  };
  let h = new Harness({}, 41, 60, opts);
  try {
    const all = refs(h);
    expect(all.length).toBe(300);
    expect(all.map((r) => h.host.motion.throw(r)).filter((code) => code !== RESULT_OK)).toEqual([]);
    const guest = h.join("guest");
    expect(told(h, () => h.run(800))).toBe(2);
    expect(all.map((r) => guest.motions.get(r))).toEqual(all.map((r) => h.host.motion.get(r)!));
    h.run(((THROW_TICKS + 30) * 1000) / 30);
    // One static thrown is one message to each client, of that static alone.
    expect(told(h, () => (h.host.motion.throw(all[299]!), h.run(200)))).toBe(1);
    expect([h.host.motion.get(all[299]!)!.to, guest.motions.get(all[299]!)!.to, guest.motions.get(all[0]!)!.to]).toEqual([0, 0, 1]);
    const states = all.map((r) => h.host.motion.get(r));
    h.host.shutdown();
    h = new Harness({}, 41, 60, opts);
    expect(refs(h).map((r) => h.host.motion.get(r))).toEqual(states);
    const back = h.join("guest");
    h.run(800);
    expect(all.map((r) => back.motions.get(r) ?? null)).toEqual(states);
  } finally {
    h.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
