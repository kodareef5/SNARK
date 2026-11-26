import { K_SLIDER } from "../../client/core/ui/nodes.ts";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { DRAW_NEAR, DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import {
  KEY_CREATOR_BEARD, KEY_CREATOR_CREATE, KEY_CREATOR_HAIR, KEY_CREATOR_HAIR_COLOR, KEY_CREATOR_NOTE, KEY_CREATOR_PANEL, KEY_CREATOR_RANDOM, KEY_CREATOR_REGION,
  KEY_CREATOR_KEEP, KEY_CREATOR_RESET, KEY_CREATOR_SEX, KEY_CREATOR_SKIN, KEY_CREATOR_TAB, KEY_CREATOR_TITLE, KEY_CREATOR_TURN, type CreatorScreen,
} from "../../client/core/ui/creator.ts";
import { KEY_CROSS, KEY_VITAL } from "../../client/core/ui/hud.ts";
import { K_BAR, K_TEXT, textWidth, type UiFrame } from "../../client/core/ui/nodes.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_FOOT_L, B_HAND_L, B_HEAD, B_LOWER_ARM_L, B_UPPER_ARM_L, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import {
  HEAD_SLACK, LOOK_BEARD, LOOK_BYTES, LOOK_HAIR, LOOK_HAIR_COLOR, LOOK_SEX, LOOK_SKIN, REGIONS, REGION_COUNT, defaultLook, lookColors, lookLift, lookScales, randomLook, regionOf,
  setRegion, validLook,
} from "../../shared/anim/look.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { CMD_CREATE, PROTOCOL_VERSION, RESULT_DENIED, RESULT_INVALID, SESSION_ALIVE, SESSION_CREATING, writeCommand, writeHello } from "../../shared/net/protocol.ts";
import { EYE_BASE, HAIR_BASE, SKIN_BASE } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";
import { CH_RELIABLE } from "../../shared/net/transport.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Harness, testKey } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-creator-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ASPECTS: [string, number][] = [["4:3", 4 / 3], ["16:9", 16 / 9], ["21:9", 21 / 9], ["phone upright", 9 / 16]];

/** Fails if a node is off the canvas, a text is wider than its box, or two controls or two texts overlap. */
function fits(f: UiFrame, where: string): void {
  const over = (a: number, b: number): boolean => {
    const p = f.nodes[a]!;
    const q = f.nodes[b]!;
    return p.x < q.x + q.w - 0.01 && q.x < p.x + p.w - 0.01 && p.y < q.y + q.h - 0.01 && q.y < p.y + p.h - 0.01;
  };
  const keys = new Set<number>();
  for (let i = 0; i < f.count; i++) {
    const n = f.nodes[i]!;
    const at = `${where} key=${n.key}`;
    expect(keys.has(n.key), at).toBe(false);
    keys.add(n.key);
    expect(n.x, at).toBeGreaterThanOrEqual(-0.01);
    expect(n.y, at).toBeGreaterThanOrEqual(-0.01);
    expect(n.x + n.w, at).toBeLessThanOrEqual(f.width + 0.01);
    expect(n.y + n.h, at).toBeLessThanOrEqual(f.height + 0.01);
    expect(n.w, at).toBeGreaterThan(0);
    expect(n.h, at).toBeGreaterThan(0);
    if (n.kind === K_TEXT) expect(textWidth(n.text, n.style), `${at} "${n.text}"`).toBeLessThanOrEqual(n.w + 0.01);
    if (n.kind === K_BAR) expect(n.value >= 0 && n.value <= 1, at).toBe(true);
    for (let j = i + 1; j < f.count; j++) {
      const q = f.nodes[j]!;
      if (n.interactive && q.interactive) expect(over(i, j), `${at} and ${q.key}`).toBe(false);
      if (n.kind === K_TEXT && q.kind === K_TEXT) expect(over(i, j), `${at} and ${q.key}`).toBe(false);
    }
  }
}

