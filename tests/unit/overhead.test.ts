import { expect, test } from "bun:test";
import { BAR_FOOD, BAR_HEALTH, BAR_TAMING, BAR_TORPOR, HEART_RAYS, HudModel, MAX_HEARTS, OWNER_OTHER, OWNER_TRIBE, OverheadModel, fillOverhead, type Heads } from "../../client/core/hud.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { KEY_CROSS, KEY_PROMPT, KEY_READOUT } from "../../client/core/ui/hud.ts";
import { K_IMAGE, K_TEXT, textWidth, type UiFrame } from "../../client/core/ui/nodes.ts";
import { IMAGE_HEART, KEY_HEART, KEY_OVER_NOTE, KEY_OVER_PANEL, KEY_OVER_TITLE, heartImage, heartSize } from "../../client/core/ui/tame.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { CUE_MATING_SHIFT, MATING_STEPS } from "../../shared/anim/pose.ts";
import { flatWorld } from "../fixtures/world.ts";

const ASPECTS: [string, number][] = [["4:3", 4 / 3], ["16:9", 16 / 9], ["21:9", 21 / 9], ["phone upright", 9 / 16]];
const isOver = (key: number): boolean => key >= KEY_OVER_TITLE && key <= KEY_OVER_NOTE;
const isHeart = (key: number): boolean => key >= KEY_HEART && key < KEY_HEART + MAX_HEARTS;

