// The bus as a survivor's salvage leaves it: stripped, and a shell. `bun run art -- core:bus_salvaged`
// builds it, on the pictures of ../bus_abandoned.
import abandoned from "../bus_abandoned/asset.ts";
import { salvagedAsset } from "../parked_common/spec.ts";

export default salvagedAsset("bus", abandoned, undefined, { shell: [2300, 1200, 500] });
