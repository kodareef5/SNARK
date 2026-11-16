import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { KORU_LAYOUT, KORU_SAILS, koruPoint } from "../../content/landmarks/koru.ts";
import { SAIL_COMPONENT } from "../../server/sails.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { CMD_STRUCT, RESULT_DENIED, RESULT_FAR, S_SAILS } from "../../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { sailsProgress } from "../../shared/sim/sails.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { NO_PIN, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { KORU_COURSE, koruApproach, koruCourse } from "../../tools/koru/course.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

const ship = KORU_COURSE.vessel;
const local = (p: readonly number[]) => koruPoint(ship.x, ship.y, ship.z, ship.yaw, p);

test("a native visitor walks aboard and uses the public sail winch, sees progress, and reverses by E without a door or lock menu", () => {
  const course = koruCourse(), h = new Harness({}, 85, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(course) });
  try {
    const app = new App(h.join("sail visitor", {}, { manual: true }), h.reg, corePack());
    const run = (ms: number) => h.run(ms, now => app.frame(now, 800, 450));
    run(500);
    const s = app.session, before = s.stats.corrections;
    const walk = (p: readonly number[]) => {
      const start = Math.hypot(p[0]! - s.own.x, p[2]! - s.own.z), frames = Math.ceil(start / 4.5 * 60 * 2) + 180;
      for (let i = 0; i < frames && Math.hypot(p[0]! - s.own.x, p[2]! - s.own.z) > .08; i++) {
        const dx = p[0]! - s.own.x, dz = p[2]! - s.own.z;
        app.controls.yaw = Math.atan2(dx, dz); app.controls.pitch = 0;
        app.controls.moveZ = Math.min(1, Math.hypot(dx, dz) * 2); run(1000 / 60);
      }
      app.controls.moveZ = 0; run(100);
      expect(Math.hypot(p[0]! - s.own.x, p[2]! - s.own.z)).toBeLessThan(.16);
      expect(Math.abs(p[1]! - s.own.y)).toBeLessThan(.2);
    };
    for (const p of koruApproach(course).slice(1)) walk(p);
    const arrival = KORU_LAYOUT.routes.find(r => r.id === "shore_to_arrival")!;
    // The control is usable from the existing gangway route, without squeezing around its rail tip.
    for (const p of arrival.anchors.slice(0, 2)) walk(local(p));
    walk(local(KORU_SAILS.control.approach));
    expect(capsuleFree(h.world, s.own.x, s.own.y, s.own.z, .775, 2.6)).toBe(true);
    const aim = local(KORU_SAILS.control.aim), eye = s.own.y + stanceEye(h.reg.move[s.ownKind]!, s.own.stance);
    app.controls.yaw = Math.atan2(aim[0] - s.own.x, aim[2] - s.own.z);
    app.controls.pitch = Math.atan2(aim[1] - eye, Math.hypot(aim[0] - s.own.x, aim[2] - s.own.z)); run(150);
    expect(app.hud.prompt).toBe("E raise sails");
    app.key("KeyE", true); run(1400); // Holding must neither spam reversals nor open a structure/PIN menu.
    app.key("KeyE", false); run(100);
    const first = h.host.sails.states()[0]!;
    expect(first.target).toBe(1); expect(sailsProgress(first, h.world.tick)).toBeGreaterThan(.06);
    expect(app.hud.prompt).toMatch(/^E lower sails · Raising \d+%$/);
    expect(app.ui.structure.open).toBe(false); expect(h.client(s)!.open).toBe(0);
    const from = sailsProgress(first, h.world.tick);
    app.key("KeyE", true); run(100); app.key("KeyE", false); run(150);
    const reversed = h.host.sails.states()[0]!;
    expect(reversed.target).toBe(0); expect(Math.abs(reversed.from - from)).toBeLessThan(.01);
    expect(app.hud.prompt).toMatch(/^E raise sails · Lowering \d+%$/);
    expect(s.stats.corrections - before).toBe(0);
    expect(h.world.structs.chunks[Math.floor(first.ref / 65536)]!.kind[first.ref & 0xffff]).toBe(first.kind);
    run(2000); expect(app.hud.prompt).toBe("E raise sails");
    app.key("KeyE", true); run(100); app.key("KeyE", false); run(18500);
    expect(h.host.sails.states()[0]!.from).toBe(1); expect(h.host.sails.states()[0]!.target).toBe(1);
    expect(app.hud.prompt).toBe("E lower sails");
  } finally { h.host.shutdown(); }
}, 15000);

