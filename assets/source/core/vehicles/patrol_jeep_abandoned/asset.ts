// The patrol jeep as years in a ruined street leave it, where it stopped. `bun run art -- core:patrol_jeep_abandoned` builds
// it, after ../parked_common/paint.py has painted its pictures. Its 947 parts keep its finest at 24,000 triangles; its first
// flat level is stated 2.4 cm from it (measured 5.1), so that it is drawn from 130 m on high as the patrol sedan's is, and
// the finest is not held to 280 m.
import { abandonedAsset, prepared } from "../parked_common/spec.ts";

const asset = abandonedAsset("patrol_jeep", ["abandoned"], { patrol: prepared("patrol", { normal: "../patrol_jeep/tex/normal.png", height: "../patrol_jeep/tex/height.png", tops: { normal: 512 } }) }, [24000, 6000, 2400, 960, 400], 16);
export default { ...asset, pieces: asset.pieces.map((p) => ({ ...p, errors: [0.024] })) };
