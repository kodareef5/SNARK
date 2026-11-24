// The patrol sedan as a survivor's salvage leaves it: stripped, and a shell. `bun run art -- core:patrol_sedan_salvaged`
// builds it, on the pictures of ../patrol_sedan_abandoned.
import abandoned from "../patrol_sedan_abandoned/asset.ts";
import { salvagedAsset } from "../parked_common/spec.ts";

export default salvagedAsset("patrol_sedan", abandoned);