artTest("a new name arrives in the creator with no body; it makes a look, and the survivor exists as made", () => {
  const h = new Harness();
  const pack = corePack();
  const app = new App(h.join("ada", { latencyMs: 20 }, { manual: true, look: null }), h.reg, pack);
  let packet = app.frame(0, 1280, 720);
  const run = (ms: number, w = 1280, ht = 720): void => h.run(ms, (now) => (packet = app.frame(now, w, ht)));
  run(500);
  const session = app.session;
  const ui = app.ui;
  const f = ui.frame;
  const click = (key: number, at = 0.5): void => {
    const n = f.find(key)!;
    expect(n, `node ${key}`).not.toBeNull();
    expect(n.interactive).toBe(true);
    app.pointer(0, key, n.x + n.w * at, n.y + n.h / 2, 0);
    if(n.kind===K_SLIDER)app.textInput(key,String(at));
    app.pointer(1, key, n.x + n.w * at, n.y + n.h / 2, 0);
    run(34);
  };

  expect(session.sessionState).toBe(SESSION_CREATING);
  expect(h.client(session)!.ent).toBe(-1);
  expect(h.world.ents.count).toBe(0);
  expect(h.host.records.byPid.size).toBe(0);
  expect(f.find(KEY_CREATOR_PANEL)).not.toBeNull();
  expect(f.find(KEY_CREATOR_TITLE)!.text).toBe("New survivor: ada");
  expect(f.find(KEY_CROSS)).toBeNull();
  expect(f.find(KEY_VITAL)).toBeNull();
  expect(ui.wantsPointerLock).toBe(false);
  // The body being made is drawn whole, as an ordinary body in front of the camera.
  const flags = (): number[] => [...packet!.drawFlags.subarray(0, packet!.drawCount)];
  expect(flags().filter((x) => (x & DRAW_SKINNED) !== 0).length).toBe(6);
  expect(flags().filter((x) => (x & DRAW_NEAR) !== 0).length).toBe(0);
  const out = [0, 0, 0];
  expect(app.cam.project(session.own.x, session.own.y + 1, session.own.z, out)).toBe(true);
  expect(out[0]!).toBeLessThan(0.45); // left of the panel
  expect(out[0]!).toBeGreaterThan(0.15);
  app.key("KeyW", true);
  run(600);
  app.key("KeyW", false);
  expect(h.world.ents.count).toBe(0);

  for (const [name, aspect] of ASPECTS) {
    for (const tab of [0, 1]) {
      ui.screen<CreatorScreen>("creator").tab = tab;
      ui.build(aspect, app.hud, session);
      fits(f, `${name} tab ${tab}`);
    }
  }
  ui.screen<CreatorScreen>("creator").tab = 0;
  run(34);

  // Female, the eighth skin tone, long hair, the tenth hair colour.
  const look = ui.screen<CreatorScreen>("creator").look;
  expect([...look]).toEqual([...defaultLook()]);
  click(KEY_CREATOR_SEX + 1);
  click(KEY_CREATOR_SKIN + 7);
  click(KEY_CREATOR_HAIR + 3);
  click(KEY_CREATOR_HAIR_COLOR + 9);
  expect([look[LOOK_SEX], look[LOOK_SKIN], look[LOOK_HAIR], look[LOOK_HAIR_COLOR]]).toEqual([1, 7, 3, 9]);
  // Any body may wear a beard, and changing the body keeps it.
  click(KEY_CREATOR_BEARD + 1);
  expect(look[LOOK_BEARD]).toBe(1);
  click(KEY_CREATOR_SEX);
  click(KEY_CREATOR_SEX + 1);
  expect([look[LOOK_SEX], look[LOOK_BEARD]]).toEqual([1, 1]);
  click(KEY_CREATOR_BEARD);
  // On the body tab each region has four keys: its label, minus, its bar and plus. A step is 0.1, native range input sets the value, and further input follows the drag.
  click(KEY_CREATOR_TAB + 1);
  expect(f.find(KEY_CREATOR_REGION)!.text).toBe("Head size");
  for (let i = 0; i < 3; i++) click(KEY_CREATOR_REGION + 3);
  expect(regionOf(look, 0)).toBeCloseTo(0.3, 1);
  click(KEY_CREATOR_REGION + 1);
  expect(regionOf(look, 0)).toBeCloseTo(0.2, 1);
  click(KEY_CREATOR_REGION + 5 * 4 + 2, 0.25);
  expect(regionOf(look, 5)).toBeCloseTo(-0.5, 1);
  expect(f.find(KEY_CREATOR_REGION + 5 * 4 + 2)!.value).toBeCloseTo(0.25, 1);
  const bar = f.find(KEY_CREATOR_REGION + 12 * 4 + 2)!;
  app.pointer(0, bar.key, bar.x + bar.w * 0.5, bar.y, 0);
  app.textInput(bar.key,"0.9");
  expect(regionOf(look, 12)).toBeCloseTo(0.8, 1);
  app.pointer(1, bar.key, bar.x + bar.w * 0.9, bar.y, 0);
  app.pointer(2, bar.key, bar.x + bar.w * 0.1, bar.y, -1); // not dragging any more
  expect(regionOf(look, 12)).toBeCloseTo(0.8, 1);
  for (let i = 0; i < 30; i++) app.pointer(0, KEY_CREATOR_REGION + 3, 0, 0, 0);
  expect(regionOf(look, 0)).toBe(1);
  // The turn buttons turn only the drawn body.
  const turned = ui.screen<CreatorScreen>("creator").turn;
  click(KEY_CREATOR_TURN + 1);
  expect(ui.screen<CreatorScreen>("creator").turn).toBeGreaterThan(turned);
  expect(app.scene!.own!.yaw).toBe(ui.screen<CreatorScreen>("creator").turn);
  click(KEY_CREATOR_RANDOM);
  const first = [...look];
  click(KEY_CREATOR_RANDOM);
  expect([...look]).not.toEqual(first);
  expect(validLook(look)).toBe(true);
  click(KEY_CREATOR_RESET);
  expect([...look]).toEqual([...defaultLook()]);
  expect(h.world.ents.count).toBe(0); // none of that was sent

  click(KEY_CREATOR_TAB);
  click(KEY_CREATOR_SEX + 1);
  click(KEY_CREATOR_SKIN + 8);
  click(KEY_CREATOR_HAIR + 4);
  click(KEY_CREATOR_TAB + 1);
  click(KEY_CREATOR_REGION + 12 * 4 + 2, 0.9);
  const made = Uint8Array.from(look);
  click(KEY_CREATOR_CREATE);
  run(400);
  expect(session.sessionState).toBe(SESSION_ALIVE);
  const e = h.ent(session);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  expect([...rec.look!]).toEqual([...made]);
  expect([...h.world.ents.looks.get(e)!]).toEqual([...made]);
  expect([...session.ownLook!]).toEqual([...made]);
  expect(f.find(KEY_CREATOR_PANEL)).toBeNull();
  expect(ui.wantsPointerLock).toBe(true);
  // The new survivor rises seen from behind, its body drawn as it was made, and on foot from behind there is no crosshair.
  expect([app.view.thirdPerson, app.scene!.own!.firstPerson]).toEqual([true, false]);
  expect(f.find(KEY_CROSS)).toBeNull();
  expect([...app.scene!.own!.look!]).toEqual([...made]);
  expect(Math.hypot(app.cam.x - session.own.x, app.cam.z - session.own.z)).toBeGreaterThan(1);

  const bo = h.join("bo", { latencyMs: 20 });
  run(600);
  const seen = new RemoteSample();
  bo.sampleRemote(seen);
  expect(seen.count).toBe(1);
  expect(seen.hasLook[0]).toBe(1);
  expect([...seen.look.subarray(0, LOOK_BYTES)]).toEqual([...made]);
  session.sampleRemote(seen);
  expect([...seen.look.subarray(0, LOOK_BYTES)]).toEqual([...defaultLook()]);
  expect(bo.stats.undecodable + session.stats.undecodable).toBe(0);
});

