// Run the same actual human geometry audit used by the regression test. No stored anchor-only approximation.
import { writeFileSync } from "node:fs";
import { auditHelicopterFit } from "../../../../../../tools/art/helicopter-fit.ts";
const bounds=process.argv.includes("--bounds"), report=auditHelicopterFit(bounds,true,process.argv.includes("--controls"));
console.log(JSON.stringify(report,null,2));
if(process.argv.includes("--write"))writeFileSync(new URL(bounds?"fit-bounds.json":"fit.json",import.meta.url),JSON.stringify(report,null,2)+"\n");
if(report.failures.length)process.exitCode=1;
