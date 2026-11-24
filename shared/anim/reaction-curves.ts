// The reaction curves, packed as shared/anim/reactions.ts reads them. Where this is imported, on the server, in tests
// and in tools, it bakes them with the ragdoll solver once, in about 0.15 s. A page's build bakes them as it builds and
// puts the text in this file's place (tools/page-script.ts), so no page loads the solver and no packed text is kept.

import { packCurves } from "./reaction-bake.ts";

export const REACT_CURVES: string = packCurves();
