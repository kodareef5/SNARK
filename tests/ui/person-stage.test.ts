// The person stage's messages (shared/people/stage.ts) and what the stage holds of them (client/core/studio/person.ts):
// each kind parses from what a page posts, anything malformed is refused with a reason, and ids are judged against the
// stage's content.

import { expect, test } from "bun:test";
import { defaultLook, LOOK_BYTES, LOOK_LAYOUT, LOOK_SEX } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { GEAR_HELD, GEAR_WORN, WORN_FIELDS, WORN_LENGTH } from "../../shared/sim/entities.ts";
import { isStageReply, parseStageCommand, PRINT_MOST_BYTES, STAGE_FROM, STAGE_TO, stageMessage, type StageCommand } from "../../shared/people/stage.ts";
import { DRAFT_EDITION, framingOf, PersonStage, PRINTS_HELD, STAGE_TOOL } from "../../client/core/studio/person.ts";
import { printPath } from "../../shared/people/doc.ts";
import { CORE_CONTENT } from "../../content/core.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const parse = (data: object) => parseStageCommand({ to: STAGE_TO, ...data });
const command = (data: object): StageCommand => {
  const p = parse(data);
  if (!p.command) throw new Error(p.problem);
  return p.command;
};
const PLACE = { u: 0.06, v: 0.12, w: 0.25, h: 0.2, scale: 1, turn: 0 };
const garment = { item: "core:cloth_shirt", edition: 0, dye: [12, 40, 200], print: { key: "draft-1", place: PLACE } };

test("a message not addressed to the stage is not a command", () => {
  for (const data of [null, 1, "look", [], {}, { kind: "look" }, { to: "elsewhere", kind: "hour", hour: 3 }]) {
    expect(parseStageCommand(data).problem).toBeDefined();
  }
  expect(parse({ kind: "dance" }).problem).toContain("no such kind");
  expect(parse({ kind: "hour", hour: 3, id: 1.5 }).problem).toContain("id");
});

test("a look is 72 bytes, from a Uint8Array, an ArrayBuffer or a list", () => {
  const look = defaultLook();
  for (const given of [look, look.slice().buffer, Array.from(look)]) {
    const c = command({ kind: "look", look: given, id: 7 });
    expect(c).toEqual({ kind: "look", id: 7, look });
  }
  // The parsed look is a copy: the sender may reuse its bytes.
  const c = command({ kind: "look", look });
  look[LOOK_SEX] = 1;
  expect(c.kind === "look" && c.look[LOOK_SEX]).toBe(0);
  expect(parse({ kind: "look", look: new Uint8Array(28) }).problem).toContain("72");
  expect(parse({ kind: "look", look: [...defaultLook()].map((b, i) => (i === 3 ? 256 : b)) }).problem).toBeDefined();
});

test("gear is a held item and five armor slots, each an id or null", () => {
  expect(command({ kind: "gear", held: "core:pick", armor: [null, "core:cloth_shirt", null, null, null] }))
    .toEqual({ kind: "gear", held: "core:pick", armor: [null, "core:cloth_shirt", null, null, null] });
  expect(command({ kind: "gear" })).toEqual({ kind: "gear", held: null, armor: [null, null, null, null, null] });
  expect(parse({ kind: "gear", armor: [null, null] }).problem).toContain("5");
  expect(parse({ kind: "gear", held: "no colon" }).problem).toContain("held");
  expect(parse({ kind: "gear", held: 4 }).problem).toContain("held");
});

