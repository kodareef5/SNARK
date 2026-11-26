// What an admin sees is what the world shows: a print on the person stage (client/core/studio/person.ts), as a draft
// or a published edition reopened, goes the game's way, through Scene.editionPrint and Prints.byteOf, so the tee's
// instance bytes, its print's place in the table and its printed draw match a second player's in the game. Far off, a
// tee's flat levels show the print's swatch.

import { expect } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_PRINTED, DRAW_SKINNED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { PRINT_FLOATS } from "../../client/core/render/print-term.ts";
import { DRAFT_EDITION, PersonStage } from "../../client/core/studio/person.ts";
import { placeFor } from "../../client/core/admin/wardrobe.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import type { EditionPrint } from "../../shared/people/doc.ts";
import { cutMesh } from "../../shared/people/cuts.ts";
import { parseStageCommand, STAGE_TO, type StageCommand } from "../../shared/people/stage.ts";
import { GEAR_COUNT, WORN_LENGTH } from "../../shared/sim/entities.ts";
import { asTextured } from "../../tools/bench/base.ts";
import { provingView, type ProvingView } from "../../tools/snap.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { testPrint, testPrintHost } from "../fixtures/prints.ts";
import { test } from "../fixtures/needs-art.ts";

const BODY = 2000;
const PLACE = placeFor("tee");
let game: { reg: Registry; pack: Uint8Array } | null = null;
const gameOf = (): { reg: Registry; pack: Uint8Array } => (game ??= { reg: compileContent(CORE_CONTENT).registry!, pack: corePackBytes() });
const command = (data: object): StageCommand => parseStageCommand({ to: STAGE_TO, ...data }).command!;
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

/** One survivor `metres` ahead on medium in a plain tee, its wardrobe the remote's own: edition `edition`. */
function oneBody(metres: number, edition: number): ProvingView {
  const view = provingView(320, 180, undefined, undefined, undefined, gameOf());
  const { scene, cam, remote, hf, reg } = view;
  scene.assets.tier = tierOf("medium");
  scene.viewHeight = 1080;
  asTextured(scene);
  [cam.yaw, cam.pitch, cam.fovY, cam.aspect] = [Math.PI, -0.1, (70 * Math.PI) / 180, 16 / 9];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.62;
  remote.count = 1;
  [remote.id[0], remote.kind[0], remote.flags[0], remote.anim[0], remote.hasLook[0], remote.yaw[0]] = [BODY, reg.index.get("core:survivor")!, 1, 0, 1, 0];
  [remote.x[0], remote.z[0]] = [cam.x, cam.z - metres];
  remote.y[0] = hf.heightAt(remote.x[0]!, remote.z[0]!);
  remote.look.set(defaultLook(), 0);
  remote.gear.fill(0, 0, GEAR_COUNT);
  remote.wardrobe.fill(0, 0, WORN_LENGTH);
  remote.wardrobe.set([reg.index.get("core:tee")!, edition, 0], 0);
  remote.hasWardrobe[0] = 1;
  scene.prints.host = testPrintHost();
  return view;
}

/** The same body dressed by the person stage, as the Wardrobe page sends it. */
function onStage(metres: number, edition: number, key: string): { view: ProvingView; stage: PersonStage } {
  const view = oneBody(metres, 0), stage = new PersonStage(view.reg);
  view.remote.hasWardrobe[0] = 0;
  stage.apply(command({ kind: "print", key, url: "/x.png" }));
  stage.sized(key, 256, 256);
  stage.apply(command({ kind: "wardrobe", slots: [{ item: "core:tee", edition, dye: [0, 0, 0], print: { key, place: PLACE } }, null, null, null, null], hide: 0 }));
  view.scene.characters.wardrobe = (id, out) => id === BODY && stage.wornInto(out);
  view.scene.editionPrint = (e) => stage.printOf(e);
  return { view, stage };
}

/** Each frame's tee draws: their flags, their instances' region bytes, and the print table's first row. */
async function teeOf(view: ProvingView): Promise<{ flags: number; regions: number[]; row: number[]; flat: boolean }> {
  let p: FramePacket = view.scene.build(view.cam, view.remote);
  for (let f = 0; f < 12; f++) {
    await settle();
    p = view.scene.build(view.cam, view.remote);
  }
  const ids = view.scene.assets.manifest.meshes.map((m) => m.id), tee = cutMesh("core:human_m", "tee");
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== TRANSIENT_BUFFER || (p.drawFlags[d]! & DRAW_SKINNED) === 0 || ids[p.drawMesh[d]!] !== tee) continue;
    const at = p.drawFirst[d]! * INSTANCE_BYTES + 14, mesh = p.drawMesh[d]!;
    return { flags: p.drawFlags[d]!, regions: [...p.transient.subarray(at, at + 6)], row: [...p.printTable.subarray(0, PRINT_FLOATS)], flat: p.drawLod[d]! >= view.scene.assets.table.flat[mesh]! };
  }
  throw new Error("no tee drawn");
}

test("a draft's print on the stage is the edition's on a player in the game", async () => {
  const print: EditionPrint = testPrint(0, PLACE);
  const world = oneBody(2.5, 5);
  world.scene.editionPrint = (e) => (e === 5 ? print : null);
  const inGame = await teeOf(world);
  const draft = await teeOf(onStage(2.5, 0, "wardrobe-draft").view);
  const reopened = await teeOf(onStage(2.5, 5, "print.00000000ab000000").view);
  expect(inGame.flat).toBe(false);
  expect(inGame.flags & DRAW_PRINTED).toBe(DRAW_PRINTED);
  expect(inGame.regions[2]).toBe(1);
  for (const shown of [draft, reopened]) {
    expect(shown.flags).toBe(inGame.flags);
    expect(shown.regions).toEqual(inGame.regions);
    expect(shown.row).toEqual(inGame.row);
  }
});

test("a stage draft names its stand-in edition, never 0, so its print is drawn", () => {
  const { stage } = onStage(2.5, 0, "wardrobe-draft");
  const out = new Uint32Array(WORN_LENGTH);
  stage.wornInto(out);
  expect(out[1]).toBe(DRAFT_EDITION);
  expect(stage.printOf(DRAFT_EDITION)?.place).toEqual(PLACE);
});

test("far off, a printed tee shows its swatch and a plain one its cloth", async () => {
  const print = testPrint(0, PLACE);
  const printed = oneBody(60, 5);
  printed.scene.editionPrint = (e) => (e === 5 ? print : null);
  const far = await teeOf(printed);
  expect(far.flat).toBe(true);
  expect(far.flags & DRAW_PRINTED).toBe(0);
  expect(far.regions[2]).toBe(printed.scene.prints.swatch(0));
  expect(far.regions[2]).toBeGreaterThan(0);
  const plain = await teeOf(oneBody(60, 0));
  expect(plain.regions[2]).toBe(plain.regions[1]);
});
