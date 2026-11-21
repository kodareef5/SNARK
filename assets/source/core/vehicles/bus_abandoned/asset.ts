// The bus as years in a ruined street leave it, where it stopped. `bun run art -- core:bus_abandoned` builds it,
// after ../parked_common/paint.py has painted its pictures where it has its own.
import { abandonedAsset, livery } from "../parked_common/spec.ts";

export default abandonedAsset("bus", ["abandoned"], livery("bus"), [7000, 3000, 1200, 500]);
