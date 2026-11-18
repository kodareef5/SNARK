// Fresh processes keep two reproducibility builds from retaining two cities in memory.
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workFolder } from "../maps/work.ts";

const name = process.argv[2]; if (!name || !/^[a-z0-9-]+$/.test(name)) throw new Error("A map name is required");
const source = workFolder(name);
const world = JSON.parse(readFileSync(join(source, "world/world.json"), "utf8"));
const folder = join(source, "reports", world.ruins?.report ?? "ruins"); mkdirSync(folder, { recursive: true });
const runs: Record<string, unknown>[] = [];
for (let run = 1; run <= 2; run++) {
  const log = openSync(join(folder, `build-${run}.log`), "w");
  const result = Bun.spawnSync(["bun", join(import.meta.dir, "build.ts"), name], { stdout: log, stderr: log }); closeSync(log);
  if (result.exitCode !== 0) throw new Error(`Build ${run} failed; see build-${run}.log`);
  const hash = createHash("sha256");
  for await (const bytes of Bun.file(join("var/maps", `${name}.snmap`)).stream()) hash.update(bytes);
  const stats = JSON.parse(readFileSync(join("var/maps", name, "stats.json"), "utf8"));
  const row = { run, sha256: hash.digest("hex"), bytes: stats.bytes, buildSeconds: stats.buildSeconds, totalSeconds: stats.totalSeconds, peakResidentMiB: stats.peakResidentMiB };
  runs.push(row); console.log(JSON.stringify(row));
  writeFileSync(join(folder, "determinism.json"), JSON.stringify({ equal: runs.length === 2 && runs[0]!.sha256 === runs[1]!.sha256, runs }, null, 2) + "\n");
  writeFileSync(join(folder, "build.json"), JSON.stringify(stats, null, 2) + "\n");
}
if (runs[0]!.sha256 !== runs[1]!.sha256) throw new Error("Repeated builds differ");
