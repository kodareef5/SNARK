// The semi's tractor as years in a ruined street leave it, where it stopped. `bun run art -- core:semi_abandoned` builds it.
// Made from its finest the simplifier opens its seams, so it keeps its model as its finest and its own coarser levels,
// made by hand (../semi/lod2 to lod5), after it.
import { abandonedAsset, livery } from "../parked_common/spec.ts";

const { flat: _made, ...asset } = abandonedAsset("semi", ["abandoned"], livery("semi"), [20700, 11800, 6150, 4050, 1300]);
export default asset;
