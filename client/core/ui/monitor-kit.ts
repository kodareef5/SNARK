// What the resource monitor's files (ui/monitor.ts and those it imports) use of the code the first frame waits for,
// handed to them when the app makes the monitor. They import none of that code themselves: a file fetched later that
// imported a value from it would have the build cut the first frame's script into more pieces, and each piece costs
// that script bytes (D902). Their own numbers (styles, kinds of node, states) they keep as copies, which a test holds
// to the originals.

import { castWorld, lookDirection, rayHit } from "../../../shared/world/ray.ts";
import { frame, frameOf } from "../../../shared/world/frame.ts";
import { fitText, textWidth, wrapText } from "./nodes.ts";
import { smallButton } from "./menu.ts";
import { glass } from "./skin.ts";

export const MONITOR_KIT = { glass, smallButton, fitText, textWidth, wrapText, castWorld, rayHit, lookDirection, frame, frameOf };
export type MonitorKit = typeof MONITOR_KIT;
