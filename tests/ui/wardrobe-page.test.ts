// The wardrobe admin page's logic (client/core/admin/wardrobe.ts): a draft judged as the store judges it, a sheet's PNG
// brought under the cap, the publish and retire calls through 409 and 503, and what the person stage is sent.
import { expect, test } from "bun:test";
import { LOOK_SEX, validLook } from "../../shared/anim/look.ts";
import { PRINT_BYTES_MAX, readDraft } from "../../shared/people/doc.ts";
import { parseStageCommand, stageMessage } from "../../shared/people/stage.ts";
import { cluster, resolveAdmin } from "../../client/core/admin/navigation.ts";
import {
  BUSY_WAITS, CLOTH_COLOURS, DRAFT_PRINT, FIT_LEAST, FIT_TRIES, LAYERS_MAX, LOOKS, STORE_CAPS, addPicture, addShape, addText, draftFaults, draftFrom, fitNote, fitStep,
  heldSize, layerAt, lookOf, moveLayer, newDraft, newSheet, outcomeText, placeOf, previewChanges, publishBody, publishDraft, retireEdition, wardrobeCommand,
  type Answer, type Draft, type PeopleState, type Preview, type PublishIo,
} from "../../client/core/admin/wardrobe.ts";

const GARMENTS = [
  { id: "core:plain_tee", label: "plain tee", slot: "top", dyes: true, cut: null },
  { id: "core:plain_trousers", label: "plain trousers", slot: "bottom", dyes: true, cut: null },
  { id: "core:own_hat", label: "own hat", slot: "hat", dyes: false, cut: null },
];
const state = (revision: number, names: string[] = []): PeopleState => ({
  revision, manifest: null, caps: STORE_CAPS, garments: GARMENTS,
  editions: names.map((name, i) => ({ id: i + 1, garment: "core:plain_tee", colours: [0, 0, 0], print: null, name, retired: false })),
});
const S0 = state(0);

/** A draft that passes: named, coloured, with a text on a square sheet. */
function good(): Draft {
  const d = newDraft("core:plain_tee");
  d.name = "Sunrise tee";
  d.colours = [34, 58, 11];
  d.sheet = newSheet();
  addText(d.sheet, "MIAMI");
  return d;
}
const faults = (d: Draft): string[] => draftFaults(d, S0).map((f) => f.at);

test("a good draft has no faults and the store reads what the page would send", () => {
  const d = good();
  expect(draftFaults(d, S0)).toEqual([]);
  const read = readDraft(publishBody(d, 4, "0123456789abcdef") as unknown as Record<string, unknown>);
  expect(read).toMatchObject({ garment: "core:plain_tee", colours: [34, 58, 11], name: "Sunrise tee", print: { hash: "0123456789abcdef", place: { u: 0.3, scale: 1 } } });
  expect(publishBody({ ...d, sheet: null }, 4, null).print).toBeNull();
});

test("a draft's name, garment and colours are judged as the store judges them", () => {
  expect(faults({ ...good(), name: "  " })).toEqual(["name"]);
  expect(faults({ ...good(), name: "x".repeat(41) })).toEqual(["name"]);
  expect(faults({ ...good(), garment: "core:no_such" })).toEqual(["garment"]);
  expect(faults({ ...good(), colours: [1, 2, 256] })).toEqual(["colours"]);
  expect(faults({ ...good(), garment: "core:own_hat" })).toEqual(["colours"]);
  expect(faults({ ...good(), garment: "core:own_hat", colours: [0, 0, 0] })).toEqual([]);
});

test("a sheet is square or twice as wide, not empty, and its texts are short", () => {
  const d = good();
  d.sheet!.width = 300;
  d.sheet!.height = 200;
  expect(faults(d)).toEqual(["sheet"]);
  d.sheet!.width = 1024;
  d.sheet!.height = 512;
  expect(faults(d)).toEqual(["sheet"]);
  d.sheet!.width = 512;
  d.sheet!.height = 256;
  expect(faults(d)).toEqual([]);
  const empty = good();
  empty.sheet!.layers = [];
  empty.sheet!.fill = null;
  expect(faults(empty)).toEqual(["sheet"]);
  const long = good();
  const t = long.sheet!.layers[0]!;
  if (t.kind === "text") t.text = "y".repeat(49);
  expect(faults(long)).toEqual([`layer:${t.id}`]);
});