artTest("a remake an admin offers opens the creator on the survivor's own look, and closes made or kept", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = corePack();
  const look = defaultLook();
  look[LOOK_HAIR_COLOR] = 2;
  const app = new App(h.join("ada", { latencyMs: 20 }, { manual: true, look }), h.reg, pack);
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(600);
  const session = app.session, ui = app.ui, f = ui.frame;
  const rec = h.host.records.byPid.get(h.client(session)!.pid)!;
  const click = (key: number): void => {
    const n = f.find(key)!;
    expect(n, `node ${key}`).not.toBeNull();
    app.pointer(0, key, n.x + n.w / 2, n.y + n.h / 2, 0);
    app.pointer(1, key, n.x + n.w / 2, n.y + n.h / 2, 0);
    run(400);
  };
  expect(f.find(KEY_CREATOR_PANEL)).toBeNull();
  h.host.relook.offer(rec, true);
  run(300);
  expect(f.find(KEY_CREATOR_TITLE)!.text).toBe("Remake: ada");
  expect(f.find(KEY_CROSS)).toBeNull();
  const editing = ui.screen<CreatorScreen>("creator").look;
  expect([...editing]).toEqual([...look]);
  for (const [name, aspect] of ASPECTS) {
    ui.build(aspect, app.hud, session);
    fits(f, `remake ${name}`);
  }
  run(34);
  click(KEY_CREATOR_HAIR_COLOR + 5);
  click(KEY_CREATOR_CREATE);
  expect([rec.look![LOOK_HAIR_COLOR], h.host.relook.offered(rec), session.remaking]).toEqual([5, false, false]);
  expect(f.find(KEY_CREATOR_PANEL)).toBeNull();
  // Offered again and kept as is: nothing changes, and the offer is gone.
  h.host.relook.offer(rec, true);
  run(300);
  const before = [...rec.look!];
  click(KEY_CREATOR_SKIN + 4);
  click(KEY_CREATOR_KEEP);
  expect([[...rec.look!], h.host.relook.offered(rec)]).toEqual([before, false]);
  expect(f.find(KEY_CREATOR_PANEL)).toBeNull();
  expect(session.sessionState).toBe(SESSION_ALIVE);
  h.host.shutdown();
});

