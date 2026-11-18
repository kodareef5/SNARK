import { expect, test } from "bun:test";
import { artTest } from "../fixtures/needs-art.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Assets } from "../../client/core/assets/assets.ts";
import { fillBuffs, HudModel } from "../../client/core/hud.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { FramePacket, InstanceWriter } from "../../client/core/render/packet.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { TRIKE_DYES } from "../../content/creatures/trike.ts";
import { AnimState, CUE_DEAD, CUE_DECAY_SHIFT, CUE_RIVALRY } from "../../shared/anim/pose.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { F_AWAKE, GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { dinosaurCourse } from "../../tools/dinosaurs/course.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

// All Trike rules and native assets are stock. Only the fixture hunter's drag qualifies it.
const { registry } = compileContent(CORE_CONTENT.map(d => d.type === "species" && d.id === "core:raptor" ? { ...d, drag: 400 } : d));
const reg = registry!, pack = corePack();

test("Trike rivalry follows the actual nearby threat across riders, observers, unconsciousness and death", () => {
  const h = new Harness({}, 1, 60, { dev: true, wakeRadius: 0, map: writeMap(dinosaurCourse()) }, reg);
  try {
    const ents = h.world.ents, records = h.host.records;
    const keeper = h.join("keeper"), watcher = h.join("watcher"); h.run(300);
    h.say(keeper, "enablecheats"); h.say(keeper, "tp 121 120");
    h.say(watcher, "enablecheats"); h.say(watcher, "tp 125 120");
    function spawn(name: string, x: number, z: number, tame = false) {
      const e = h.host.spawnCreature("core:" + name, x, z, 1);
      const rec = records.byPid.get(ents.pid[e]!)!;
      if (tame) {
        expect(h.host.taming.give(rec, records.byPid.get(h.client(keeper)!.pid)!, 0, "forced")).toBe(true);
        rec.saddle = reg.index.get("core:saddle_" + name) ?? 0;
        h.host.refreshBody(rec); h.host.creatures.claimed(e);
      }
      h.host.creatures.mind.stay(e, 0xffffffff);
      return { e, rec };
    }
    const trike = spawn("trike", 120, 120, true), ordinary = spawn("parasaur", 126, 122, true);
    trike.rec.genome!.colors.set(TRIKE_DYES); h.host.refreshBody(trike.rec);
    const threat = spawn("raptor", 180, 120);
    const move = (x: number) => { ents.setPosition(threat.e, x, h.world.hf.heightAt(x, 120), 120); h.host.creatures.relocated(threat.e); h.run(1400); };
    const cues = (s: ClientSession, e: number) => {
      const remote = new RemoteSample(); s.sampleRemote(remote);
      const i = remote.id.subarray(0, remote.count).indexOf(e);
      expect(i).toBeGreaterThanOrEqual(0);
      return { cue: remote.cue[i]!, colors: Array.from(remote.colors.subarray(i * 6, i * 6 + 6)) };
    };
    const hud = (s: ClientSession) => {
      const model = new HudModel(), state = new AnimState();
      if (s.driving >= 0) state.unpackCue(cues(s, s.driving).cue);
      fillBuffs(model, s, reg, pack.palette, state.rivalry && !state.out);
      return model.buffs.some(b => b.label.startsWith("Rivalry"));
    };
    move(180);
    const health = trike.rec.vitals!.max[V_HEALTH]!;
    expect(cues(watcher, trike.e).cue & CUE_RIVALRY).toBe(0);
    expect(h.host.riding.mount(h.client(keeper)!, trike.e)).toBe(RESULT_OK); h.run(400);
    expect(hud(keeper)).toBe(false);
    move(132);
    expect(trike.rec.vitals!.max[V_HEALTH]!).toBeCloseTo(health * 1.1, 0);
    expect(cues(watcher, trike.e).cue & CUE_RIVALRY).toBe(CUE_RIVALRY);
    expect(cues(watcher, ordinary.e).cue & CUE_RIVALRY).toBe(0);
    expect(hud(keeper)).toBe(true); expect(hud(watcher)).toBe(false);
    expect(cues(watcher, trike.e).colors).toEqual([...TRIKE_DYES]);
    h.host.refreshBody(trike.rec); h.run(330);
    expect(cues(keeper, trike.e).cue & CUE_RIVALRY).toBe(CUE_RIVALRY);
    h.host.riding.dismount(h.client(keeper)!); h.run(450);
    expect(hud(keeper)).toBe(false);
    expect(cues(watcher, trike.e).cue & CUE_RIVALRY).toBe(CUE_RIVALRY);
    // Nobody is in the cell. The trait falls away on sleep and is recalculated on wake.
    h.say(watcher, "tp 216 208"); h.say(keeper, "tp 217 208"); h.run(400);
    expect(ents.flags[trike.e]! & F_AWAKE).toBe(0);
    expect(ents.cue[trike.e]! & CUE_RIVALRY).toBe(0);
    h.say(watcher, "tp 125 120"); h.say(keeper, "tp 121 120"); h.run(1300);
    expect(cues(watcher, trike.e).cue & CUE_RIVALRY).toBe(CUE_RIVALRY);
    keeper.close(); h.run(300);
    const rejoined = h.join("keeper"); h.run(750);
    expect(cues(rejoined, trike.e).cue & CUE_RIVALRY).toBe(CUE_RIVALRY);
    expect(h.host.riding.mount(h.client(rejoined)!, trike.e)).toBe(RESULT_OK); h.run(400);
    expect(hud(rejoined)).toBe(true);
    move(180);
    expect(hud(rejoined)).toBe(false);
    expect(cues(watcher, trike.e).colors).toEqual([...TRIKE_DYES]);
    move(132);
    h.host.survival.add(trike.rec, V_TORPOR, 1e6); h.run(800);
    expect(trike.rec.out).toBe(true);
    expect(cues(watcher, trike.e).cue & CUE_RIVALRY).toBe(0);
    h.host.survival.add(trike.rec, V_TORPOR, -1e6); h.run(2400);
    expect(cues(watcher, trike.e).cue & CUE_RIVALRY).toBe(CUE_RIVALRY);
    // A dead hunter's corpse retains its rendered species while becoming a prop.
    h.host.survival.hurt(threat.rec, 1e6, 0); h.run(1400);
    expect(cues(watcher, trike.e).cue & CUE_RIVALRY).toBe(0);
    spawn("raptor", 132, 120); h.run(1400);
    expect(cues(watcher, trike.e).cue & CUE_RIVALRY).toBe(CUE_RIVALRY);
    const previous = new Set(h.host.corpses.bodies.keys());
    h.host.survival.hurt(trike.rec, 1e6, 0); h.run(600);
    const corpse = [...h.host.corpses.bodies.values()].find(body => !previous.has(body.rec.pid))!;
    const dead = cues(watcher, corpse.e), state = new AnimState();
    state.unpackCue(dead.cue); expect([state.dead, state.rivalry, state.decay, dead.colors]).toEqual([true, false, 0, [...TRIKE_DYES]]);
    for (const decay of [1, 2, 3]) {
      state.unpackCue(CUE_DEAD | (decay << CUE_DECAY_SHIFT)); expect([state.rivalry, state.decay]).toEqual([false, decay]);
    }
  } finally { h.host.shutdown(); }
});

