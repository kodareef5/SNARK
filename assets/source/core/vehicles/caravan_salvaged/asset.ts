// The caravan as a survivor's salvage leaves it: a shell. `bun run art -- core:caravan_salvaged`
// builds it, on the pictures of ../caravan_abandoned, which has its stripped look.
import abandoned from "../caravan_abandoned/asset.ts";
import { salvagedAsset } from "../parked_common/spec.ts";

export default salvagedAsset("caravan", abandoned, ["shell"]);
