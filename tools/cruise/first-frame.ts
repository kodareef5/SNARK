// The cruise port loads both ships: measure their combined first-frame cost.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { FIRST_FRAME_BUDGET, firstFrame } from "../sizes.ts";
import { cruiseCourse } from "./course.ts";

export function auditCruiseFirstFrame(names: readonly string[], dist = resolve(import.meta.dir, "../../client/dist")) {
  if (new Set(names).size !== names.length) throw new Error("First-frame census received duplicate landmark names");
  const core = firstFrame(dist).first;
  const landmarks = names.map(name => {
    const dir = join(dist, "assets/landmarks"), manifest = parseManifest(readFileSync(join(dir, `${name}.json`), "utf8"));
    const manifestBytes = statSync(join(dir, `${name}.json.br`)).size;
    const bootBytes = statSync(join(dir, `${manifest.files[manifest.boot]!.name}.br`)).size;
    return { name, manifestBytes, bootBytes, bytes: manifestBytes + bootBytes };
  });
  const bytes = core + landmarks.reduce((sum, landmark) => sum + landmark.bytes, 0);
  return { scope: "Actual built Brotli files required before the cruise map's first frame: the ordinary core census plus every declared landmark's manifest and boot file together. Streamed pages, mesh levels and textures remain outside this startup measure.",
    coreBytes: core, landmarks, bytes, budgetBytes: FIRST_FRAME_BUDGET, pass: bytes <= FIRST_FRAME_BUDGET };
}

if (import.meta.main) {
  const report = auditCruiseFirstFrame(cruiseCourse().content!.landmarks.map((l) => l.name));
  const out = resolve(process.argv[2] ?? "var/cruise-preview/first-frame.json");
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ out, ...report }));
  if (!report.pass) process.exitCode = 1;
}
