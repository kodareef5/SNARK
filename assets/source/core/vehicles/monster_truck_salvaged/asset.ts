// The monster truck as a survivor's salvage leaves it: stripped, and a shell. `bun run art -- core:monster_truck_salvaged`
// builds it, on the pictures of ../monster_truck_abandoned.
import abandoned from "../monster_truck_abandoned/asset.ts";
import { salvagedAsset } from "../parked_common/spec.ts";

export default salvagedAsset("monster_truck", abandoned, undefined, { shell: [3400, 2400, 960, 400] });
