// The muscle car as a survivor's salvage leaves it: stripped, and a shell. `bun run art -- core:muscle_car_salvaged`
// builds it, on the pictures of ../muscle_car_abandoned.
import abandoned from "../muscle_car_abandoned/asset.ts";
import { salvagedAsset } from "../parked_common/spec.ts";

export default salvagedAsset("muscle_car", abandoned);