test("a look is kept with the survivor: it returns as it was made, through a restart, and never sees the creator again", () => {
  const db = join(dir, "looks.db");
  const rng = new Rng(3);
  const look = randomLook(rng);
  const h = new Harness({}, 1, 60, { dbPath: db });
  const ada = h.join("ada", {}, { look });
  const grace = h.join("grace", {}, { look: null });
  h.run(500);
  expect(grace.sessionState).toBe(SESSION_CREATING);
  const hers = randomLook(rng);
  grace.create(hers);
  h.host.spawnCreature("core:grazer", 250, 250, 1);
  h.run(500);
  expect(grace.sessionState).toBe(SESSION_ALIVE);
  expect([...ada.ownLook!]).toEqual([...look]);
  const pid = h.world.ents.pid[h.ent(ada)]!;
  for (const s of [ada, grace]) s.close();
  h.run(200);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dbPath: db });
  expect([...h2.host.records.byPid.get(pid)!.look!]).toEqual([...look]);
  // Returning with no look or with another one changes nothing.
  const again = h2.join("ada", {}, { look: null });
  const graceAgain = h2.join("grace", {}, { look: defaultLook() });
  h2.run(600);
  expect(again.sessionState).toBe(SESSION_ALIVE);
  expect([...again.ownLook!]).toEqual([...look]);
  expect([...graceAgain.ownLook!]).toEqual([...hers]);
  const seen = new RemoteSample();
  again.sampleRemote(seen);
  const others = [...Array(seen.count).keys()].filter((i) => seen.hasLook[i] !== 0);
  expect(others.length).toBe(1);
  expect([...seen.look.subarray(others[0]! * LOOK_BYTES, others[0]! * LOOK_BYTES + LOOK_BYTES)]).toEqual([...hers]);
  // The grazer is restored too, and has no look.
  expect(seen.count).toBe(2);
  h2.host.shutdown();
});

