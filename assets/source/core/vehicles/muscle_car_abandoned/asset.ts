// The muscle car as years in a ruined street leave it, where it stopped. `bun run art -- core:muscle_car_abandoned` builds it,
// after ../parked_common/paint.py has painted its pictures where it has its own.
import { abandonedAsset, livery } from "../parked_common/spec.ts";

export default abandonedAsset("muscle_car", ["abandoned"], livery("muscle_car"));
