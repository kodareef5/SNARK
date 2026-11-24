// The veloce as a survivor's salvage leaves it: stripped, and a shell. `bun run art -- core:veloce_salvaged`
// builds it, on the pictures of ../veloce_abandoned.
import abandoned from "../veloce_abandoned/asset.ts";
import { salvagedAsset } from "../parked_common/spec.ts";

export default salvagedAsset("veloce", abandoned);
