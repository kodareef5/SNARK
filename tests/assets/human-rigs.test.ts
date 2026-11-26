// The two body rigs are frozen beside the human-bodies asset (rigs.ts). The cook writes them and refuses a body that
// does not fit them, and the server and the client read them from the boot file as they are.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHost } from "../../server/host.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { SEX_IDS } from "../../shared/anim/look.ts";
import { parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { FIT_REACH, fittedRest } from "../../tools/art/human.ts";
import { artModule } from "../../tools/art/source.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { provingView } from "../../tools/snap.ts";
import { flatMap } from "../fixtures/map.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const RIGS = (await artModule("core/humans/human-bodies/rigs.ts")).RIGS as readonly (readonly number[])[];
const rigNamed = (rigs: readonly PackRig[], sex: number): PackRig | undefined => rigs.find((r) => r.id === `human_${SEX_IDS[sex]}`);

test("a frozen rig is 30 joints for each sex, each near the skeleton's", () => {
  expect(RIGS.length).toBe(SEX_IDS.length);
  for (const rest of RIGS) {
    expect(rest.length).toBe(HUMAN_BONES * 3);
    for (let i = 0; i < rest.length; i++) expect(Math.abs(rest[i]! - HUMAN.rest[i]!)).toBeLessThan(0.1);
  }
});

test("the cook takes a body within 3 mm of its rig and writes the rig, never its own joints", () => {
  const own: PackRig = { id: "human_m", skeleton: HUMAN.id, rest: [...RIGS[0]!] };
  own.rest[5 * 3 + 2]! += FIT_REACH * 0.95;
  expect(fittedRest(own, RIGS[0]!)).toEqual([...RIGS[0]!]);
});

test("the cook refuses a body with a joint more than 3 mm from its rig, naming it", () => {
  const own: PackRig = { id: "human_f", skeleton: HUMAN.id, rest: [...RIGS[1]!] };
  own.rest[9 * 3]! += FIT_REACH * 1.05;
  expect(() => fittedRest(own, RIGS[1]!)).toThrow(/human_f: joints sit more than 3 mm .*hand\.L 3\.1 mm/);
});

artTest("the installed human-bodies pack carries the frozen rigs bit for bit", () => {
  const pack = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk", import.meta.url))));
  RIGS.forEach((rest, sex) => expect(rigNamed(pack.header.rigs, sex)?.rest).toEqual([...rest]));
});

artTest("the server seats bodies and the client draws them on the frozen rigs", () => {
  const split = splitPack(corePackBytes(), "core");
  // The server and the client both read the rigs from the boot file's header (server/main.ts).
  const boot = parsePack(split.files[0]!.bytes);
  RIGS.forEach((rest, sex) => expect(rigNamed(boot.header.rigs, sex)?.rest).toEqual([...rest]));

  const host = createHost(coreRegistry(), { map: writeMap(flatMap(2)), seed: 1, clips: NO_CLIPS, rigs: boot.header.rigs });
  try {
    const rests = (host.urban as unknown as { rests: Map<string, Float32Array> }).rests;
    expect([...rests.get("human_m")!]).toEqual([...Float32Array.from(RIGS[0]!)]);
  } finally { host.shutdown(); }

  const view = provingView(16, 16, {}, { files: split.files.map((f) => f.bytes), manifest: split.manifest });
  const survivor = view.reg.index.get("core:survivor")!;
  const kinds = (view.scene.characters as unknown as { kinds: ({ sets: { rest: Float32Array }[] } | null)[] }).kinds;
  const sets = kinds[survivor]!.sets;
  expect(sets.length).toBe(SEX_IDS.length);
  RIGS.forEach((rest, sex) => expect([...sets[sex]!.rest]).toEqual([...Float32Array.from(rest)]));
});
