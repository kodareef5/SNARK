// Builds pteranodon.snpk, the block-out flyer of asset.ts, from the scripts in the pteranodon's own asset folder: a
// source tree of one asset under .cache is made for `bun run art`, and its pack is copied here. Its review sheet is in
// artifacts/art/core/pteranodon. Needs Blender.
//
//   bun tests/fixtures/flyer/build.ts

import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { main } from "../../../tools/art.ts";

const here = import.meta.dir;
const scripts = resolve(here, "../../../assets/source/core/creatures/pteranodon");
const tree = resolve(here, "../../../.cache/flyer-build");
const dir = join(tree, "core/creatures/pteranodon");
rmSync(tree, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "asset.ts"), `export { default } from ${JSON.stringify(join(here, "asset.ts"))};\n`);
for (const script of ["rig.py", "clips_move.py", "clips_act.py", "clips_life.py"]) symlinkSync(join(scripts, script), join(dir, script));
// Conversion writes no pack it refuses. What the check after it finds of the block-out's own surface is the art's to
// mend (on 2026-11-15, one part inside out at every level) and is printed, not held against the fixture.
await main(["core:pteranodon", "--source", tree]);
const built = existsSync(join(dir, "pteranodon.snpk"));
if (built) copyFileSync(join(dir, "pteranodon.snpk"), join(here, "pteranodon.snpk"));
rmSync(tree, { recursive: true, force: true });
process.exit(built ? 0 : 1);