test("a saved Trike keeps its inherited dye and re-evaluates a nearby threat after loading", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-rivalry-"));
  const options = { dev: true, wakeRadius: 0, map: writeMap(dinosaurCourse()), dbPath: join(dir, "world.db") };
  let h: Harness | null = new Harness({}, 1, 60, options, reg);
  try {
    const player = h.join("rider"); h.run(300); h.say(player, "enablecheats"); h.say(player, "tp 120 120");
    const e = h.host.spawnCreature("core:trike", 122, 120, 1);
    const pid = h.world.ents.pid[e]!, rec = h.host.records.byPid.get(pid)!;
    const hunter = h.host.spawnCreature("core:raptor", 116, 120, 1);
    h.host.creatures.mind.stay(e, 0xffffffff); h.host.creatures.mind.stay(hunter, 0xffffffff);
    const dyes = [14, 139, 97, 21, 11, 124];
    rec.genome!.colors.set(dyes); h.host.records.dirty.add(pid); h.host.refreshBody(rec);
    h.run(1300);
    expect(h.world.ents.cue[e]! & CUE_RIVALRY).toBe(CUE_RIVALRY);
    h.host.shutdown(); h = null;
    h = new Harness({}, 1, 60, options, reg); h.run(300);
    const restored = h.host.records.byPid.get(pid)!, body = h.host.records.entOf.get(pid)!;
    expect([...restored.genome!.colors]).toEqual(dyes);
    expect([...h.world.ents.colors.subarray(body * 6, body * 6 + 6)]).toEqual(dyes);
    expect(h.world.ents.cue[body]! & CUE_RIVALRY).toBe(0);
    const again = h.join("rider"); h.run(500); h.say(again, "enablecheats"); h.say(again, "tp 120 120");
    h.run(1400);
    expect(h.world.ents.cue[body]! & CUE_RIVALRY).toBe(CUE_RIVALRY);
    expect([...restored.genome!.colors]).toEqual(dyes);
  } finally { h?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

artTest("native draws flush only the configured frill, preserve custom dyes and leave the saddle alone", () => {
  const kind = reg.index.get("core:trike")!, saddle = reg.index.get("core:saddle_trike")!;
  const render = new Characters(reg, pack, new Assets(reg, pack));
  function draw(dyes: Uint8Array, word: number) {
    const state = new AnimState(); state.unpackCue(word); state.grounded = true;
    const packet = new FramePacket(), gear = new Uint16Array(GEAR_COUNT); gear[GEAR_WORN] = saddle;
    render.begin();
    expect(render.add(packet, kind, 0, 0, 6, 0, state, 20, null, 0, dyes, 0, gear, 0, 11, false, false)).toBe(true);
    const offsets = new Map<string, number>();
    render.flush(packet, new InstanceWriter(packet.transient), false, (mesh, _lod, first) => offsets.set(pack.header.meshes[mesh]!.id, first * INSTANCE_BYTES + 14));
    const colors = (name: string) => { expect(offsets.has(name)).toBe(true); const at = offsets.get(name)!; return [...packet.transient.subarray(at, at + 6)]; };
    return { body: colors("core:trike"), saddle: colors("core:saddle_trike/worn") };
  }
  for (const frill of [TRIKE_DYES[3]!, 0, 9, 10, 11, 21]) {
    const dyes = Uint8Array.from(TRIKE_DYES); dyes[3] = frill;
    const ordinary = draw(dyes, 0), alert = draw(dyes, CUE_RIVALRY);
    expect(ordinary.body).toEqual([...dyes]);
    expect(alert.body.filter((_, i) => i !== 3)).toEqual(ordinary.body.filter((_, i) => i !== 3));
    expect(alert.body[3]).not.toBe(frill); expect(alert.saddle).toEqual(ordinary.saddle);
    expect(draw(dyes, 0)).toEqual(ordinary);
  }
});
