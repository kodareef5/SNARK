// The review's scenes (review.ts) drawn by the shell's renderer on a real GPU, in headless Chrome as the lit probe draws
// its shots (tools/probe-lit.ts), with the sun's shadows: what a player's card makes of the vessels' pictures, which the
// rasterizer draws no finer than 1024 pixels. Nothing is written outside --out.
//
//   bun assets/source/core/vehicles/marine/gpu.ts --out DIR core:thunderbolt ... [--shots dock,low,helm] [--size 1280x720]

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { litProbe } from "../../../../../tools/probe-lit.ts";
import { Shot } from "../../../../../tools/probe-lit/shot.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { gameOf, play, sends } from "./review.ts";

const args = process.argv.slice(2);
const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const out = value("out");
if (!out) throw new Error("--out DIR");
const [W, H] = (value("size") ?? "1280x720").split("x").map(Number) as [number, number];
const SHOTS = (value("shots") ?? "dock,low,helm").split(",");
const ids = args.filter((a, i) => a.startsWith("core:") && !["out", "size", "shots"].includes(args[i - 1]?.slice(2) ?? ""));
const chrome = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => p && existsSync(p));
if (!chrome) throw new Error("no Chrome: set CHROME");

const { pack, files } = await gameOf(value("source"));
const made: { shot: Shot; file: string }[] = [];
for (const id of ids) {
  const dir = join(out, id.split(":")[1]!);
  mkdirSync(dir, { recursive: true });
  for (const name of SHOTS) {
    let shot: Shot | null = null;
    play(id, name, pack, files, W, H, (p, ground) => {
      shot ??= Object.assign(new Shot(`${id}-${name}`, W, H, ground, files.files[0]!), { manifest: files.manifest, shadows: true });
      if (sends(p)) shot.add(p);
    }, (p) => shot!.add(p, true));
    made.push({ shot: shot!, file: join(dir, `${name}-gpu.png`) });
  }
}
const ok = await litProbe(chrome, [{
  name: "vessels on the GPU",
  shots: () => made.map((m) => m.shot),
  judge: (back) => {
    const lines: string[] = [];
    for (const { shot, file } of made) {
      const px = back.pixels(shot.key, shot.frames.length - 1);
      if (!px) { lines.push(`${shot.key}: nothing came back`); continue; }
      writeFileSync(file, encodePng(W, H, px));
      lines.push(file);
    }
    return { ok: lines.every((l) => !l.includes("nothing")), lines };
  },
}]);
process.exit(ok ? 0 : 1);
