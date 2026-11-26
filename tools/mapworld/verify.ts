import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { reportPaths } from "./report-path.ts";

const paths = reportPaths();
const results = [];
for (const [tool, args] of [["chunk-report", []], ["audit", []], ["ruin-walk", ["--all"]], ["room-walk", []], ["access-walk", []], ["bridge-walk", []], ["dock-walk", []], ["walk", []], ["obelisk-walk", []], ["server-bench", []]] as const) {
  const start = performance.now();
  const child = Bun.spawnSync(["bun", join(import.meta.dir, `${tool}.ts`), paths.mapFile, ...args], { stdout: "pipe", stderr: "pipe" });
  writeFileSync(join(paths.folder, `${tool}.log`), new TextDecoder().decode(child.stdout) + new TextDecoder().decode(child.stderr));
  const result = { tool, exit: child.exitCode, seconds: Number(((performance.now() - start) / 1000).toFixed(2)) };
  results.push(result); console.log(JSON.stringify(result));
}
writeFileSync(join(paths.folder, "verification.json"), JSON.stringify(results, null, 2) + "\n");
if (results.some((r) => r.exit !== 0)) process.exitCode = 1;
