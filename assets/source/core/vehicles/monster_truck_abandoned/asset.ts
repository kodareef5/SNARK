// The monster truck as years in a ruined street leave it, where it stopped. `bun run art -- core:monster_truck_abandoned` builds it,
// after ../parked_common/paint.py has painted its pictures where it has its own.
import { abandonedAsset, livery } from "../parked_common/spec.ts";

export default abandonedAsset("monster_truck", ["abandoned"], livery("monster_truck"), [9100, 4000, 2400, 960, 400]);
