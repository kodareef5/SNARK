// Builds the block-out pteranodon with clips_life.py's clips (look_asset.ts) in a tree of its own under .cache, never
// under assets/source where the game would take it for the animal, and draws its review sheet with the game's own
// renderer: every clip on the sheet's clip pages, the check's facts in sheet.json. Needs Blender.
//
//   bun assets/source/core/creatures/pteranodon/ref/clips_life/look.ts [OUT_DIR]

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { main } from "../../../../../../../tools/art.ts";

const here = import.meta.dir;
const folder = resolve(here, "../..");
const tree = resolve(here, "../../../../../../../.cache/life-look");
const dir = join(tree, "core/creatures/pteranodon");
rmSync(tree, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "asset.ts"), `export { default } from ${JSON.stringify(join(here, "look_asset.ts"))};\n`);
for (const script of ["rig.py", "clips_move.py", "clips_life.py"]) symlinkSync(join(folder, script), join(dir, script));
await main(["core:pteranodon", "--source", tree, "--out", resolve(process.argv[2] ?? "artifacts/art")]);
