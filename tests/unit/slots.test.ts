// The asset slots of the core content, against the pack the build makes.
import { expect, test } from "bun:test";
import { CORE_CONTENT, CORE_PACK } from "../../content/core.ts";
import type { Slot } from "../../shared/content/classes.ts";
import { shapeHalf, type Def, type ShapeBox } from "../../shared/content/defs.ts";
import { compilePacks } from "../../shared/content/packs.ts";
import { fillSlot, slotAddress, slotsOf } from "../../shared/content/slots.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { corePack } from "../fixtures/pack.ts";

const pack = corePack();
const has = (asset: Slot["asset"], id: string): boolean => (asset === "mesh" ? pack.meshIndex.has(id) : asset === "rig" ? pack.header.rigs.some((r) => r.id === id) : asset === "clip" ? pack.clips.index.has(id) : false);
const uses = slotsOf(CORE_CONTENT);
const at = (address: string) => uses.find((u) => slotAddress(u) === address);

test("every asset the core content must have is in the pack, its own or the one that stands in for it", () => {
  const must = uses.filter((u) => u.need === "must");
  expect(must.length).toBeGreaterThan(120);
  expect(must.filter((u) => fillSlot(u, has).id === "").map(slotAddress)).toEqual([]);
  // The practice dummy has no body of its own. The mannequin stands in, part for part. The pteranodon has no run on the
  // ground (ARK's speed table), and walks at every speed on foot.
  const stood = must.filter((u) => fillSlot(u, has).id !== u.id);
  expect(stood.filter((u) => u.owner !== "core:dummy").map(slotAddress)).toEqual(["core:pteranodon#clip/run"]);
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

test("a static names another mesh of the pack and a shape: drawn as that mesh at the shape's origin, as its boxes until the pack has it", () => {
  // A wreck of the car, its origin on the ground under its middle as the car's own mesh has it.
  const boxes: ShapeBox[] = [{ at: [0, 0.55, 0], half: [0.9, 0.55, 2] }, { at: [0, 1.25, -0.2], half: [0.75, 0.25, 1.1] }];
  const defs = [
    { type: "shape", id: "test:shape_wreck", role: "thing", boxes },
    { type: "structure", class: "static", id: "test:compact_wreck", mesh: "core:compact", shape: "test:shape_wreck", half: shapeHalf(boxes), color: 9, hp: 5000, material: "core:mat_metal" },
  ] as Def[];
  const made = compilePacks([CORE_PACK, { name: "test", defs: defs as never }]);
  expect(made.errors).toEqual([]);
  const reg = made.registry!;
  const kind = reg.index.get("test:compact_wreck")!;
  expect(reg.parts.start[kind + 1]! - reg.parts.start[kind]!).toBe(2);

  const standIn = grayboxMeshes(defs).find((m) => m.id === "test:compact_wreck")!;
  const heights = standIn.lods[0]!.positions.filter((_, i) => i % 3 === 1);
  expect([Math.min(...heights), Math.max(...heights)].map((y) => Math.round(y * 1000) / 1000 + 0)).toEqual([0, 1.5]);
  const slot = slotsOf(defs).find((u) => slotAddress(u) === "test:compact_wreck#mesh")!;
  expect(slot.id).toBe("core:compact");
  expect(fillSlot(slot, (_, id) => id === "test:compact_wreck")).toEqual({ id: "test:compact_wreck", word: "" });
  expect(fillSlot(slot, (_, id) => id === "test:compact_wreck" || id === "core:compact")).toEqual({ id: "core:compact", word: "" });
});
