// The fastback as years in a ruined street leave it: where it stopped, stripped, and on its roof. `bun run art -- core:fastback_abandoned` builds it,
// after ../parked_common/paint.py has painted its pictures where it has its own.
import { abandonedAsset, prepared } from "../parked_common/spec.ts";

export default abandonedAsset("fastback", ["abandoned", "stripped", "roof"], { enamel: prepared("enamel"), detail: prepared("detail", { cutout: true }) }, undefined, 16);
