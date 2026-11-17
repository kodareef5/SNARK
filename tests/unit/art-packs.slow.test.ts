// Every asset folder's pack through the art check. It grows with the art, a minute and more by itself, so it is in the
// slow tier: a merge to main runs it, and a maker runs `bun run art -- <id> --check` on the asset in hand.
import { expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