test("a sheet takes no more layers than its cap", () => {
  const sheet = newSheet();
  for (let k = 0; k < LAYERS_MAX; k++) expect(addShape(sheet)).not.toBeNull();
  expect([addText(sheet), addShape(sheet), addPicture(sheet, "p", 10, 10)]).toEqual([null, null, null]);
});

test("the place sent always lies inside the sheet, with its scale and turn in range", () => {
  expect(placeOf({ u: 0.7, v: 0.1 + 0.2, w: 0.3000004, h: 0.7, scale: 1, turn: 0 })).toEqual({ u: 0.7, v: 0.3, w: 0.3, h: 0.7, scale: 1, turn: 0 });
  const wild = placeOf({ u: 1.4, v: -2, w: 5, h: Number.NaN, scale: 99, turn: 9 });
  expect(wild.u + wild.w <= 1 && wild.v + wild.h <= 1 && wild.w > 0 && wild.h > 0).toBe(true);
  expect([wild.scale, wild.turn]).toEqual([STORE_CAPS.scaleMax, Math.PI]);
  for (let k = 0; k < 200; k++) {
    const u = k / 199, p = placeOf({ u, v: u, w: 1 - u + 1e-9, h: 0.5, scale: 0.01, turn: -4 });
    const read = readDraft({ revision: 0, garment: "core:plain_tee", colours: [0, 0, 0], name: "t", print: { hash: "0123456789abcdef", place: p } });
    expect(typeof read).not.toBe("string");
  }
});

test("a sheet over the cap is exported again smaller, keeping its shape", () => {
  expect(fitStep(512, 512, PRINT_BYTES_MAX, 1)).toEqual({ kind: "keep" });
  const square = fitStep(512, 512, 2 * PRINT_BYTES_MAX, 1);
  expect(square).toEqual({ kind: "shrink", width: 328, height: 328 });
  const wide = fitStep(512, 256, PRINT_BYTES_MAX + 1, 1);
  expect(wide.kind === "shrink" && wide.width === 2 * wide.height && wide.height % 8 === 0 && wide.height < 256).toBe(true);
  // Just over the cap, it still shrinks by at least eight pixels.
  expect(fitStep(512, 512, PRINT_BYTES_MAX + 1, 1)).toMatchObject({ kind: "shrink", height: 464 });
  expect(fitStep(72, 72, 50 * PRINT_BYTES_MAX, 1).kind).toBe("fail");
  expect(fitStep(512, 512, 2 * PRINT_BYTES_MAX, FIT_TRIES).kind).toBe("fail");
});

test("with bytes going with pixels, the fitting ends under the cap", () => {
  for (const perPixel of [2.6, 3.4, 4.2, 8]) {
    let w = 512, h = 512, tries = 1, fit = fitStep(w, h, w * h * perPixel, tries);
    while (fit.kind === "shrink") {
      [w, h] = [fit.width, fit.height];
      fit = fitStep(w, h, w * h * perPixel, ++tries);
    }
    expect(fit.kind).toBe("keep");
    expect(w * h * perPixel <= PRINT_BYTES_MAX && h >= FIT_LEAST && tries <= 3).toBe(true);
  }
});

test("the admin is told when a print was saved smaller", () => {
  expect(fitNote({ width: 512, height: 512, bytes: 600_000 }, { width: 512, height: 512, bytes: 600_000 })).toBe("");
  expect(fitNote({ width: 512, height: 512, bytes: 800 * 1024 }, { width: 424, height: 424, bytes: 560 * 1024 })).toBe("The print was 800 KB at 512 × 512, over the 640 KB a print may be, so it was saved at 424 × 424 (560 KB).");
});

test("a big picture is held smaller, and a new picture layer fits the sheet", () => {
  expect(heldSize(4000, 3000)).toEqual({ width: 1024, height: 768 });
  expect(heldSize(300, 200)).toEqual({ width: 300, height: 200 });
  const wide = newSheet();
  wide.height = 256;
  const tall = addPicture(wide, "tall", 100, 400)!;
  // Three quarters of the sheet high: 192 of 256 pixels, so 48 across of 512.
  expect(tall.kind === "picture" && Math.round(tall.w * 512)).toBe(48);
});

