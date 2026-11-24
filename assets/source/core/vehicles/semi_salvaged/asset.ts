// The semi's tractor as a survivor's salvage leaves it: stripped, and a shell. `bun run art -- core:semi_salvaged`
// builds it, on the pictures of ../semi_abandoned.
import abandoned from "../semi_abandoned/asset.ts";
import { salvagedAsset } from "../parked_common/spec.ts";

export default salvagedAsset("semi", abandoned);
