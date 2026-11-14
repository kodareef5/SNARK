// The asset slots of the core content, against the pack the build makes.
import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Slot } from "../../shared/content/classes.ts";
import type { Def } from "../../shared/content/defs.ts";
import { fillSlot, slotAddress, slotsOf } from "../../shared/content/slots.ts";
import { corePack } from "../fixtures/pack.ts";

const pack = corePack();
const has = (asset: Slot["asset"], id: string): boolean => (asset === "mesh" ? pack.meshIndex.has(id) : asset === "rig" ? pack.header.rigs.some((r) => r.id === id) : asset === "clip" ? pack.clips.index.has(id) : false);
const uses = slotsOf(CORE_CONTENT);
const at = (address: string) => uses.find((u) => slotAddress(u) === address);

test("every asset the core content must have is in the pack, its own or the one that stands in for it", () => {
  const must = uses.filter((u) => u.need === "must");
  expect(must.length).toBeGreaterThan(120);
  expect(must.filter((u) => fillSlot(u, has).id === "").map(slotAddress)).toEqual([]);
  // The practice dummy has no body of its own. The mannequin stands in, part for part.
  const stood = must.filter((u) => fillSlot(u, has).id !== u.id);
  expect(stood.every((u) => u.owner === "core:dummy")).toBe(true);
  expect(fillSlot(at("core:dummy#body/f/torso")!, has)).toEqual({ id: "core:mannequin/torso", word: "" });
  expect(new Set(uses.map(slotAddress)).size).toBe(uses.length);
});

test("a slot is addressed by its owner, and found by the naming the art uses", () => {
  expect(at("core:raptor#clip/walk")!.id).toBe("core:raptor/walk");
  expect(at("core:raptor#rig")!.id).toBe("core:raptor");
  expect(at("core:survivor#body/m/head")!.id).toBe("core:human_m/head");
  expect(at("core:survivor#hair/f/long")!.id).toBe("core:human_f/hair/long");
  expect(at("core:hide_hat#worn/human_m")!.id).toBe("core:human_m/armor/hide/head");
  expect(at("core:spear#held")!.id).toBe("core:spear");
  // A generated mesh is named after its definition.
  expect(at("core:wall_wood#mesh")!.id).toBe("core:wall_wood");
  expect(at("core:tree#mesh")!.id).toBe("core:tree");
  // A creature with no skeleton has a body and neither rig nor clips.
  expect(uses.filter((u) => u.owner === "core:grazer").map((u) => u.slot)).toEqual(["body", "icon"]);
  // Nothing has an icon yet, so each falls back to a swatch of its colour.
  expect(fillSlot(at("core:stone#icon")!, has)).toEqual({ id: "", word: "swatch" });
  expect(fillSlot(at("core:arrow_stone#shot")!, has).id).toBe("core:arrow");
  expect(fillSlot(at("core:round_rifle#shot")!, has).id).toBe("core:tracer");
});

test("content with no art of its own still draws: each must slot says what stands in", () => {
  const ghost = { ...CORE_CONTENT.find((d) => d.id === "core:raptor")!, id: "mod:ghost", mesh: "mod:ghost" } as Def;
  const filled = Object.fromEntries(slotsOf([ghost]).filter((u) => u.need === "must").map((u) => [slotAddress(u), fillSlot(u, has)]));
  expect(filled["mod:ghost#body"]).toEqual({ id: "", word: "box" });
  expect(filled["mod:ghost#rig"]).toEqual({ id: "", word: "rigid" });
  expect(filled["mod:ghost#clip/run"]).toEqual({ id: "", word: "rest" });
});