test("only a session in the creator can create, only once, and only with a look that is one", () => {
  const h = new Harness();
  const ada = h.join("ada", {}, { look: null });
  const bo = h.join("bo");
  h.run(400);
  const results = new Map<number, number>();
  ada.onResult = (seq, code) => results.set(seq, code);
  bo.onResult = (seq, code) => results.set(seq + 1000, code);
  // A sex that does not exist, a slider one step past its end, a hair that is not there, and a skin tone past the last.
  for (const [at, value] of [[LOOK_SEX, 2], [1, 128], [LOOK_HAIR, 200], [LOOK_SKIN, 10]] as const) {
    const bad = defaultLook();
    bad[at] = value;
    expect(validLook(bad)).toBe(false);
    const seq = ada.create(bad);
    h.run(200);
    expect(results.get(seq)).toBe(RESULT_INVALID);
    expect(ada.sessionState).toBe(SESSION_CREATING);
  }
  // One byte is too short to be a look.
  const w = new BitWriter(128);
  const short = ada.command(CMD_CREATE, (x) => x.u8(1));
  h.run(200);
  expect(results.get(short)).toBe(RESULT_INVALID);
  const seq = bo.create(randomLook(new Rng(8)));
  h.run(200);
  expect(results.get(seq + 1000)).toBe(RESULT_DENIED);
  expect([...h.world.ents.looks.get(h.ent(bo))!]).toEqual([...defaultLook()]);
  const good = randomLook(new Rng(9));
  const ok = ada.create(good);
  const twice = ada.create(defaultLook());
  h.run(300);
  expect(results.get(ok)).toBe(0);
  expect(results.get(twice)).toBe(RESULT_DENIED);
  expect([...h.world.ents.looks.get(h.ent(ada))!]).toEqual([...good]);
  expect(h.world.ents.count).toBe(2);

  // A hello with an invalid look is refused before anything is made.
  const end = h.net.connect({});
  let closed = false;
  end.onClose = () => (closed = true);
  const bad = defaultLook();
  bad[LOOK_SEX] = 9;
  w.reset();
  writeHello(w, PROTOCOL_VERSION, h.reg.hash, h.world.anim.set.hash, "mallory", 0, testKey("mallory"), bad);
  end.send(CH_RELIABLE, w.bytes().slice());
  h.run(300);
  expect(closed).toBe(true);
  expect(h.world.ents.count).toBe(2);
  void writeCommand;
});

