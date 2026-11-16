import { expect, test } from "bun:test";
import { validateSailVisualRig } from "../../shared/sim/sail-rig.ts";

const valid = () => ({ sails: [{ id: "test", mesh: "test:cloth", skeleton: "cloth", anchor: [0, 2, 0],
  basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], bones: ["root", "lower", "upper", "gaff"],
  bands: [{ bone: "lower", index: 1, lower: 0, upper: 1 }, { bone: "upper", index: 2, lower: 1, upper: 2 }],
  bandAxis: "y", foldSign: 1, stackStep: .006,
  gaff: { bone: "gaff", throat: [0, 1, 0], peak: [0, 2, 1], lowerThroatY: .12, lowerAngle: Math.PI / 4 },
  bounds: { center: [0, 3, 0], radius: 3 }, boneBounds: Array.from({ length: 4 }, () => [-1, 0, 0, 1, 2, 1]),
}] });

test("sail metadata rejects reflections, mismatched packed bone order and unsafe motion bounds", () => {
  expect(validateSailVisualRig(valid())).toEqual([]);
  const reflected = valid(); reflected.sails[0]!.basis[0]![0] = -1;
  expect(validateSailVisualRig(reflected).join(" ")).toContain("right-handed");
  const bones = valid(); bones.sails[0]!.bones = ["root", "upper", "lower", "gaff"];
  expect(validateSailVisualRig(bones).join(" ")).toContain("matching bone indices");
  const bounds = valid(); bounds.sails[0]!.bounds.radius = Infinity;
  expect(validateSailVisualRig(bounds).join(" ")).toContain("moving bounds");
  const inverted = valid(); inverted.sails[0]!.boneBounds[1]![0] = 2;
  expect(validateSailVisualRig(inverted).join(" ")).toContain("per-bone rest bounds");
});

test("sail metadata enforces the native 127-bone ceiling and a gaff with a separate pose", () => {
  const crowded = valid(); crowded.sails[0]!.bones = ["root", ...Array.from({ length: 127 }, (_, n) => `bone_${n}`)];
  expect(validateSailVisualRig(crowded).join(" ")).toContain("126 following bones");
  const reused = valid(); reused.sails[0]!.gaff.bone = "upper";
  expect(validateSailVisualRig(reused).join(" ")).toContain("independent bone");
  const wrongAngle = valid(); wrongAngle.sails[0]!.gaff.lowerAngle = .1;
  expect(validateSailVisualRig(wrongAngle).join(" ")).toContain("rise aft");
  const broken = valid(); broken.sails[0]!.bands[1]!.lower = 1.2;
  expect(validateSailVisualRig(broken).join(" ")).toContain("contiguous");
});
