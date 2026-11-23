import { expect, test } from "bun:test";
import { AIR_CARRIER_ART, AIR_TRAILER_ART, SURVEY_DRONE_ART } from "../../content/vehicles/air-freight-art.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { checkAsset } from "../../tools/art/check.ts";

const assets = await findAssets();

for (const art of [AIR_TRAILER_ART, AIR_CARRIER_ART, SURVEY_DRONE_ART]) {
  test(`${art.id} keeps its contract's bones, anchors and envelope, and passes its check`, async () => {
    const asset = assets.find((a) => a.id === art.id)!;
    expect(asset).toBeDefined();
    const pack = parsePack(await Bun.file(asset.file).bytes());
    const mesh = pack.header.meshes.find((m) => m.id === art.id)!;
    const rig = pack.header.rigs[mesh.rig!]!;
    expect(rig.names).toEqual([...art.bones]);
    for (let k = 0; k < 3; k++) {
      expect(mesh.center[k]! - mesh.half[k]!).toBeGreaterThanOrEqual(art.envelope.min[k]! - 0.01);
      expect(mesh.center[k]! + mesh.half[k]!).toBeLessThanOrEqual(art.envelope.max[k]! + 0.01);
    }
    expect(mesh.center[1]! - mesh.half[1]!).toBeCloseTo(0, 2);
    expect(mesh.flat).toBeGreaterThan(0);
    expect(mesh.lods.length).toBeGreaterThan(mesh.flat!);
    expect(checkAsset(asset, pack, true).faults).toEqual([]);
  });
}

test("the carrier's jaws hang where the trailer's castings are when it carries the rack", () => {
  const { load } = AIR_CARRIER_ART;
  for (const name of ["jaw_front_left", "jaw_front_right", "jaw_rear_left", "jaw_rear_right"] as const) {
    const jaw = AIR_CARRIER_ART.anchors[name], casting = AIR_TRAILER_ART.anchors[name];
    for (let k = 0; k < 3; k++) expect(casting[k]! + load[k]!).toBeCloseTo(jaw[k]!, 6);
  }
});
