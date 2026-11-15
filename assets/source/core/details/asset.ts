// The pack of small details: this folder's effects.json, the shared effects most creatures use, and every creature's
// cues.json, with all their pictures in one atlas. `bun run art -- core:details` builds it, without Blender.
// assets/source/DETAILS.md says how to write a sheet.

import type { DetailsAsset } from "../../../../tools/art/spec.ts";

export default { kind: "details" } satisfies DetailsAsset;
