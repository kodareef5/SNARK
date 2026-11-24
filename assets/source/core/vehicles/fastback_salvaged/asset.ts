// The fastback as a survivor's salvage leaves it: a shell. `bun run art -- core:fastback_salvaged`
// builds it, on the pictures of ../fastback_abandoned, which has its stripped look.
import abandoned from "../fastback_abandoned/asset.ts";
import { salvagedAsset } from "../parked_common/spec.ts";

export default salvagedAsset("fastback", abandoned, ["shell"]);
