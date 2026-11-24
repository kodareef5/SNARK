// The taxi as a survivor's salvage leaves it: stripped, and a shell. `bun run art -- core:taxi_salvaged`
// builds it, on the pictures of ../taxi_abandoned.
import abandoned from "../taxi_abandoned/asset.ts";
import { salvagedAsset } from "../parked_common/spec.ts";

export default salvagedAsset("taxi", abandoned);
