// The patrol jeep as a survivor's salvage leaves it: stripped, and a shell. `bun run art -- core:patrol_jeep_salvaged`
// builds it, on the pictures of ../patrol_jeep_abandoned.
import abandoned from "../patrol_jeep_abandoned/asset.ts";
import { salvagedAsset } from "../parked_common/spec.ts";

export default salvagedAsset("patrol_jeep", abandoned);
