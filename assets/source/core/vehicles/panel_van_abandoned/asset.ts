// The panel van as years in a ruined street leave it: where it stopped, and stripped. `bun run art -- core:panel_van_abandoned` builds it,
// after ../parked_common/paint.py has painted its pictures where it has its own.
import { abandonedAsset, vanMaterials } from "../parked_common/spec.ts";

export default abandonedAsset("panel_van", ["abandoned", "stripped"], vanMaterials(), [7300, 2400, 960, 400], 16);
