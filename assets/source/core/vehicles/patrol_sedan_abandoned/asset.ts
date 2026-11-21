// The patrol sedan as years in a ruined street leave it, where it stopped. `bun run art -- core:patrol_sedan_abandoned` builds it,
// after ../parked_common/paint.py has painted its pictures where it has its own.
import { abandonedAsset, prepared } from "../parked_common/spec.ts";

export default abandonedAsset("patrol_sedan", ["abandoned"], { cruiser: prepared("cruiser", { normal: "../patrol_sedan/tex/normal.png", height: "../patrol_sedan/tex/height.png" }) }, [11500, 4800, 2400, 960, 400], 8);