/** A fake set of routes: each call takes the next answer of its kind, and every call is kept. */
function routes(answers: Partial<Record<"upload" | "publish" | "retire", Answer[]>>): PublishIo & { calls: string[]; waits: number[]; bodies: unknown[] } {
  const calls: string[] = [], waits: number[] = [], bodies: unknown[] = [];
  const next = (kind: "upload" | "publish" | "retire"): Answer => answers[kind]?.shift() ?? { status: 500, answer: { error: "no answer left" } };
  return {
    calls, waits, bodies,
    upload: async (png) => (calls.push(`upload ${png.length}`), next("upload")),
    publish: async (body) => (calls.push("publish"), bodies.push(body), next("publish")),
    retire: async (body) => (calls.push("retire"), bodies.push(body), next("retire")),
    wait: async (ms) => void waits.push(ms),
  };
}
const ok = (answer: Record<string, unknown>): Answer => ({ status: 200, answer });
const PNG = new Uint8Array(100);

test("a publish uploads the print, then publishes it by its hash over the page's revision", async () => {
  const io = routes({ upload: [ok({ hash: "aaaaaaaaaaaaaaaa", known: false })], publish: [ok({ id: 7, ...state(5, ["a"]) })] });
  const steps: string[] = [];
  const o = await publishDraft(io, good(), PNG, 4, (s) => steps.push(s.kind));
  expect(o).toMatchObject({ kind: "published", id: 7, upload: { hash: "aaaaaaaaaaaaaaaa", known: false }, state: { revision: 5 } });
  expect(io.calls).toEqual(["upload 100", "publish"]);
  expect(io.bodies[0]).toMatchObject({ revision: 4, print: { hash: "aaaaaaaaaaaaaaaa" } });
  expect(steps).toEqual(["uploading", "publishing"]);
  expect(outcomeText(o, S0)).toBe("Published edition 7.");
});

test("a draft with no print uploads nothing", async () => {
  const io = routes({ publish: [ok({ id: 1, ...state(1, ["a"]) })] });
  expect((await publishDraft(io, { ...good(), sheet: null }, null, 0)).kind).toBe("published");
  expect(io.calls).toEqual(["publish"]);
});

test("a stale publish answers the newer store and leaves the draft as it was", async () => {
  const d = good(), before = JSON.stringify(d);
  const io = routes({ upload: [ok({ hash: "bbbbbbbbbbbbbbbb" })], publish: [{ status: 409, answer: { error: "stale", ...state(6, ["old", "theirs"]) } }] });
  const o = await publishDraft(io, d, PNG, 5);
  expect(o).toMatchObject({ kind: "stale", state: { revision: 6 } });
  expect(JSON.stringify(d)).toBe(before);
  expect(outcomeText(o, state(5, ["old"]))).toBe(`Not saved: Another admin published edition 2 "theirs" since this page read it. The list shows it now, and your draft is kept: press the button again to go on.`);
});

test("a busy store is tried again after each wait, and gives up after the last", async () => {
  const busy: Answer = { status: 503, answer: { error: "The people store is busy. Try again." } };
  const io = routes({ upload: [ok({ hash: "cccccccccccccccc" })], publish: [busy, busy, ok({ id: 2, ...state(2, ["a", "b"]) })] });
  const steps: string[] = [];
  expect((await publishDraft(io, good(), PNG, 1, (s) => steps.push(s.kind === "busy" ? `busy ${s.attempt}` : s.kind))).kind).toBe("published");
  expect(io.waits).toEqual(BUSY_WAITS.slice(0, 2));
  expect(steps).toEqual(["uploading", "publishing", "busy 1", "busy 2"]);
  const never = routes({ publish: Array.from({ length: 9 }, () => busy) });
  const o = await publishDraft(never, { ...good(), sheet: null }, null, 1);
  expect(o.kind).toBe("busy");
  expect(never.calls.length).toBe(BUSY_WAITS.length + 1);
});

test("a refused upload publishes nothing", async () => {
  const io = routes({ upload: [{ status: 422, answer: { error: "A print is square or twice as wide as high; this one is 3 x 2." } }] });
  const o = await publishDraft(io, good(), PNG, 1);
  expect(o).toMatchObject({ kind: "refused", status: 422 });
  expect(io.calls).toEqual(["upload 100"]);
  expect(outcomeText(o, S0)).toBe("Not saved: The print was not taken: A print is square or twice as wide as high; this one is 3 x 2.");
  expect((await publishDraft(routes({}), good(), null, 1)).kind).toBe("refused");
});

test("a retire goes over the page's revision and a stale one answers the newer store", async () => {
  const io = routes({ retire: [{ status: 409, answer: { error: "stale", ...state(3, ["a", "b"]) } }, ok({ ...state(4, ["a", "b"]) })] });
  expect(await retireEdition(io, 1, true, 2)).toMatchObject({ kind: "stale", state: { revision: 3 } });
  expect(await retireEdition(io, 1, true, 3)).toMatchObject({ kind: "retired", state: { revision: 4 } });
  expect(io.bodies).toEqual([{ revision: 2, id: 1, retired: true }, { revision: 3, id: 1, retired: true }]);
});