test("a wardrobe is five garments or nulls, each with an edition, a dye and a print", () => {
  const c = command({ kind: "wardrobe", slots: [null, garment, null, null, null], hide: 0b1100 });
  expect(c).toEqual({ kind: "wardrobe", slots: [null, { ...garment, dye: [12, 40, 200] }, null, null, null], hide: 12 });
  expect(command({ kind: "wardrobe", slots: [null, null, null, null, null] })).toMatchObject({ hide: 0 });
  const bad: [object, string][] = [
    [{ ...garment, dye: [1, 2] }, "dye"],
    [{ ...garment, dye: [1, 2, 300] }, "dye"],
    [{ ...garment, edition: -1 }, "edition"],
    [{ ...garment, edition: 1.5 }, "edition"],
    [{ ...garment, print: { key: "a b", place: PLACE } }, "print"],
    [{ ...garment, print: "draft-1" }, "print"],
    [{ ...garment, print: { key: "d", place: { ...PLACE, u: 2 } } }, "place"],
    [{ ...garment, item: "shirt" }, "item"],
  ];
  for (const [g, word] of bad) expect(parse({ kind: "wardrobe", slots: [g, null, null, null, null] }).problem).toContain(word);
  expect(parse({ kind: "wardrobe", slots: [null, null, null, null] }).problem).toContain("5");
  expect(parse({ kind: "wardrobe", slots: [null, null, null, null, null], hide: -1 }).problem).toContain("hide");
});

test("a print is a key and either a same-origin url or png bytes", () => {
  expect(command({ kind: "print", key: "draft-1", url: "/media/print.png" })).toEqual({ kind: "print", key: "draft-1", url: "/media/print.png", png: null });
  expect(command({ kind: "print", key: "d", url: "blob:http://x/1" })).toMatchObject({ url: "blob:http://x/1" });
  expect(command({ kind: "print", key: "d", png: new Uint8Array([137, 80]) })).toMatchObject({ url: null, png: new Uint8Array([137, 80]) });
  for (const url of ["https://elsewhere.example/a.png", "//elsewhere.example/a.png", "javascript:alert(1)", "a.png"]) {
    expect(parse({ kind: "print", key: "d", url }).problem).toContain("url");
  }
  expect(parse({ kind: "print", key: "d" }).problem).toContain("not both");
  expect(parse({ kind: "print", key: "d", url: "/a.png", png: [1] }).problem).toContain("not both");
  expect(parse({ kind: "print", key: "", url: "/a.png" }).problem).toContain("key");
  expect(parse({ kind: "print", key: "d", png: new Uint8Array(PRINT_MOST_BYTES + 1) }).problem).toContain("too large");
});

test("pose, hour, framing and picture take only what they list", () => {
  expect(command({ kind: "pose", pose: "walk", at: 0.25 })).toEqual({ kind: "pose", pose: "walk", at: 0.25 });
  expect(command({ kind: "pose", pose: "seated" })).toEqual({ kind: "pose", pose: "seated", at: null });
  expect(parse({ kind: "pose", pose: "fly" }).problem).toContain("idle");
  expect(parse({ kind: "pose", pose: "idle", at: 2 }).problem).toContain("share");
  expect(command({ kind: "hour", hour: 18.5 })).toEqual({ kind: "hour", hour: 18.5 });
  for (const hour of [-1, 25, Number.NaN, "noon"]) expect(parse({ kind: "hour", hour }).problem).toBeDefined();
  expect(command({ kind: "framing", framing: "three-quarter" })).toEqual({ kind: "framing", framing: "three-quarter" });
  expect(parse({ kind: "framing", framing: "side" }).problem).toContain("portrait");
  expect(command({ kind: "picture" })).toEqual({ kind: "picture", width: null, height: null });
  expect(command({ kind: "picture", width: 800, height: 1000 })).toEqual({ kind: "picture", width: 800, height: 1000 });
  expect(parse({ kind: "picture", width: 800 }).problem).toContain("both");
  expect(parse({ kind: "picture", width: 8, height: 8 }).problem).toContain("64");
});

test("a page's message parses back to the command it was made from", () => {
  const sent = stageMessage({ kind: "pose", id: 3, pose: "tool", at: null });
  expect(sent.to).toBe(STAGE_TO);
  // Through structured clone, as postMessage carries it.
  expect(parseStageCommand(structuredClone(sent)).command).toEqual({ kind: "pose", id: 3, pose: "tool", at: null });
  expect(isStageReply({ from: STAGE_FROM, kind: "ready", meshes: [] })).toBe(true);
  expect(isStageReply({ from: "someone", kind: "ready" })).toBe(false);
});

