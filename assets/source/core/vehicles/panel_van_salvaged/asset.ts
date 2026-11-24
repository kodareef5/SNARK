// The panel van as a survivor's salvage leaves it: a shell. `bun run art -- core:panel_van_salvaged`
// builds it, on the pictures of ../panel_van_abandoned, which has its stripped look.
import abandoned from "../panel_van_abandoned/asset.ts";
import { salvagedAsset } from "../parked_common/spec.ts";

export default salvagedAsset("panel_van", abandoned, ["shell"]);