/** The most a mark says: a long name, a young one's line, another tribe's name, every bar and a note. */
function fullest(u: number, v: number, heart: boolean): HudModel {
  const hud = new HudModel();
  hud.prompt = "E  open ada's cache";
  const m = hud.overhead;
  m.look = true;
  m.u = u;
  m.v = v;
  m.owner = OWNER_OTHER;
  m.title = "W".repeat(24);
  m.line = "parasaur  level 450  adolescent 99%";
  m.tribe = `of ${"W".repeat(24)}`;
  for (const kind of [BAR_HEALTH, BAR_FOOD, BAR_TORPOR, BAR_TAMING]) m.bars[m.barCount++] = { kind, fraction: 1 };
  m.note = "100% effective";
  for (let k = 0; k < MAX_HEARTS; k++) m.hearts[m.heartCount++] = { u: (k % 6) / 5, v: Math.floor(k / 6) / 3, far: k * 1.3, step: k % (MATING_STEPS + 1) };
  if (heart) {
    m.hearts[0] = { u, v, far: 2, step: 3 };
    m.heart = 0;
  }
  return hud;
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test("the marks over creatures fit every window shape: on the canvas wherever the creature is, text within its node, none over another, the crosshair or the line under it, and under the rest of the HUD", () => {
  const places = [-0.3, 0, 0.01, 0.3, 0.5, 0.7, 0.99, 1, 1.3];
  for (const [name, aspect] of ASPECTS) {
    for (const u of places) {
      for (const v of places) {
        for (const heart of [false, true]) {
          const ui = new Ui();
          ui.settings.diagnostics = true;
          ui.build(aspect, fullest(u, v, heart), null);
          const f: UiFrame = ui.frame;
          const where = `${name} at ${u}, ${v}${heart ? " with a heart" : ""}`;
          const keys = new Set<number>();
          let marks = 0;
          for (let i = 0; i < f.count; i++) {
            const n = f.nodes[i]!;
            expect(keys.has(n.key), where).toBe(false);
            keys.add(n.key);
            if (!isOver(n.key) && !isHeart(n.key)) continue;
            marks++;
            expect(n.x >= -0.01 && n.y >= -0.01 && n.x + n.w <= f.width + 0.01 && n.y + n.h <= f.height + 0.01, `${where} key ${n.key}`).toBe(true);
            if (n.kind === K_TEXT) expect(textWidth(n.text, n.style), `${where} key ${n.key}`).toBeLessThanOrEqual(n.w + 0.01);
            // Under the HUD, which comes after.
            expect(i, where).toBeLessThan(f.nodes.indexOf(f.find(KEY_READOUT)!));
            for (const key of [KEY_CROSS, KEY_PROMPT]) if (isOver(n.key)) expect(overlaps(n, f.find(key)!), `${where} key ${n.key} over ${key}`).toBe(false);
            for (let j = i + 1; j < f.count; j++) {
              const q = f.nodes[j]!;
              if (n.kind === K_TEXT && q.kind === K_TEXT && isOver(n.key) && isOver(q.key)) expect(overlaps(n, q), `${where} keys ${n.key} ${q.key}`).toBe(false);
            }
          }
          // Every heart, and the mark's backdrop, title, line, tribe, four labelled bars and note.
          expect(marks, where).toBe(MAX_HEARTS + 4 + 4 * 2 + 1);
          // Its text is on its backdrop, and the mark stands over its creature's heart.
          const panel = f.find(KEY_OVER_PANEL)!;
          for (let i = 0; i < f.count; i++) {
            const n = f.nodes[i]!;
            if (isOver(n.key) && n.kind === K_TEXT) expect(n.x >= panel.x && n.x + n.w <= panel.x + panel.w && n.y >= panel.y && n.y + n.h <= panel.y + panel.h + 0.01, `${where} key ${n.key}`).toBe(true);
          }
          const title = f.find(KEY_OVER_TITLE)!;
          if (heart && v * f.height - heartSize(2) - 2 > title.h + 8 && v < 0.45) expect(title.y + title.h, where).toBeLessThanOrEqual(f.find(KEY_HEART)!.y);
        }
      }
    }
  }
});

test("a heart is smaller further off, drawn the farthest first, and filled to its step", () => {
  expect([heartSize(0), heartSize(5), heartSize(30), heartSize(100)]).toEqual([20, 20, 11, 11]);
  for (let d = 5; d < 30; d++) expect(heartSize(d + 1)).toBeLessThanOrEqual(heartSize(d));
  const ui = new Ui();
  const hud = new HudModel();
  const m = hud.overhead;
  for (let k = 0; k <= MATING_STEPS; k++) m.hearts[m.heartCount++] = { u: 0.1 + k * 0.1, v: 0.5, far: 3 + k * 3, step: k };
  ui.build(16 / 9, hud, null);
  const f = ui.frame;
  const drawn = f.nodes.slice(0, f.count).filter((n) => isHeart(n.key));
  expect(drawn.map((n) => n.key)).toEqual(Array.from({ length: MATING_STEPS + 1 }, (_, k) => KEY_HEART + MATING_STEPS - k));
  expect(drawn.every((n) => n.kind === K_IMAGE && n.image === IMAGE_HEART + n.key - KEY_HEART && n.w === heartSize(m.hearts[n.key - KEY_HEART]!.far))).toBe(true);
  // Each step's picture is lit further up than the step before, from none at the first to whole at the last. Step 0, a
  // heart that tells no progress, is lit whole.
  const lit = (s: number): number => {
    const img = f.images[IMAGE_HEART + s]!;
    let n = 0;
    for (let p = 0; p < img.data.length; p += 4) if (img.data[p]! > 200 && img.data[p + 3]! > 200) n++;
    return n;
  };
  const steps = Array.from({ length: MATING_STEPS }, (_, k) => lit(k + 1));
  expect(steps.every((n, k) => k === 0 || n > steps[k - 1]!)).toBe(true);
  expect([steps[0], lit(0)]).toEqual([0, steps[MATING_STEPS - 1]!]);
  for (let s = 0; s <= MATING_STEPS; s++) expect(f.images[IMAGE_HEART + s]!.version).toBe(7000 + s);
  // Clear around the shape.
  const corner = heartImage(1, 1).data;
  expect([corner[3], corner[31 * 4 + 3], corner[(31 * 32) * 4 + 3]]).toEqual([0, 0, 0]);
});

/** A viewer of team 7 standing at (50, 0, 40) on flat ground, looking north, and `n` dodos of its team ahead, each mating if `mate` says. */
function crowd(n: number, mate: (i: number) => number, place: (i: number) => [number, number]) {
  const w = flatWorld(2);
  const reg = w.reg;
  const dodo = reg.index.get("core:dodo")!;
  const r = new RemoteSample();
  r.count = n;
  for (let i = 0; i < n; i++) {
    const [x, z] = place(i);
    r.id[i] = i + 1;
    r.kind[i] = dodo;
    [r.x[i], r.y[i], r.z[i]] = [x, 0, z];
    r.team[i] = 7;
    r.level[i] = 5;
    r.cue[i] = (mate(i) << CUE_MATING_SHIFT) >>> 0;
  }
  const session = { world: w, registry: reg, ownHandle: 0x7ffff, own: { x: 50, y: 0, z: 40 }, driving: -1, tribe: { team: 7 }, looked: null } as unknown as ClientSession;
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.aspect] = [50, 1.62, 40, 0, -0.15, 16 / 9];
  cam.update();
  return { w, r, session, cam };
}

