// The berlinetta as a survivor's salvage leaves it: stripped, and a shell. `bun run art -- core:berlinetta_salvaged`
// builds it, on the pictures of ../berlinetta_abandoned.
import abandoned from "../berlinetta_abandoned/asset.ts";
import { salvagedAsset } from "../parked_common/spec.ts";

export default salvagedAsset("berlinetta", abandoned);