test("the wardrobe sent puts the garment in its slot and parses as a stage command", () => {
  const top = wardrobeCommand(GARMENTS[0], 0, [34, 58, 11], DRAFT_PRINT);
  expect(top.slots.map((s) => s?.item ?? null)).toEqual(["core:plain_tee", null, null, null, null]);
  const bottom = wardrobeCommand(GARMENTS[1], 3, [1, 2, 3], null);
  expect(bottom.slots[1]).toEqual({ item: "core:plain_trousers", edition: 3, dye: [1, 2, 3], print: null });
  for (const c of [top, bottom, wardrobeCommand(undefined, 0, [0, 0, 0], null)]) expect(parseStageCommand(stageMessage(c)).command).toEqual(c);
});

test("only what changed is sent, a print before the wardrobe that names it", () => {
  const a: Preview = { look: "man:1", wardrobe: "[]", print: "", pose: "idle", framing: "full", hour: 11 };
  expect(previewChanges(null, a)).toEqual(["look", "wardrobe", "pose", "framing", "hour"]);
  expect(previewChanges(a, a)).toEqual([]);
  const b = { ...a, print: `${DRAFT_PRINT}#2`, wardrobe: "[1]" };
  expect(previewChanges(a, b)).toEqual(["print", "wardrobe"]);
  expect(previewChanges(b, { ...b, print: `${DRAFT_PRINT}#3` })).toEqual(["print"]);
  expect(previewChanges(b, { ...b, look: "woman:1", hour: 18 })).toEqual(["look", "hour"]);
});

test("every person offered is a valid look, and a population gives different people", () => {
  for (const l of LOOKS) expect(validLook(lookOf(l.id, 12345))).toBe(true);
  expect(lookOf("woman", 0)[LOOK_SEX]).toBe(1);
  const city = LOOKS.find((l) => l.id === "core:people_city")!.id;
  expect(Array.from(lookOf(city, 1))).not.toEqual(Array.from(lookOf(city, 2)));
});

test("the cloth palette has white, black, the dyes and natural tones", () => {
  expect(CLOTH_COLOURS.slice(0, 2)).toEqual([10, 11]);
  expect(CLOTH_COLOURS.every((c) => c > 0 && c < 214)).toBe(true);
  expect(new Set(CLOTH_COLOURS).size).toBe(CLOTH_COLOURS.length);
});

test("a layer is found under the pointer by its turned box, and moves in the order", () => {
  const sheet = newSheet();
  const box = addShape(sheet, "box")!;
  box.kind === "shape" && Object.assign(box, { w: 0.5, h: 0.1, turn: Math.PI / 2 });
  // Turned a quarter, the wide flat box stands upright.
  expect(layerAt(sheet, 256, 140)?.id).toBe(box.id);
  expect(layerAt(sheet, 140, 256)).toBeNull();
  const text = addText(sheet)!;
  expect(layerAt(sheet, 256, 256)?.id).toBe(text.id);
  moveLayer(sheet, text.id, -1);
  expect(sheet.layers.map((l) => l.id)).toEqual([text.id, box.id]);
  moveLayer(sheet, text.id, -1);
  expect(sheet.layers.map((l) => l.id)).toEqual([text.id, box.id]);
});

test("a copy of an edition keeps its garment, colours, print size and place", () => {
  const d = draftFrom({ id: 3, garment: "core:plain_tee", colours: [4, 5, 6], name: "x".repeat(40), print: { hash: "dddddddddddddddd", width: 512, height: 256, place: { u: 0.1, v: 0.2, w: 0.3, h: 0.4, scale: 2, turn: 1 } } });
  expect([d.name.length, d.colours, d.sheet && [d.sheet.width, d.sheet.height], d.place.scale]).toEqual([40, [4, 5, 6], [512, 256], 2]);
});

test("the cluster nav lists the wardrobe, which opens at /admin/wardrobe/", () => {
  expect(cluster.map(([slug]) => slug)).toContain("wardrobe");
  const at = resolveAdmin("https://snark.test/admin/wardrobe/", [], (href, base) => new URL(href, base));
  expect([at.view, at.title, at.world]).toEqual(["wardrobe", "Wardrobe", null]);
});
