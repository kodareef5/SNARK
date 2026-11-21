// The semi's tractor as years in a ruined street leave it, where it stopped. `bun run art -- core:semi_abandoned` builds it,
// after ../parked_common/paint.py has painted its pictures where it has its own.
import { abandonedAsset, livery } from "../parked_common/spec.ts";

export default abandonedAsset("semi", ["abandoned"], livery("semi"), [10000, 4000, 1500, 500]);