const NO_HEADS: Heads = { overhead: () => false };

test("a heart behind a wall is not drawn, nor one out of range; the look stops at a wall; and the nearest hearts are kept", () => {
  const { w, r, session, cam } = crowd(4, (i) => (i < 3 ? 2 : 0), (i) => [[50, 46], [55, 50], [48, 75], [50, 44]][i] as [number, number]);
  const m = new OverheadModel();
  fillOverhead(m, session, r, cam, NO_HEADS, 1.62, 0, Math.atan2(0.3 - 1.62, 4));
  // The one at 4 m is looked at. The hearts are those of the first two, the third being 35 m off.
  expect([m.look, m.owner, m.title, m.line, m.heartCount, m.hearts[0]!.step, m.heart]).toEqual([true, OWNER_TRIBE, "Dodo", "level 5", 2, 2, -1]);
  expect(m.hearts[0]!.far).toBeLessThan(m.hearts[1]!.far);
  // A wall 5 m ahead hides the heart at 6 m and leaves the one at 10 m, off to the side.
  w.structs.add(w.kind("core:wall"), 50, 1.5, 45, 0, 0, 1);
  fillOverhead(m, session, r, cam, NO_HEADS, 1.62, 0, Math.atan2(0.3 - 1.62, 4));
  expect([m.look, m.heartCount, m.hearts[0]!.far > 10]).toEqual([true, 1, true]);
  // The look at the one behind the wall stops at the wall.
  fillOverhead(m, session, r, cam, NO_HEADS, 1.62, 0, Math.atan2(0.3 - 1.62, 6));
  r.cue[3] = 0;
  r.count = 3;
  fillOverhead(m, session, r, cam, NO_HEADS, 1.62, 0, Math.atan2(0.3 - 1.62, 6));
  expect(m.look).toBe(false);
});

test("a base of 550 creatures in view, half of them mating: at most MAX_HEARTS hearts and HEART_RAYS rays a frame, the nearest kept, the rest counted dropped", () => {
  // Rows of dodos from 3 m to 33 m ahead, 1.2 m apart.
  const { r, session, cam } = crowd(550, (i) => (i % 2 === 0 ? 1 + (i % MATING_STEPS) : 0), (i) => [50 - 12 + (i % 20) * 1.2, 43 + Math.floor(i / 20) * 1.1]);
  const m = new OverheadModel();
  fillOverhead(m, session, r, cam, NO_HEADS, 1.62, 0, -0.15);
  expect([m.heartCount, m.rays <= HEART_RAYS, m.dropped > 100]).toEqual([MAX_HEARTS, true, true]);
  for (let k = 1; k < m.heartCount; k++) expect(m.hearts[k]!.far).toBeGreaterThanOrEqual(m.hearts[k - 1]!.far);
  const ui = new Ui();
  const hud = new HudModel();
  fillOverhead(hud.overhead, session, r, cam, NO_HEADS, 1.62, 0, -0.15);
  ui.build(16 / 9, hud, null);
  let nodes = 0;
  for (let i = 0; i < ui.frame.count; i++) if (isOver(ui.frame.nodes[i]!.key) || isHeart(ui.frame.nodes[i]!.key)) nodes++;
  expect(nodes).toBeLessThanOrEqual(MAX_HEARTS + 12);
});