test("the stage takes a valid look and keeps its own for one out of range", () => {
  const stage = new PersonStage(reg);
  const look = defaultLook();
  look[LOOK_SEX] = 1;
  expect(stage.apply(command({ kind: "look", look })).held).toEqual({ sex: "f", bytes: LOOK_BYTES });
  const version = stage.version;
  const wrong = defaultLook();
  wrong[LOOK_LAYOUT] = 9;
  const { notes } = stage.apply(command({ kind: "look", look: wrong }));
  expect(notes.join()).toContain("out of range");
  expect(stage.look[LOOK_SEX]).toBe(1);
  expect(stage.version).toBe(version);
});

test("the stage judges gear ids against its content and armor by its slot", () => {
  const stage = new PersonStage(reg);
  const { held, notes } = stage.apply(command({ kind: "gear", held: "core:pick", armor: ["core:cloth_hat", "core:cloth_hat", null, "core:nothing_here", null] }));
  expect(held).toEqual({ held: "core:pick", armor: ["core:cloth_hat", null, null, null, null] });
  expect(notes).toEqual(["core:cloth_hat is not worn in armor slot 1", "core:nothing_here is not an item here"]);
  expect(stage.gear[GEAR_HELD]).toBe(reg.index.get("core:pick")!);
  expect(stage.gear[GEAR_WORN]).toBe(reg.index.get("core:cloth_hat")!);
  // A species is content, but not an item.
  expect(stage.apply(command({ kind: "gear", held: "core:survivor" })).notes).toEqual(["core:survivor is not an item here"]);
});

test("the stage holds a wardrobe and its hide mask, and says garments are drawn", () => {
  const stage = new PersonStage(reg);
  const { held, notes } = stage.apply(command({ kind: "wardrobe", slots: [null, garment, { ...garment, item: "core:nothing_here" }, null, null], hide: 4 }));
  expect(notes).toEqual(["core:nothing_here is not an item here"]);
  expect(held).toEqual({ slots: [null, garment, null, null, null], hide: 4, drawn: true });
  expect(stage.hide).toBe(4);
});

test("the stage holds the latest prints by key, the oldest let go first", () => {
  const stage = new PersonStage(reg);
  for (let k = 0; k < PRINTS_HELD + 2; k++) stage.apply(command({ kind: "print", key: `p${k}`, url: `/p${k}.png` }));
  expect(stage.prints.map((p) => p.key)).toEqual(Array.from({ length: PRINTS_HELD }, (_, k) => `p${k + 2}`));
  // Sent again, a print moves to the newest.
  stage.apply(command({ kind: "print", key: "p2", url: "/again.png" }));
  expect(stage.prints.at(-1)!.key).toBe("p2");
  expect(stage.prints.length).toBe(PRINTS_HELD);
});

test("each pose plays a move the game has, a tool pose holding a hatchet", () => {
  const stage = new PersonStage(reg);
  const anim = { idle: "idle", walk: "walk", toolCarry: "carry", emotes: [] as string[] } as never;
  stage.apply(command({ kind: "pose", pose: "tool" }));
  expect(stage.move(anim)).toEqual({ clip: "carry" as never, held: reg.index.get(STAGE_TOOL)! });
  stage.apply(command({ kind: "gear", held: "core:pick" }));
  expect(stage.move(anim).held).toBe(reg.index.get("core:pick")!);
  stage.apply(command({ kind: "pose", pose: "walk" }));
  expect(stage.move(anim).clip).toBe("walk" as never);
  // The sit emote's clip comes after the first frame; until then there is none.
  stage.apply(command({ kind: "pose", pose: "seated" }));
  expect(stage.move(anim).clip).toBeNull();
});

test("framings look from the front, the back and three-quarters, lower when seated", () => {
  expect(framingOf("full", "idle").yaw).toBeCloseTo(Math.PI);
  expect(framingOf("back", "idle").yaw).toBe(0);
  expect(framingOf("three-quarter", "idle").yaw).toBeGreaterThan(Math.PI);
  expect(framingOf("portrait", "idle").y).toBeGreaterThan(1.4);
  expect(framingOf("portrait", "idle").radius).toBeLessThan(framingOf("full", "idle").radius);
  for (const f of ["full", "portrait", "back", "three-quarter"] as const) expect(framingOf(f, "seated").y).toBeLessThan(framingOf(f, "idle").y);
});

