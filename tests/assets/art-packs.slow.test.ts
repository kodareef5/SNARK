// Every asset folder's pack through the art check. It grows with the art, a minute and more by itself, so it is in the
// slow tier: a merge to main runs it, and a maker runs `bun run art -- <id> --check` on the asset in hand.
import { expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { FRONT, SHEETS } from "../../content/vehicles/windscreens.ts";
import { GLASS } from "../../content/vehicles/glass.ts";
import { glassAt, glassSet } from "../../client/core/render/vehicle-glass.ts";
import { PAINT, streetMaterial } from "../../content/street-finishes.ts";
import { isSkateboard, isWheelVehicle } from "../../shared/sim/vehicle.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets, isNode, type Asset } from "../../tools/art/assets.ts";
import { checkAsset } from "../../tools/art/check.ts";
import { ASSETS } from "../fixtures/assets.ts";
import { artTest } from "../fixtures/needs-art.ts";

/** The examples of scripted assets, which are in no game pack. */
const EXAMPLES = await findAssets(join(import.meta.dir, "../../tools/blender/example"));

/**
 * A node pack (trees, rocks, plants) is many meshes of crowns and cards, whose errors are stated rather than measured on
 * their points, and that measure takes seconds on such a pack. Its maker sees it in `bun run art -- <id> --check`. Here a
 * node pack is checked without it, and its stated errors are held to rise level by level while its triangles fall.
 */
function unmeasured(asset: Asset): Asset {
  if (!isNode(asset) || asset.spec.kind !== "pieces") return asset;
  return { ...asset, spec: { ...asset.spec, pieces: asset.spec.pieces.map(({ errors: _, ...p }) => p) } };
}

artTest("every asset folder has its pack, named as the folder is, and the pack passes its check; so do the examples", () => {
  expect(ASSETS.length).toBeGreaterThan(0);
  expect(EXAMPLES.map((a) => [a.id, a.spec.kind])).toEqual([["demo:pup", "creature"], ["demo:mallet", "pieces"], ["demo:crate", "pieces"]]);
  for (const asset of [...ASSETS, ...EXAMPLES]) {
    expect([asset.id, basename(asset.file), basename(dirname(asset.file)), existsSync(asset.file)]).toEqual([asset.id, `${asset.name}.snpk`, asset.name, true]);
    expect([asset.id, checkAsset(unmeasured(asset), parsePack(new Uint8Array(readFileSync(asset.file)))).faults]).toEqual([asset.id, []]);
  }
});

artTest("each road vehicle's exported paint, wheel joints and glass opening fit its declared finish", () => {
  for (const vehicle of coreRegistry().vehicle) {
    if (!vehicle || !isWheelVehicle(vehicle) || isSkateboard(vehicle)) continue;
    const asset = ASSETS.find(a => a.id === vehicle.id);
    expect(asset, vehicle.id).toBeDefined();
    const pack = parsePack(new Uint8Array(readFileSync(asset!.file)));
    expect(pack.header.materials?.some(m => streetMaterial(m.id) === PAINT), vehicle.id).toBe(true);
    const rig = pack.header.rigs?.find(r => r.id === vehicle.id);
    const wheels = rig?.names?.filter(bone => bone.startsWith("wheel_"));
    expect(wheels?.length, vehicle.id).toBe((vehicle.spec.axles?.length ?? 2)*2);
    const mesh = unpackMeshes(pack).find(m => m.id === vehicle.id)!;
    const windscreen = vehicle.breakablePanels?.find(panel => panel.bone === "glass_front");
    if (windscreen) {
      const bone = rig!.names!.indexOf(windscreen.bone);
      expect(bone, vehicle.id).toBeGreaterThan(0);
      expect(mesh.lods[0]!.bones?.includes(bone), vehicle.id).toBe(true);
      expect(SHEETS[vehicle.id]?.[0]?.panel, vehicle.id).toBe(vehicle.breakablePanels!.indexOf(windscreen));
      continue;
    }
    const pane = FRONT[vehicle.id];
    expect(pane, vehicle.id).toBeDefined();
    const pos = mesh.lods[0]!.positions;
    for (const [y,z,w] of pane!) for (const x of [-w,w]) {
      let nearest = Infinity;
      for (let i=0; i<pos.length; i+=3) nearest = Math.min(nearest, (x-pos[i]!)**2 + (y-pos[i+1]!)**2 + (z-pos[i+2]!)**2);
      // The sheet stops inside its seal. All four corners sit within a decimetre of the painted frame.
      expect(Math.sqrt(nearest), vehicle.id).toBeLessThan(0.10);
    }
  }
});

artTest("each vehicle's glass cells name materials the packs hold, and hold faces of their meshes' finest levels", () => {
  const faces = new Map<string, number>();
  for (const asset of ASSETS.filter((a) => a.file.includes("/vehicles/"))) {
    for (const mesh of unpackMeshes(parsePack(new Uint8Array(readFileSync(asset.file))))) {
      const lod = mesh.lods[0]!;
      const { uvs, sections, normals, indices } = lod;
      if (!mesh.materials || !uvs || !sections || !normals) continue;
      mesh.materials.forEach((material, k) => {
        const set = glassSet(material.id);
        if (!set) return;
        let n = faces.get(material.id) ?? 0;
        for (let t = 0; t < indices.length / 3; t++) {
          if (sections[t] !== k) continue;
          let u = 0, v = 0, forward = 0;
          for (let c = 0; c < 3; c++) {
            const i = indices[t * 3 + c]!;
            u += uvs[i * 2]! / 3;
            v += uvs[i * 2 + 1]! / 3;
            forward += normals[i * 3 + 2]! / 3;
          }
          if (glassAt(set, u, v, forward)) n++;
        }
        faces.set(material.id, n);
      });
    }
  }
  // When written: the vans' 160 and 370, the fastback's 586, the jeep's 92 and the abandoned compacts' 79.
  for (const id of GLASS.flatMap((g) => g.materials)) expect([id, (faces.get(id) ?? 0) >= 10]).toEqual([id, true]);
});
