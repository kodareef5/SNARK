// How long a world's event loop stalls while it takes a large clip on its Screens page. It makes a ~90 MB MP4 laid out
// with moov last (so faststart has work to do), starts a cluster world in this process, and has curl upload the clip
// three times while a 1 ms timer notes each gap. The gate: no gap from an upload much over the world's own when idle.
//
//   bun tools/screens/upload-gaps.ts [--mb 90] [--times 3]

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../../server/main.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { splitPack } from "../pack/split.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";

const arg = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const MB = arg("mb", 90), TIMES = arg("times", 3), KBPS = 1450;
const root = join(import.meta.dir, "../.."), work = join(root, ".cache", "upload-gaps");
const clip = join(work, `clip-${MB}mb.mp4`);

/** A test pattern with noise, so the encoder spends its whole rate, at 640×360 under the caps; moov at the end. */
function makeClip(): void {
  if (existsSync(clip)) return;
  mkdirSync(work, { recursive: true });
  const seconds = Math.ceil((MB * 1048576 * 8) / (KBPS * 1000));
  const run = Bun.spawnSync([
    "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=s=640x360:r=24,noise=alls=30:allf=t`, "-t", String(seconds),
    "-c:v", "libx264", "-preset", "ultrafast", "-b:v", `${KBPS - 50}k`, "-minrate", `${KBPS - 50}k`, "-maxrate", `${KBPS - 50}k`, "-bufsize", `${KBPS}k`,
    "-x264-params", "nal-hrd=cbr", "-pix_fmt", "yuv420p", clip,
  ]);
  if (run.exitCode !== 0) throw new Error(`ffmpeg failed: ${run.stderr.toString()}`);
}

/** Gaps between 1 ms timer turns over `ms`, or until `until` settles: the largest and how many passed 10 ms. */
async function gaps<T>(until: Promise<T> | number): Promise<{ max: number; over10: number; value: T | null; at: string }> {
  const t0 = performance.now(), long: string[] = [];
  let last = t0, max = 0, over10 = 0;
  const timer = setInterval(() => {
    const now = performance.now(), gap = now - last;
    last = now;
    max = Math.max(max, gap);
    if (gap > 10) (over10++, long.push(`${gap.toFixed(0)} ms at ${(now - t0).toFixed(0)}`));
  }, 1);
  const value = typeof until === "number" ? (await Bun.sleep(until), null) : await until;
  clearInterval(timer);
  return { max, over10, value, at: long.join(", ") };
}

makeClip();
const saves = join(work, "cluster"), dir = join(saves, "client");
rmSync(saves, { recursive: true, force: true });
mkdirSync(join(dir, "assets"), { recursive: true });
const { files, manifest } = splitPack(corePackBytes(), "core");
for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dir, "assets", manifest.files[f]!.name), file.bytes);
writeFileSync(join(dir, "assets/manifest.json"), JSON.stringify(manifest));
const log = console.log;
console.log = () => {};
const config = loadConfig({}, ["-clusterid=gaps", `-ClusterDirOverride=${saves}`]).rules;
const world = startServer({ port: 0, clientDir: dir, dev: true, dbPath: join(saves, "world.db"), noBackups: true, config });
console.log = log;
const at = `http://127.0.0.1:${world.port}/admin/screens`;
for (let k = 0; k < 200 && (await fetch(`${at}/state`)).status === 503; k++) await Bun.sleep(50);
await Bun.sleep(1000);

const idle = await gaps(3000);
console.log(`clip ${clip}: ${(statSync(clip).size / 1048576).toFixed(1)} MB`);
console.log(`idle 3 s: largest gap ${idle.max.toFixed(1)} ms, ${idle.over10} over 10 ms`);
for (let i = 0; i < TIMES; i++) {
  const curl = Bun.spawn(["curl", "-s", "-X", "POST", "--data-binary", `@${clip}`, "-H", "content-type: video/mp4", "-w", " %{http_code}", `${at}/upload?name=gap-${i}`], { stdout: "pipe" });
  const t0 = performance.now();
  const got = await gaps((async () => (await curl.exited, await new Response(curl.stdout).text()))());
  console.log(`upload ${i + 1}: ${((performance.now() - t0) / 1000).toFixed(2)} s, largest gap ${got.max.toFixed(1)} ms, ${got.over10} over 10 ms (${got.at}), answer ${got.value?.slice(-30)}`);
}
world.stop();
rmSync(saves, { recursive: true, force: true });
process.exit(0);
