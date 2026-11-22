// What bug report mode's files (notes/notes.ts and those it imports) use of the code the first frame waits for, handed
// to them when the app makes the mode, as the resource monitor's are (ui/monitor-kit.ts, D915): the monitor's kit, for
// what the crosshair is on and the HUD's glass, and the streets under the survivor's feet.

import { StreetPoint, streetAt } from "../../shared/world/streets.ts";
import { MONITOR_KIT } from "./ui/monitor-kit.ts";

export const NOTES_KIT = { ...MONITOR_KIT, streetAt, StreetPoint };
export type NotesKit = typeof NOTES_KIT;
