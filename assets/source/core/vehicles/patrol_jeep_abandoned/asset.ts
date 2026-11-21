// The patrol jeep as years in a ruined street leave it, where it stopped. `bun run art -- core:patrol_jeep_abandoned` builds it,
// after ../parked_common/paint.py has painted its pictures where it has its own.
import { abandonedAsset, prepared } from "../parked_common/spec.ts";

export default abandonedAsset("patrol_jeep", ["abandoned"], { patrol: prepared("patrol", { normal: "../patrol_jeep/tex/normal.png", height: "../patrol_jeep/tex/height.png", tops: { normal: 512 } }) }, [24000, 6000, 2400, 960, 400], 16);
