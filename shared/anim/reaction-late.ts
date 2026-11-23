// The reaction curves, kept out of the script a page waits for before its first frame: a page fetches this file as it
// boots and waits for it before it joins a world (client/shell/main.ts), so a stagger is drawn as it is judged. The
// server, tests and tools import it up front. Loading it hands the curves to every pose (shared/anim/reactions.ts).

import { REACT_CURVES } from "./reaction-curves.ts";
import { holdReactCurves } from "./reactions.ts";

holdReactCurves(REACT_CURVES);