const controls = [
  { kind: KORU_SAILS.control.id, x: 64, y: 0, z: 64, yaw: 11776 },
  { kind: KORU_SAILS.control.id, x: 1024, y: 2, z: 1024, yaw: 49152 },
];
const map = writeMap(flatMap(20, { statics: controls, spawns: [{ name: "Winch", x: 64, z: 61.5, yaw: 0 }] }));
const options = { dev: true, clips: NO_CLIPS, rigs: [], map };

function use(h: Harness, index = 0, hold = 100) {
  const s = h.sessions[index]!, p = h.pilots[index]!, at = controls[0]!;
  p.yaw = Math.atan2(at.x - s.own.x, at.z - s.own.z);
  p.pitch = Math.atan2(at.y + .83 - s.own.y - stanceEye(h.reg.move[s.ownKind]!, s.own.stance), Math.hypot(at.x - s.own.x, at.z - s.own.z));
  h.run(150); p.buttons = BTN_USE; h.run(hold); p.buttons = 0; h.run(150);
}

test("independent rotated yachts replicate to distant late/rejoining peers, reverse continuously, and resume saved progress without offline motion", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-sails-")), opts = { ...options, dbPath: join(dir, "world.db") };
  let h = new Harness({}, 86, 60, opts);
  try {
    const s = h.join("winch operator"), observer = h.join("observer", { latencyMs: 70, jitterMs: 12, loss: .02 }); h.run(1000);
    h.pilots[1]!.moveX = 1; h.run(700); h.pilots[1]!.moveX = 0; h.run(300);
    expect(s.sails.states()).toHaveLength(2);
    for (const state of h.host.sails.states()) {
      const control = controls.find(p => Math.abs(p.x - koruPoint(state.x, state.y, state.z, state.yaw, KORU_SAILS.control.origin)[0]) < .01)!;
      expect(control).toBeDefined(); expect(state.yaw).toBe(control.yaw);
      const got = koruPoint(state.x, state.y, state.z, state.yaw, KORU_SAILS.control.origin);
      expect(got[0]).toBeCloseTo(control.x, 5); expect(got[1]).toBeCloseTo(control.y, 5); expect(got[2]).toBeCloseTo(control.z, 5);
    }
    const first = h.host.sails.states()[0]!, second = h.host.sails.states()[1]!;
    // The second yacht is over a kilometre away and has no near structure rows, yet its state is available.
    expect(s.world!.structs.chunks[Math.floor(second.ref / 65536)]).toBeNull();
    let packets = 0; const end = h.ends[0]!, receive = end.onMessage;
    end.onMessage = (channel, data) => { if (data[0] === S_SAILS) packets++; receive?.(channel, data); };
    use(h); expect(h.host.sails.states()[0]!.target).toBe(1); expect(packets).toBe(1);
    const started = h.host.sails.states()[0]!;
    h.run(3000); expect(packets).toBe(1); // No per-tick state or geometry churn.
    h.world.structs.add(h.reg.index.get("core:wall")!, 90, 1.5, 90, 0, 0, 1000); h.run(300);
    expect(packets).toBe(1); // Unrelated chunk changes do not republish sail state.
    expect(observer.sails.states().find(p => p.ref === first.ref)).toEqual(s.sails.states().find(p => p.ref === first.ref));
    expect(observer.sails.states().find(p => p.ref === second.ref)!.target).toBe(0);
    const late = h.join("late observer", { latencyMs: 80, jitterMs: 10, loss: .02 }); h.run(900);
    h.pilots[2]!.moveX = -1; h.run(700); h.pilots[2]!.moveX = 0; h.run(300);
    expect(late.sails.states().find(p => p.ref === first.ref)).toEqual(s.sails.states().find(p => p.ref === first.ref));
    const now = sailsProgress(started, h.world.tick); use(h);
    const reverse = h.host.sails.states()[0]!;
    expect(reverse.target).toBe(0); expect(reverse.from).toBeGreaterThan(now);
    expect(Math.abs(sailsProgress(started, reverse.startedAt) - reverse.from)).toBeLessThan(1 / 65535);
    const saved = sailsProgress(reverse, h.world.tick), savedTick = h.world.tick;
    h.host.shutdown(); h = new Harness({}, 87, 60, opts);
    expect(h.world.tick).toBe(savedTick);
    expect(sailsProgress(h.host.sails.states()[0]!, h.world.tick)).toBe(saved);
    const back = h.join("winch operator"); h.run(700);
    expect(back.sails.states()).toHaveLength(2);
    expect(back.sails.states()[0]!.target).toBe(0);
    h.run(10000);
    expect(h.host.sails.states()[0]!.from).toBe(0); expect(h.host.sails.states()[0]!.target).toBe(0);
    expect(sailsProgress(h.host.sails.states()[0]!, h.world.tick + 0x80000000)).toBe(0);
    const baseline = back.sails.states();
    h.ends[0]!.close(); h.run(800);
    const rejoined = h.join("winch operator"); h.run(800);
    expect(rejoined.sails.states()).toEqual(baseline);
    h.world.structs.remove(first.ref); h.world.structs.remove(second.ref); h.run(300);
    expect(rejoined.sails.states()).toEqual([]); expect(h.host.sails.states()).toEqual([]);
  } finally { h.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("sail commands preserve normal reach and wall occlusion, and an unknown saved controller version remains intact", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-sails-invalid-")), opts = { ...options, dbPath: join(dir, "world.db") };
  let h = new Harness({}, 88, 60, opts);
  try {
    const s = h.join("operator"); h.run(500); const state = h.host.sails.states()[0]!;
    const p = h.pilots[0]!; p.yaw = 0; p.moveZ = -1; h.run(1000); p.moveZ = 0;
    let code = -1; s.onResult = (_seq, value) => { code = value; };
    const command = () => { s.command(CMD_STRUCT, w => { w.u32(state.ref); w.u8(STRUCT_USE); w.u16(NO_PIN); }); h.run(250); };
    command(); expect(code).toBe(RESULT_FAR); expect(h.host.sails.states()[0]!.target).toBe(0);
    p.moveZ = 1; h.run(1000); p.moveZ = 0; h.run(150);
    const wall = h.world.structs.add(h.reg.index.get("core:wall")!, 64, 1.5, 62.7, 0, 0, 1000);
    use(h); command(); expect(code).toBe(RESULT_FAR); expect(h.host.sails.states()[0]!.target).toBe(0);
    h.world.structs.remove(wall); h.run(100); use(h); expect(h.host.sails.states()[0]!.target).toBe(1);
    const rec = h.host.fixtures.find(state.ref)!, unsupported = Uint8Array.of(99, 7, 4, 0, 1, 2, 3, 4);
    rec.extra.set(SAIL_COMPONENT, unsupported); h.host.records.dirty.add(rec.pid);
    h.host.shutdown(); h = new Harness({}, 89, 60, opts);
    h.join("operator"); h.run(500);
    expect(h.host.sails.use(h.client(h.sessions[0]!)!, state.ref)).toBe(RESULT_DENIED);
    expect(h.host.fixtures.find(state.ref)!.extra.get(SAIL_COMPONENT)).toEqual(unsupported);
    h.run(20000);
    expect(h.host.fixtures.find(state.ref)!.extra.get(SAIL_COMPONENT)).toEqual(unsupported);
  } finally { h.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
