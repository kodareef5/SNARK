// The berlinetta as years in a ruined street leave it, where it stopped. `bun run art -- core:berlinetta_abandoned` builds it,
// after ../parked_common/paint.py has painted its pictures where it has its own.
import { abandonedAsset, prepared } from "../parked_common/spec.ts";

export default abandonedAsset("berlinetta", ["abandoned"], { coachwork: prepared("coachwork", { normal: "../sports/tex/normal.png", height: "../sports/tex/height.png", cutout: true }) }, [6900, 2400, 960, 400], 8);
