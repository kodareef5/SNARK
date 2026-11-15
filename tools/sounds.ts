// `bun run sounds`: how far the sound catalogue (shared/sound/cues.ts) is covered by the cue sheets under assets/source,
// without building anything. Prints the totals and every occasion that is silent though the game fires it; `--all`
// prints every occasion. Exits 1 if the catalogue itself is faulty.

import { coverage, coverageLines } from "../client/core/sound/coverage.ts";
import { cueFaults } from "../shared/sound/cues.ts";
import { findSheets } from "./pack/sound.ts";

const faults = cueFaults();
for (const f of faults) console.error(`catalogue: ${f}`);
const ids = findSheets().flatMap((s) => Object.keys(s.sheet.sounds).map((name) => `${s.owner}/sound/${name}`));
for (const line of coverageLines(coverage(ids), process.argv.includes("--all"))) console.log(line);
process.exit(faults.length > 0 ? 1 : 0);