test("the stage writes its person into a sample as a survivor with its look and gear", () => {
  const stage = new PersonStage(reg);
  stage.apply(command({ kind: "gear", held: "core:pick", armor: [null, null, null, null, "core:cloth_boots"] }));
  const actors = { kind: new Uint16Array(2), hasLook: new Uint8Array(2), look: new Uint8Array(2 * LOOK_BYTES), gear: new Uint16Array(12) };
  const survivor = reg.index.get("core:survivor")!;
  stage.writeActor(actors, 1, survivor, 0);
  expect(actors.kind[1]).toBe(survivor);
  expect(actors.hasLook[1]).toBe(1);
  expect([...actors.look.subarray(LOOK_BYTES)]).toEqual([...stage.look]);
  expect(actors.gear[6 + GEAR_HELD]).toBe(0);
  expect(actors.gear[6 + GEAR_WORN + 4]).toBe(reg.index.get("core:cloth_boots")!);
});

test("the stage's wardrobe goes to the renderer as items, editions and packed dye", () => {
  const stage = new PersonStage(reg);
  const out = new Uint32Array(WORN_LENGTH);
  expect(stage.wornInto(out)).toBe(false);
  stage.apply(command({ kind: "wardrobe", slots: [{ item: "core:plain_tee", edition: 3, dye: [12, 40, 200], print: null }, null, null, null, null], hide: 0 }));
  expect(stage.wornInto(out)).toBe(true);
  expect([...out.subarray(0, WORN_FIELDS)]).toEqual([reg.index.get("core:plain_tee")!, 3, 12 | (40 << 8) | (200 << 16)]);
  expect(out.subarray(WORN_FIELDS).every((v) => v === 0)).toBe(true);
});

test("a draft's print is drawn as the game draws an edition's, by a stand-in edition", () => {
  const stage = new PersonStage(reg);
  const tee = { item: "core:plain_tee", edition: 0, dye: [12, 40, 200], print: { key: "draft-1", place: PLACE } };
  stage.apply(command({ kind: "wardrobe", slots: [tee, null, null, null, null], hide: 0 }));
  const out = new Uint32Array(WORN_LENGTH);
  stage.wornInto(out);
  expect(out[1]).toBe(DRAFT_EDITION);
  // No picture held yet: nothing printed.
  expect(stage.printOf(DRAFT_EDITION)).toBeNull();
  stage.apply(command({ kind: "print", key: "draft-1", url: "/x.png" }));
  expect(stage.printOf(DRAFT_EDITION)).toBeNull();
  stage.sized("draft-1", 512, 256);
  const print = stage.printOf(DRAFT_EDITION)!;
  expect(print).toMatchObject({ width: 512, height: 256, place: PLACE });
  expect(stage.pathOf("draft-1")).toBe(printPath(print.hash));
  // The same object each frame, so the renderer keeps its layer; a picture sent again is a new one.
  expect(stage.printOf(DRAFT_EDITION)).toBe(print);
  stage.apply(command({ kind: "print", key: "draft-1", url: "/y.png" }));
  stage.sized("draft-1", 512, 256);
  expect(stage.printOf(DRAFT_EDITION)!.hash).not.toBe(print.hash);
  expect(stage.printOf(7)).toBeNull();
});

test("a published edition's print is drawn under its own edition", () => {
  const stage = new PersonStage(reg);
  stage.apply(command({ kind: "print", key: "print.abc", url: "/media/print.abc.png" }));
  stage.sized("print.abc", 256, 256);
  stage.apply(command({ kind: "wardrobe", slots: [{ item: "core:plain_tee", edition: 7, dye: [0, 0, 0], print: { key: "print.abc", place: PLACE } }, null, null, null, null], hide: 0 }));
  expect(stage.printOf(7)).toMatchObject({ width: 256, place: PLACE });
  stage.unheld("print.abc");
  expect(stage.printOf(7)).toBeNull();
});
