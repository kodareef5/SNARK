// The self-check's own code, which only a page opened with ?selfcheck fetches (D873). A player's page never needs it,
// so it stays out of the script the first frame waits for.

export { ActivitySelfcheck } from "./activity-selfcheck.ts";
export { SelfcheckProgress, selfcheckReport } from "./selfcheck-report.ts";
export { SelfcheckSurfaces } from "./selfcheck-surfaces.ts";