test("a look picks colours and stretches bones along their own axes: longer legs lift the hips, nothing shears", () => {
  const look = defaultLook();
  const colors = new Uint8Array(6);
  look[LOOK_SKIN] = 4;
  look[LOOK_HAIR_COLOR] = 6;
  look[1 + REGION_COUNT + 2] = 3; // eye colour
  lookColors(look, colors);
  expect([colors[0], colors[2], colors[3]]).toEqual([SKIN_BASE + 4, EYE_BASE + 3, HAIR_BASE + 6]);
  expect(colors[1]).toBeGreaterThan(0);

  const scales = new Float32Array(HUMAN_BONES * 3);
  lookScales(look, scales);
  expect([...scales].every((v) => v === 1)).toBe(true);
  expect(REGIONS.length).toBe(REGION_COUNT);
  // Every slider at either end. Left and right bones scale alike.
  for (const end of [-1, 1]) {
    for (let r = 0; r < REGION_COUNT; r++) setRegion(look, r, end);
    lookScales(look, scales);
    for (let k = 0; k < scales.length; k++) {
      expect(scales[k]!).toBeGreaterThan(0.66);
      expect(scales[k]!).toBeLessThan(1.5);
    }
    for (let b = 0; b < HUMAN_BONES; b++) {
      const twin = HUMAN.names.indexOf(HUMAN.names[b]!.replace(".L", ".R"));
      for (let k = 0; k < 3; k++) expect(scales[twin * 3 + k]).toBe(scales[b * 3 + k]!);
    }
  }
  // Region 8 is arm length. At its end the arm is up to a tenth longer, as far as holdLimbs lets it, and the hand moves out along the arm only. The forearm's girth is unchanged.
  defaultLook(look);
  setRegion(look, 8, 1);
  lookScales(look, scales);
  const rest = new Solved(HUMAN_BONES);
  const long = new Solved(HUMAN_BONES);
  const pose = new Pose(HUMAN_BONES);
  solve(HUMAN, pose, rest);
  solve(HUMAN, pose, long, HUMAN.rest, scales);
  const upper = HUMAN.rest[B_LOWER_ARM_L * 3]! - HUMAN.rest[B_UPPER_ARM_L * 3]!;
  const lower = HUMAN.rest[B_HAND_L * 3]! - HUMAN.rest[B_LOWER_ARM_L * 3]!;
  const out = (long.pos[B_HAND_L * 3]! - rest.pos[B_HAND_L * 3]!) / ((upper + lower) * 0.1);
  expect(out).toBeGreaterThan(0.8);
  expect(out).toBeLessThanOrEqual(1 + 1e-6);
  expect(long.pos[B_HAND_L * 3 + 1]).toBeCloseTo(rest.pos[B_HAND_L * 3 + 1]!, 5);
  expect(long.pos[B_HAND_L * 3 + 2]).toBeCloseTo(rest.pos[B_HAND_L * 3 + 2]!, 5);
  expect([scales[B_LOWER_ARM_L * 3 + 1], scales[B_LOWER_ARM_L * 3 + 2]]).toEqual([1, 1]);
  expect(long.pos[B_HEAD * 3 + 1]).toBe(rest.pos[B_HEAD * 3 + 1]!);
  // Region 12 is leg length. The lift raises the root so a standing body's feet stay on the ground. It lifts the head
  // with it, so it stops where the head is as far from the head shots are judged on as a look may put it.
  defaultLook(look);
  setRegion(look, 12, 1);
  lookScales(look, scales);
  const lift = lookLift(scales, HUMAN.rest);
  expect(lift).toBeCloseTo(HEAD_SLACK, 6);
  pose.root[1] = lift;
  solve(HUMAN, pose, long, HUMAN.rest, scales);
  expect(long.pos[B_FOOT_L * 3 + 1]).toBeCloseTo(rest.pos[B_FOOT_L * 3 + 1]!, 4);
  expect(long.pos[B_HEAD * 3 + 1]! - rest.pos[B_HEAD * 3 + 1]!).toBeCloseTo(lift, 4);
  const rng = new Rng(21);
  const beards = [0, 0];
  for (let i = 0; i < 1000; i++) {
    const made = randomLook(rng);
    expect(validLook(made)).toBe(true);
    if (made[LOOK_BEARD] !== 0) beards[made[LOOK_SEX]!]!++;
  }
  expect(Math.min(...beards)).toBeGreaterThan(100);
  expect(f(KEY_CREATOR_NOTE)).toBe(KEY_CREATOR_NOTE);
});

/** Keeps the KEY_CREATOR_NOTE import in use. */
function f(key: number): number {
  return key;
}
